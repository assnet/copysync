import { randomUUID } from 'node:crypto';
import type { IJobLease, IJobLeaseRenewal } from '../../../../shared/jobs/IJobLease';
import { logger } from '../../../../shared/logger/logger';
import type { FeatureUsageDayRow, IFeatureUsageDailyRepository } from '../../domain/contracts/IFeatureUsageDailyRepository';
import type { IFeatureUsageReader } from '../../domain/contracts/IFeatureUsageReader';
import type {
  FeatureUsageTickPatch,
  IFeatureUsageRollupStateRepository,
} from '../../domain/contracts/IFeatureUsageRollupStateRepository';
import type { UsageReadBudget } from '../../domain/contracts/IUsageReadGate';
import type { FeatureUsageRow } from '../../domain/services/aggregateFeatureUsage';
import {
  FEATURE_USAGE_CATALOG,
  findFeature,
  sourceOn,
  type FeatureUsageCutovers,
  type FeatureUsageDefinition,
  type FeatureUsageKey,
} from '../../domain/services/featureUsageCatalog';
import { addDays, dayInZone, startOfDayInstant } from '../../domain/services/featureUsagePeriod';

export const FEATURE_USAGE_ROLLUP_LEASE = 'feature-usage-rollup';
export const FEATURE_USAGE_BACKFILL_LEASE = 'feature-usage-backfill';
export const FEATURE_USAGE_RETENTION_LEASE = 'feature-usage-retention';
/** Menor que o tick do job (15 min): o dono readquire no tick seguinte. Solto ao terminar. */
export const FEATURE_USAGE_ROLLUP_LEASE_TTL_MS = 10 * 60_000;
export const FEATURE_USAGE_BACKFILL_LEASE_TTL_MS = 10 * 60_000;
/** Trava de frequência da retenção (1×/24 h no cluster); não é solta. */
export const FEATURE_USAGE_RETENTION_LEASE_TTL_MS = 24 * 3_600_000;
/** Retenção do agregado: apaga `day < hoje − 400`. */
export const FEATURE_USAGE_RETENTION_DAYS = 400;
/** Passo do backfill: no máximo 7 dias por execução (sem escrita em massa). */
export const FEATURE_USAGE_BACKFILL_STEP_DAYS = 7;
/** Janela recente: no máximo 7 dias por tick, de `finalizedThrough + 1` até hoje. */
export const FEATURE_USAGE_RECENT_MAX_DAYS = 7;
/** A partir de tantas falhas seguidas: log `error` e a janela recente é lida dia a dia (isola o dia ruim). */
export const FEATURE_USAGE_FAILURE_STREAK_ALERT = 3;

type RollupLogger = {
  warn: (obj: object, msg: string) => void;
  info: (obj: object, msg: string) => void;
  error?: (obj: object, msg: string) => void;
};

/**
 * Janela recente do tick: de `finalizedThrough + 1` (ou ontem, sem marca) até hoje, no máximo 7 dias; nunca começa
 * depois de ontem nem antes da retenção. Job parado por dias alcança hoje em vários ticks.
 */
export function recentWindow(finalizedThrough: string | null, today: string): string[] {
  const yesterday = addDays(today, -1);
  let start = finalizedThrough ? addDays(finalizedThrough, 1) : yesterday;
  if (start > yesterday) start = yesterday;
  const floor = addDays(today, -FEATURE_USAGE_RETENTION_DAYS);
  if (start < floor) start = floor;
  const days: string[] = [];
  for (let d = start; d <= today && days.length < FEATURE_USAGE_RECENT_MAX_DAYS; d = addDays(d, 1)) days.push(d);
  return days;
}

export interface RollupFeatureUsageDeps {
  /** Leitor sob demanda das tabelas de domínio (mesmo SQL da P1). */
  reader: IFeatureUsageReader;
  daily: Pick<IFeatureUsageDailyRepository, 'replaceDay' | 'purgeBefore'>;
  state: IFeatureUsageRollupStateRepository;
  lease: IJobLease & IJobLeaseRenewal;
  /** Orçamento de cada leitura de fonte (o job não passa pelo portão do `http`). */
  newBudget: () => UsageReadBudget;
  /** Recursos lidos juntos (uma fonte = uma instrução). Ausente = um grupo por recurso. Erro num grupo não para os outros. */
  sourceGroups?: readonly (readonly string[])[];
  catalog?: readonly FeatureUsageDefinition[];
  ownerId?: string;
  now?: () => Date;
  log?: RollupLogger;
}

