import { logger } from '../../../../shared/logger/logger';

/** Contexto de uma execução: `signal` abortado no `stop()` (parada cooperativa). */
export interface OfferWorkerRunContext {
  signal: AbortSignal;
}

export interface OfferDispatchTick {
  execute(ctx?: OfferWorkerRunContext): Promise<{ processed: number }>;
}

/** Etapa independente (ex.: envio, capturas): no máximo uma execução dela em curso por worker. */
export interface OfferWorkerStage {
  name: string;
  run(ctx: OfferWorkerRunContext): Promise<{ processed: number }>;
}

interface CommonOptions {
  intervalMs?: number;
  /** Teto único de espera no `stop()` para tudo que estiver em curso (padrão 10 s). */
  stopTimeoutMs?: number;
}

/** Modo legado: um tick sequencial e um único `running` (comportamento antigo). */
export interface OfferDispatchWorkerLegacyOptions extends CommonOptions {
  tick: () => OfferDispatchTick;
}

/** Etapas independentes no mesmo timer: uma lenta não segura as rodadas da outra. */
export interface OfferDispatchWorkerStagesOptions extends CommonOptions {
  stages: readonly OfferWorkerStage[];
  /** Relógio para o resumo periódico (padrão `Date.now`). */
  clock?: () => number;
  /** Intervalo mínimo entre resumos no log (padrão 60 s). */
  summaryIntervalMs?: number;
}

export type OfferDispatchWorkerOptions = OfferDispatchWorkerLegacyOptions | OfferDispatchWorkerStagesOptions;

const DEFAULT_INTERVAL_MS = 2_000;
const DEFAULT_STOP_TIMEOUT_MS = 10_000;
const DEFAULT_SUMMARY_INTERVAL_MS = 60_000;

interface StageSlot {
  stage: OfferWorkerStage;
  running: Promise<void> | null;
  startedAt: number;
  /** Contadores desde o último resumo (tamanho fixo: um slot por etapa). */
  runs: number;
  processed: number;
  failures: number;
}

/**
 * Worker do gerador de ofertas e das capturas do monitoramento, num único timer de 2 s.
 *
 * - Legado (`tick`): uma execução por vez; o tick seguinte é pulado se o anterior ainda roda.
 * - Etapas (`stages`): cada etapa tem seu slot; a cada tick inicia só as etapas livres. Envio preso
 *   em I/O não atrasa a próxima rodada de capturas, e vice-versa.
 *
 * Multi-instância: a posse é do banco — envios por advisory lock + uma faixa por sessão
 * (`PrismaOfferDispatchRepository.claimDue`), capturas por `FOR UPDATE SKIP LOCKED`
 * (`PrismaCapturedOfferRepository.claimPending`). Slots/promises aqui são só controle transitório
 * da execução. Equivalente futuro: fila `broadcast.post` (docs/arquitetura-escala.md §3.6).
 */
export class OfferDispatchWorker {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private readonly slots: StageSlot[];
  private stopping = false;
  private abort = new AbortController();
  private lastSummaryAt = 0;
  private lastCpu: NodeJS.CpuUsage | null = null;
  private readonly log = logger.child({ module: 'OfferDispatchWorker' });

  constructor(private readonly options: OfferDispatchWorkerOptions) {
    this.slots = 'stages' in options
      ? options.stages.map((stage) => ({ stage, running: null, startedAt: 0, runs: 0, processed: 0, failures: 0 }))
      : [];
    this.lastSummaryAt = this.clock();
  }

  start(): void {
    if (this.timer) return;
    if (this.stopping) {
      this.stopping = false;
      this.abort = new AbortController();
    }
    this.lastSummaryAt = this.clock();
    this.lastCpu = process.cpuUsage();
    this.timer = setInterval(() => void this.runTick(), this.options.intervalMs ?? DEFAULT_INTERVAL_MS);
    this.timer.unref();
  }