export type FeatureUsageBackfillOutcome = 'done' | 'busy' | 'failed' | 'step' | 'completed';

export type RollupFeatureUsageResult =
  | { status: 'skipped' }
  /** Renovação do lease falhou no meio: o tick parou sem gravar mais nada. */
  | { status: 'lost' }
  | {
      status: 'ran';
      failedGroups: number;
      backfill: FeatureUsageBackfillOutcome;
      purged: number | null;
      /** Janela recente lida neste tick. */
      window: { from: string; to: string };
      /** Dias da janela com falha (só na leitura dia a dia). */
      failedDays: string[];
      failureStreak: number;
    };

/** Perdeu o lease no meio do tick (renovação recusada): nada mais é lido nem gravado. */
export class FeatureUsageRollupLeaseLostError extends Error {
  constructor(readonly lease: string) {
    super(`feature usage rollup lost lease ${lease}`);
    this.name = 'FeatureUsageRollupLeaseLostError';
  }
}

type GroupRead = { keys: string[]; rows: FeatureUsageRow[]; firstDataDay: Record<string, string | null | undefined> };

/**
 * Consolidação diária do uso (design §4.4, USAGE-18/20). Uma execução por tick do job, sob o lease
 * `feature-usage-rollup` (sem ele não lê nem grava):
 * 1. recalcula a janela recente (`recentWindow`: de `finalizedThrough + 1` até hoje, ≤ 7 dias) dos recursos cuja
 *    fonte no dia é `LIVE`; sem falha, grava `lastSuccessAt` (quando a janela chega a hoje) e avança
 *    `finalizedThrough` (nunca além de anteontem: ontem é sempre revisitado). Com 3+ falhas seguidas a janela é
 *    lida dia a dia e o dia ruim vai ao log `error`; `finalizedThrough` anda só até o último dia bom contíguo;
 * 2. backfill (lease próprio): no máximo 7 dias para trás a partir do cursor salvo, até o primeiro dado das fontes
 *    (limitado à retenção). O cursor e o marco ficam em `platform_settings`; o marco só é gravado na execução que
 *    termina. Falha numa fonte = o cursor não anda (o passo se repete, idempotente);
 * 3. retenção de 400 dias, 1×/24 h (lease que não é solto).
 * Nunca grava recurso `RECORDED` nem dia a partir do corte gravado pelo contador (`cutovers`, lido no início do
 * tick): só as chaves permitidas no dia entram em `keys` do `replaceDay`, e o que não está lá não é tocado.
 */
export class RollupFeatureUsageUseCase {
  private readonly ownerId: string;
  private readonly catalog: readonly FeatureUsageDefinition[];
  private readonly groups: readonly (readonly string[])[];
  private readonly log: RollupLogger;
  /** Leases detidos agora (renovados entre grupos de fonte). */
  private readonly held = new Set<string>();
  /** Cortes lidos no início do tick (o tick só toca hoje e dias anteriores; corte novo é sempre ≥ amanhã). */
  private cutovers: FeatureUsageCutovers = {};

  constructor(private readonly deps: RollupFeatureUsageDeps) {
    this.ownerId = deps.ownerId ?? randomUUID();
    this.catalog = deps.catalog ?? FEATURE_USAGE_CATALOG;
    const liveKeys = new Set(this.catalog.filter((f) => f.source === 'LIVE').map((f) => f.key as string));
    const groups = deps.sourceGroups ?? [...liveKeys].map((k) => [k]);
    // Só recursos `LIVE` do catálogo; grupo vazio some
    this.groups = groups.map((g) => g.filter((k) => liveKeys.has(k))).filter((g) => g.length > 0);
    this.log = deps.log ?? logger.child({ module: 'RollupFeatureUsageUseCase' });
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** O job pode gravar `key` em `day`: recurso `LIVE` e o dia antes do corte gravado, se houver. */
  private writable(key: string, day: string): boolean {
    const f = findFeature(key, this.catalog);
    return !!f && f.source === 'LIVE' && sourceOn(f, day, this.cutovers) === 'LIVE';
  }

  /**
   * Renova os leases detidos (rollup e, no backfill, o do backfill) por mais um TTL a partir de agora. Chamado antes
   * de cada leitura de fonte e de cada gravação de dia: o tick longo não deixa o lease vencer no meio. Renovação
   * recusada = outro processo pode estar no mesmo trabalho: aborta o tick.
   */
  private async keepAlive(): Promise<void> {
    const until = new Date(this.now().getTime() + FEATURE_USAGE_ROLLUP_LEASE_TTL_MS);
    for (const name of this.held) {
      if (!(await this.deps.lease.renew(name, this.ownerId, until))) throw new FeatureUsageRollupLeaseLostError(name);
    }
  }

  async execute(): Promise<RollupFeatureUsageResult> {
    const { lease } = this.deps;
    const now = this.now();
    const until = new Date(now.getTime() + FEATURE_USAGE_ROLLUP_LEASE_TTL_MS);
    if (!(await lease.tryAcquire(FEATURE_USAGE_ROLLUP_LEASE, this.ownerId, until, now))) return { status: 'skipped' };
    this.held.add(FEATURE_USAGE_ROLLUP_LEASE);
    try {
      return await this.run(now);
    } catch (err) {
      if (!(err instanceof FeatureUsageRollupLeaseLostError)) throw err;
      this.log.warn({ lease: err.lease }, 'feature usage rollup lost lease, tick aborted');
      return { status: 'lost' };
    } finally {
      this.held.delete(FEATURE_USAGE_ROLLUP_LEASE);
      await lease.release(FEATURE_USAGE_ROLLUP_LEASE, this.ownerId);
    }
  }

  private async run(now: Date): Promise<RollupFeatureUsageResult> {
    const st = await this.deps.state.get();
    this.cutovers = st.cutovers;
    const today = dayInZone(now);
    const window = recentWindow(st.finalizedThrough, today);
    const split = st.failureStreak >= FEATURE_USAGE_FAILURE_STREAK_ALERT;

    let failedGroups = 0;
    const failedDays: string[] = [];
    /** Último dia bom contíguo desde o início da janela. */
    let goodThrough: string | null = null;
    if (!split) {
      failedGroups = (await this.consolidate(window, null)).failedGroups;
      if (failedGroups === 0) goodThrough = window[window.length - 1]!;
    } else {
      for (const day of window) {
        const r = await this.consolidate([day], null);
        failedGroups += r.failedGroups;
        if (r.failedGroups > 0) failedDays.push(day);
        else if (failedDays.length === 0) goodThrough = day;
      }
    }

    const backfill = await this.backfillStep(today, now);
    const purged = await this.retention(today, now);

    const failed = failedGroups > 0 || backfill === 'failed';
    const failureStreak = failed ? st.failureStreak + 1 : 0;
    if (failureStreak >= FEATURE_USAGE_FAILURE_STREAK_ALERT) {
      const info = { failureStreak, failedDays, backfill, window: { from: window[0], to: window[window.length - 1] } };
      if (this.log.error) this.log.error(info, 'feature usage rollup failing repeatedly');
      else this.log.warn(info, 'feature usage rollup failing repeatedly');
    }
    const patch: FeatureUsageTickPatch = { failureStreak };
    if (goodThrough !== null) {
      const cap = addDays(today, -2);
      const next = goodThrough < cap ? goodThrough : cap;
      if (!st.finalizedThrough || next > st.finalizedThrough) patch.finalizedThrough = next;
    }
    // Fresco só quando a janela chegou a hoje sem falha nenhuma
    if (failedGroups === 0 && window[window.length - 1] === today) patch.lastSuccessAt = now;
    await this.keepAlive();
    await this.deps.state.recordTick(patch);
    return {
      status: 'ran',
      failedGroups,
      backfill,
      purged,
      window: { from: window[0]!, to: window[window.length - 1]! },
      failedDays,
      failureStreak,
    };
  }

  /**
   * Lê cada grupo de fontes uma vez para os dias pedidos (crescentes e contíguos) e regrava dia a dia só as chaves
   * permitidas dos grupos lidos com sucesso. `floorOf` (backfill) dá o primeiro dia a gravar a partir do primeiro dado.
   */
  private async consolidate(
    days: readonly string[],
    floorOf: ((first: string | null) => string) | null,
  ): Promise<{ failedGroups: number; firstData: string | null }> {
    const first = days[0]!;
    const last = days[days.length - 1]!;
    const ok: GroupRead[] = [];
    let failedGroups = 0;
    for (const group of this.groups) {
      const keys = group.filter((k) => days.some((d) => this.writable(k, d)));
      if (keys.length === 0) continue;
      await this.keepAlive();
      try {
        const r = await this.deps.reader.read({
          from: startOfDayInstant(first),
          toExclusive: startOfDayInstant(addDays(last, 1)),
          featureKeys: keys as FeatureUsageKey[],
          granularity: 'day',
          budget: this.deps.newBudget(),
        });
        ok.push({ keys, rows: r.rows, firstDataDay: r.firstDataDay as Record<string, string | null | undefined> });
      } catch (err) {
        failedGroups++;
        this.log.warn({ keys, from: first, to: last, err: (err as Error)?.name }, 'feature usage rollup source failed');
      }
    }

    let firstData: string | null = null;
    for (const g of ok)
      for (const k of g.keys) {
        const d = g.firstDataDay[k];
        if (d && (firstData === null || d < firstData)) firstData = d;
      }
    const floor = floorOf ? floorOf(firstData) : null;

    for (const day of days) {
      if (floor !== null && day < floor) continue;
      const keys = ok.flatMap((g) => g.keys.filter((k) => this.writable(k, day)));
      if (keys.length === 0) continue;
      const allowed = new Set(keys);
      const rows: FeatureUsageDayRow[] = [];
      for (const g of ok)
        for (const r of g.rows)
          if (r.day === day && allowed.has(r.featureKey))
            rows.push({ tenantId: r.tenantId, featureKey: r.featureKey, kind: r.kind, uses: r.uses });
      await this.keepAlive();
      try {
        await this.deps.daily.replaceDay(day, keys, rows);
      } catch (err) {
        failedGroups++;
        this.log.warn({ day, err: (err as Error)?.name }, 'feature usage rollup day write failed');
      }
    }
    return { failedGroups, firstData };
  }

  private async backfillStep(today: string, now: Date): Promise<FeatureUsageBackfillOutcome> {
    const { state, lease } = this.deps;
    if ((await state.get()).backfillCompletedAt) return 'done';
    const until = new Date(now.getTime() + FEATURE_USAGE_BACKFILL_LEASE_TTL_MS);
    if (!(await lease.tryAcquire(FEATURE_USAGE_BACKFILL_LEASE, this.ownerId, until, now))) return 'busy';
    this.held.add(FEATURE_USAGE_BACKFILL_LEASE);
    try {
      // Relido sob a trava: outro processo pode ter acabado de andar ou de terminar
      const current = await state.get();
      if (current.backfillCompletedAt) return 'done';
      const retentionFloor = addDays(today, -FEATURE_USAGE_RETENTION_DAYS);
      // Hoje e ontem são do passo 1: o backfill começa anteontem
      const start = current.backfillCursor ?? addDays(today, -2);
      const days: string[] = [];
      for (let i = FEATURE_USAGE_BACKFILL_STEP_DAYS - 1; i >= 0; i--) {
        const d = addDays(start, -i);
        if (d >= retentionFloor) days.push(d);
      }
      // Sem dado nenhum: o agregado já cobre a partir de ontem (passo 1)
      const floorOf = (first: string | null) => {
        const f = first ?? addDays(today, -1);
        return f < retentionFloor ? retentionFloor : f;
      };
      let floor: string;
      if (days.length > 0) {
        const r = await this.consolidate(days, floorOf);
        if (r.failedGroups > 0) return 'failed';
        floor = floorOf(r.firstData);
      } else {
        floor = retentionFloor;
      }
      const next = addDays(start, -FEATURE_USAGE_BACKFILL_STEP_DAYS);
      if (next < floor) {
        await state.markBackfillCompleted({ completedAt: now, backfilledFrom: floor });
        this.log.info({ backfilledFrom: floor }, 'feature usage backfill completed');
        return 'completed';
      }
      await state.saveBackfillCursor(next);
      return 'step';
    } finally {
      this.held.delete(FEATURE_USAGE_BACKFILL_LEASE);
      await lease.release(FEATURE_USAGE_BACKFILL_LEASE, this.ownerId);
    }
  }

  /** Apaga `day < hoje − 400`, 1×/24 h no cluster. */
  private async retention(today: string, now: Date): Promise<number | null> {
    const until = new Date(now.getTime() + FEATURE_USAGE_RETENTION_LEASE_TTL_MS);
    if (!(await this.deps.lease.tryAcquire(FEATURE_USAGE_RETENTION_LEASE, this.ownerId, until, now))) return null;
    try {
      return await this.deps.daily.purgeBefore(addDays(today, -FEATURE_USAGE_RETENTION_DAYS));
    } catch (err) {
      this.log.warn({ err: (err as Error)?.name }, 'feature usage retention failed');
      return null;
    }
  }
}