  /**
   * Para o intervalo, sinaliza parada a TODAS as execuções e só então espera, sob um teto único
   * (`stopTimeoutMs`, ou `timeoutMs` menor = orçamento restante do shutdown). Espera com timeout
   * não cancela I/O: envio/captura em curso só termina; item não iniciado volta pelo stale.
   */
  async stop(opts: { timeoutMs?: number } = {}): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.abort.abort();
    const pending = this.inFlight();
    if (pending.length === 0) return;
    const limit = Math.max(0, Math.min(opts.timeoutMs ?? Infinity, this.options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS));
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), limit);
    });
    try {
      if (await Promise.race([Promise.all(pending).then(() => false), timedOut])) {
        const busy = this.slots.filter((s) => s.running).map((s) => s.stage.name);
        this.log.warn({ stages: busy.length ? busy : undefined }, 'offer dispatch tick still running at stop; giving up waiting');
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Exposto para teste; nunca lança. Depois do `stop()` não inicia nada. Legado: devolve o tick em
   * curso. Etapas: devolve só as execuções iniciadas nesta chamada.
   */
  runTick(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    if (!('stages' in this.options)) return this.runLegacyTick();
    this.maybeSummarize();
    const started: Promise<void>[] = [];
    for (const slot of this.slots) {
      if (slot.running) continue; // a etapa não sobrepõe a si mesma
      started.push(this.startStage(slot));
    }
    return Promise.all(started).then(() => undefined);
  }

  private runLegacyTick(): Promise<void> {
    if (this.running) return this.running;
    // `finally` roda em microtask, depois da atribuição
    this.running = this.tickOnce().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async tickOnce(): Promise<void> {
    try {
      const { processed } = await (this.options as OfferDispatchWorkerLegacyOptions).tick().execute({ signal: this.abort.signal });
      if (processed > 0) this.log.debug({ processed }, 'offer dispatches processed');
    } catch (err) {
      this.log.error({ err }, 'offer dispatch tick failed');
    }
  }

  private startStage(slot: StageSlot): Promise<void> {
    slot.startedAt = this.clock();
    slot.runs++;
    const run = this.runStage(slot).finally(() => {
      // Só limpa a própria execução, nunca uma mais nova do mesmo slot
      if (slot.running === run) slot.running = null;
    });
    slot.running = run;
    return run;
  }

  /** Nunca lança: erro (até síncrono) de uma etapa não afeta a outra nem o timer. */
  private async runStage(slot: StageSlot): Promise<void> {
    try {
      const { processed } = await slot.stage.run({ signal: this.abort.signal });
      slot.processed += processed;
      if (processed > 0) this.log.debug({ stage: slot.stage.name, processed }, 'offer worker stage processed');
    } catch (err) {
      slot.failures++;
      this.log.error({ err: (err as Error)?.name, stage: slot.stage.name }, 'offer worker stage failed');
    }
  }

  private inFlight(): Promise<void>[] {
    const out: Promise<void>[] = [];
    if (this.running) out.push(this.running);
    for (const s of this.slots) if (s.running) out.push(s.running);
    return out;
  }

  private clock(): number {
    return 'stages' in this.options && this.options.clock ? this.options.clock() : Date.now();
  }

  /**
   * No máximo um resumo por intervalo, no próprio tick (sem timer novo): contagens por etapa,
   * etapas ocupadas e há quanto tempo, CPU do processo no período e RSS. Sem IDs nem conteúdo.
   */
  private maybeSummarize(): void {
    const opts = this.options as OfferDispatchWorkerStagesOptions;
    const now = this.clock();
    if (now - this.lastSummaryAt < (opts.summaryIntervalMs ?? DEFAULT_SUMMARY_INTERVAL_MS)) return;
    try {
      const cpu = process.cpuUsage(this.lastCpu ?? undefined);
      this.lastCpu = process.cpuUsage();
      const stages = Object.fromEntries(this.slots.map((s) => [s.stage.name, {
        runs: s.runs, processed: s.processed, failures: s.failures,
        busyMs: s.running ? Math.max(0, now - s.startedAt) : null,
      }]));
      this.log.info({
        periodMs: now - this.lastSummaryAt, stages,
        cpuMs: Math.round((cpu.user + cpu.system) / 1000), rssBytes: process.memoryUsage().rss,
      }, 'offer worker summary');
    } catch {
      // observação é melhor esforço
    }
    this.lastSummaryAt = now;
    for (const s of this.slots) {
      s.runs = 0;
      s.processed = 0;
      s.failures = 0;
    }
  }
}
