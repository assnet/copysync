import { randomUUID } from 'node:crypto';
import type { IJobLease, IJobLeaseRenewal } from '../../../../shared/jobs/IJobLease';
import { logger } from '../../../../shared/logger/logger';
import type { FeatureUsageDayRow, IFeatureUsageDailyRepository } from '../../domain/contracts/IFeatureUsageDailyRepository';
import type { IFeatureUsageReader } from '../../domain/contracts/IFeatureUsageReader';
import {
  type FeatureUsageBackfillStopReason,
  type FeatureUsageGroupState,
  type FeatureUsageRetryItem,
  type FeatureUsageRollupState,
  type FeatureUsageTickPatch,
  type IFeatureUsageRollupStateRepository,
  featureUsageGroupId,
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
/** A partir de tantas falhas seguidas (do grupo ou do tick): log `error`. Backfill do grupo: pode ficar pendente. */
export const FEATURE_USAGE_FAILURE_STREAK_ALERT = 3;
/**
 * Teto da lista de reprocesso (dia, grupo); cheia, o item mais antigo sai com log `error` e vira piso de reprocesso do
 * grupo (`reprocessFrom`), recalculado 1 dia por tick até a faixa da revisita.
 */
export const FEATURE_USAGE_RETRY_MAX = 30;
/**
 * Revisita leve: a cada tick recalcula UM dia antigo, em rodízio de hoje − 2 até hoje − 30. Premissa: o dado das
 * fontes chega até D+2 (ontem é sempre recalculado e anteontem fecha a janela); o que chegar depois disso é
 * exceção, e a revisita pega e loga `warn` quando o número do dia muda.
 */
export const FEATURE_USAGE_REVISIT_DAYS = 30;

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
  daily: Pick<IFeatureUsageDailyRepository, 'replaceDay' | 'purgeBefore' | 'dayTotals'>;
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
      /** Grupos com falha na janela recente neste tick. */
      failedGroups: number;
      backfill: FeatureUsageBackfillOutcome;
      purged: number | null;
      /** Janela recente lida neste tick. */
      window: { from: string; to: string };
      /** Dias da janela com falha em algum grupo. */
      failedDays: string[];
      failureStreak: number;
      /** Itens (dia, grupo) na lista de reprocesso ao fim do tick. */
      retryQueue: number;
      /** Dia antigo revisitado neste tick (`null` = nenhum). */
      revisited: string | null;
      /** Dias recalculados pelo piso de reprocesso neste tick (1 por grupo com piso). */
      reprocessed: number;
    };

/** Perdeu o lease no meio do tick (renovação recusada): nada mais é lido nem gravado. */
export class FeatureUsageRollupLeaseLostError extends Error {
  constructor(readonly lease: string) {
    super(`feature usage rollup lost lease ${lease}`);
    this.name = 'FeatureUsageRollupLeaseLostError';
  }
}

/** Resultado de um grupo em um conjunto de dias. */
type GroupRun = {
  /** Dias com falha (leitura que falhou = todos os dias pedidos). */
  failedDays: string[];
  /** Primeiro dado das fontes do grupo (backfill). */
  firstData: string | null;
  /** Soma gravada por dia × chave (revisita). */
  totals: Map<string, Record<string, number>>;
};

const emptyGroup = (): FeatureUsageGroupState => ({
  failureStreak: 0,
  lastSuccessAt: null,
  backfillCursor: null,
  backfillDone: null,
  backfillFailures: 0,
  reprocessFrom: null,
});

/**
 * Consolidação diária do uso (design §4.4, USAGE-18/20). Uma execução por tick do job, sob o lease
 * `feature-usage-rollup` (sem ele não lê nem grava). Cada grupo de fontes anda sozinho: erro persistente num grupo
 * não trava o marco, o frescor nem o backfill dos outros.
 * 1. reprocessa a lista (dia, grupo) que falhou antes (no máximo 30 itens, em `platform_settings`);
 * 2. recalcula a janela recente (`recentWindow`: de `finalizedThrough + 1` até hoje, ≤ 7 dias) grupo a grupo.
 *    `finalizedThrough` anda pelos dias concluídos (nunca além de anteontem: ontem é sempre revisitado) se algum
 *    grupo deu certo; o (dia, grupo) que falhou e fica para trás entra no reprocesso. `failureStreak` por grupo,
 *    log `error` a partir de 3;
 * 3. revisita leve: um dia antigo por tick, em rodízio dentro dos últimos 30 dias, com `warn` se o número mudou; e
 *    piso de reprocesso (`groups[].reprocessFrom`, item descartado do reprocesso cheio): 1 dia por tick e grupo, do
 *    piso para frente até a faixa da revisita;
 * 4. backfill (lease próprio) com cursor por grupo, 7 dias por passo até o primeiro dado do grupo (limitado à
 *    retenção). O marco é gravado quando todos os grupos concluíram ou os que falham 3+ vezes seguidas ficam
 *    registrados como pendentes (`backfillPendingKeys`): a leitura trata os recursos deles como não cobertos;
 * 5. retenção de 400 dias, 1×/24 h (lease que não é solto).
 * Frescor: `groups[].lastSuccessAt` quando a janela do grupo chegou a hoje sem falha, o grupo não tem item pendente no
 * reprocesso e o backfill dele não falhou;
 * `lastSuccessAt` (global) só quando o tick inteiro concluiu (nenhum grupo falho na janela e backfill não `failed`).
 * Nunca grava recurso `RECORDED` nem dia a partir do corte gravado pelo contador: os cortes são relidos antes de cada
 * gravação e o `replaceDay` ainda confere o corte no SQL, na mesma transação.
 */
export class RollupFeatureUsageUseCase {
  private readonly ownerId: string;
  private readonly catalog: readonly FeatureUsageDefinition[];
  private readonly groups: readonly (readonly string[])[];
  private readonly log: RollupLogger;
  /** Leases detidos agora (renovados entre grupos de fonte). */
  private readonly held = new Set<string>();
  /** Cortes em vigor: relidos antes de cada gravação de dia. */
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

  private alert(obj: object, msg: string): void {
    if (this.log.error) this.log.error(obj, msg);
    else this.log.warn(obj, msg);
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
    const retentionFloor = addDays(today, -FEATURE_USAGE_RETENTION_DAYS);
    const window = recentWindow(st.finalizedThrough, today);
    const windowLast = window[window.length - 1]!;
    const byId = new Map(this.groups.map((g) => [featureUsageGroupId(g), g]));
    // Só os grupos da configuração atual (grupo que saiu do código some do estado)
    const groups: Record<string, FeatureUsageGroupState> = {};
    for (const id of byId.keys()) groups[id] = { ...emptyGroup(), ...(st.groups?.[id] ?? {}) };
    const failedNow = new Set<string>();

    // 1. Reprocesso: dia dentro da janela sai (a janela recalcula); grupo que saiu da configuração também
    const keep: FeatureUsageRetryItem[] = [];
    for (const item of st.retryQueue ?? []) {
      const group = byId.get(item.group);
      if (!group || item.day < retentionFloor || window.includes(item.day)) continue;
      const r = await this.consolidateGroup(group, [item.day], null);
      if (r.failedDays.length > 0) {
        keep.push(item);
        failedNow.add(item.group);
      }
    }

    // 2. Janela recente, grupo a grupo
    const failedDays = new Set<string>();
    const windowFailed: FeatureUsageRetryItem[] = [];
    let okGroups = 0;
    const recentFailed = new Set<string>();
    for (const [id, group] of byId) {
      const r = await this.consolidateGroup(group, window, null);
      if (r.failedDays.length === 0) {
        okGroups++;
        continue;
      }
      recentFailed.add(id);
      failedNow.add(id);
      for (const d of r.failedDays) {
        failedDays.add(d);
        windowFailed.push({ day: d, group: id });
      }
    }

    // Marca: anda pelos dias concluídos se algum grupo deu certo (todos falhando = falha geral, nada anda)
    const patch: FeatureUsageTickPatch = { failureStreak: 0 };
    const cap = addDays(today, -2);
    let finalized = st.finalizedThrough;
    if (okGroups > 0 || byId.size === 0) {
      const next = windowLast < cap ? windowLast : cap;
      if (!finalized || next > finalized) {
        patch.finalizedThrough = next;
        finalized = next;
      }
    }
    // (dia, grupo) que ficou para trás da marca vai ao reprocesso; o resto a próxima janela recalcula
    const queue = this.mergeQueue(
      keep,
      windowFailed.filter((i) => finalized !== null && i.day <= finalized),
      groups,
    );

    // 3. Revisita leve de um dia finalizado em tick anterior
    const revisit = await this.revisit(today, st.finalizedThrough, st.revisitCursor ?? null, byId);
    if (revisit.next) patch.revisitCursor = revisit.next;

    // 3b. Piso de reprocesso (item descartado do reprocesso cheio): 1 dia por tick e grupo, até a faixa da revisita
    let reprocessed = 0;
    const revisitFloor = addDays(today, -FEATURE_USAGE_REVISIT_DAYS);
    for (const [id, group] of byId) {
      const g = groups[id]!;
      if (!g.reprocessFrom) continue;
      const day = g.reprocessFrom < retentionFloor ? retentionFloor : g.reprocessFrom;
      if (day >= revisitFloor || !finalized || day > finalized) {
        g.reprocessFrom = null;
        continue;
      }
      const r = await this.consolidateGroup(group, [day], null);
      if (r.failedDays.length > 0) {
        failedNow.add(id);
        continue;
      }
      reprocessed++;
      const next = addDays(day, 1);
      g.reprocessFrom = next >= revisitFloor || next > finalized ? null : next;
    }

    // 4. Backfill por grupo
    const backfill = await this.backfillStep(today, now, groups, byId, patch);
    const purged = await this.retention(today, now);

    // Estado por grupo
    for (const [id, g] of Object.entries(groups)) {
      if (failedNow.has(id)) g.failureStreak += 1;
      else g.failureStreak = 0;
      // Fresco só sem falha na janela, sem (dia, grupo) pendente no reprocesso e sem falha no backfill do grupo
      const pending = queue.some((i) => i.group === id);
      const backfillFailed = backfill.failedGroups.has(id);
      if (!recentFailed.has(id) && !pending && !backfillFailed && windowLast === today) g.lastSuccessAt = now;
      if (g.failureStreak >= FEATURE_USAGE_FAILURE_STREAK_ALERT) {
        this.alert(
          { group: id, failureStreak: g.failureStreak, days: queue.filter((i) => i.group === id).map((i) => i.day) },
          'feature usage rollup group failing repeatedly',
        );
      }
    }

    const failed = failedNow.size > 0 || backfill.outcome === 'failed';
    const failureStreak = failed ? st.failureStreak + 1 : 0;
    if (failureStreak >= FEATURE_USAGE_FAILURE_STREAK_ALERT) {
      this.alert(
        { failureStreak, failedGroups: [...failedNow], failedDays: [...failedDays].sort(), backfill: backfill.outcome, window: { from: window[0], to: windowLast } },
        'feature usage rollup failing repeatedly',
      );
    }
    patch.failureStreak = failureStreak;
    patch.groups = groups;
    patch.retryQueue = queue;
    // Fresco (global) só quando o tick inteiro concluiu: nenhum grupo falho na janela, backfill não falhou e a janela
    // chegou a hoje. A leitura usa o frescor por grupo; este é o de estado antigo sem grupos
    if (recentFailed.size === 0 && backfill.outcome !== 'failed' && windowLast === today) {
      patch.lastSuccessAt = now;
      // Primeiro tick inteiro: daqui em diante o dia é consolidado ao vivo (antes, só o que o backfill achou)
      if (!st.liveSince) patch.liveSince = today;
    }
    await this.keepAlive();
    await this.deps.state.recordTick(patch);
    return {
      status: 'ran',
      failedGroups: recentFailed.size,
      backfill: backfill.outcome,
      purged,
      window: { from: window[0]!, to: windowLast },
      failedDays: [...failedDays].sort(),
      failureStreak,
      retryQueue: queue.length,
      revisited: revisit.day,
      reprocessed,
    };
  }

  /**
   * Une sem repetir, em ordem de dia; acima de 30 itens os mais antigos saem com log `error` e o menor dia descartado
   * de cada grupo vira o piso de reprocesso dele (`reprocessFrom`): o dia pode estar abaixo da faixa da revisita.
   */
  private mergeQueue(
    a: readonly FeatureUsageRetryItem[],
    b: readonly FeatureUsageRetryItem[],
    groups: Record<string, FeatureUsageGroupState>,
  ): FeatureUsageRetryItem[] {
    const seen = new Set<string>();
    const all: FeatureUsageRetryItem[] = [];
    for (const i of [...a, ...b]) {
      const id = `${i.day}|${i.group}`;
      if (seen.has(id)) continue;
      seen.add(id);
      all.push(i);
    }
    all.sort((x, y) => (x.day < y.day ? -1 : x.day > y.day ? 1 : x.group < y.group ? -1 : 1));
    if (all.length <= FEATURE_USAGE_RETRY_MAX) return all;
    const dropped = all.slice(0, all.length - FEATURE_USAGE_RETRY_MAX);
    const floors: Record<string, string> = {};
    for (const i of dropped) {
      const g = groups[i.group];
      if (!g) continue;
      if (!g.reprocessFrom || i.day < g.reprocessFrom) g.reprocessFrom = i.day;
      floors[i.group] = g.reprocessFrom;
    }
    this.alert({ dropped: dropped.length, oldest: dropped[0]!.day, reprocessFrom: floors }, 'feature usage rollup retry queue full, oldest dropped');
    return all.slice(-FEATURE_USAGE_RETRY_MAX);
  }

  /**
   * Lê o grupo uma vez para os dias pedidos (crescentes e contíguos) e regrava dia a dia só as chaves permitidas. Os
   * cortes são relidos antes de cada gravação (corte gravado no meio do tick não grava em dobro). `floorOf`
   * (backfill) dá o primeiro dia a gravar a partir do primeiro dado do grupo.
   */
  private async consolidateGroup(
    group: readonly string[],
    days: readonly string[],
    floorOf: ((first: string | null) => string) | null,
  ): Promise<GroupRun> {
    const first = days[0]!;
    const last = days[days.length - 1]!;
    const out: GroupRun = { failedDays: [], firstData: null, totals: new Map() };
    const keys = group.filter((k) => days.some((d) => this.writable(k, d)));
    if (keys.length === 0) return out;
    await this.keepAlive();
    let rows: FeatureUsageRow[];
    try {
      const r = await this.deps.reader.read({
        from: startOfDayInstant(first),
        toExclusive: startOfDayInstant(addDays(last, 1)),
        featureKeys: keys as FeatureUsageKey[],
        granularity: 'day',
        budget: this.deps.newBudget(),
      });
      rows = r.rows;
      const firstDataDay = r.firstDataDay as Record<string, string | null | undefined>;
      for (const k of keys) {
        const d = firstDataDay[k];
        if (d && (out.firstData === null || d < out.firstData)) out.firstData = d;
      }
    } catch (err) {
      this.log.warn({ keys, from: first, to: last, err: (err as Error)?.name }, 'feature usage rollup source failed');
      out.failedDays.push(...days);
      return out;
    }

    const floor = floorOf ? floorOf(out.firstData) : null;
    for (const day of days) {
      if (floor !== null && day < floor) continue;
      await this.keepAlive();
      try {
        // Corte relido antes de cada gravação; o `replaceDay` confere de novo no SQL, na transação
        this.cutovers = (await this.deps.state.get()).cutovers;
        const dayKeys = keys.filter((k) => this.writable(k, day));
        if (dayKeys.length === 0) continue;
        const allowed = new Set(dayKeys);
        const dayRows: FeatureUsageDayRow[] = [];
        const totals: Record<string, number> = Object.fromEntries(dayKeys.map((k) => [k, 0]));
        for (const r of rows) {
          if (r.day !== day || !allowed.has(r.featureKey)) continue;
          dayRows.push({ tenantId: r.tenantId, featureKey: r.featureKey, kind: r.kind, uses: r.uses });
          totals[r.featureKey] = (totals[r.featureKey] ?? 0) + (r.uses > 0 ? Math.trunc(r.uses) : 0);
        }
        await this.deps.daily.replaceDay(day, dayKeys, dayRows);
        out.totals.set(day, totals);
      } catch (err) {
        if (err instanceof FeatureUsageRollupLeaseLostError) throw err;
        out.failedDays.push(day);
        this.log.warn({ day, keys, err: (err as Error)?.name }, 'feature usage rollup day write failed');
      }
    }
    return out;
  }

  /**
   * Revisita um dia já finalizado (≤ `finalizedThrough`, entre hoje − 30 e hoje − 2), em rodízio para trás: recalcula
   * cada grupo e loga `warn` se a soma gravada mudou (dado que chegou depois de D+2). Falha só vai ao log.
   */
  private async revisit(
    today: string,
    finalized: string | null,
    cursor: string | null,
    byId: ReadonlyMap<string, readonly string[]>,
  ): Promise<{ day: string | null; next: string | undefined }> {
    const hi = addDays(today, -2);
    const lo = addDays(today, -FEATURE_USAGE_REVISIT_DAYS);
    const day = cursor && cursor >= lo && cursor <= hi ? cursor : hi;
    if (!finalized || day > finalized || byId.size === 0) return { day: null, next: undefined };
    const changed: { keys: string[]; before: Record<string, number>; after: Record<string, number> }[] = [];
    for (const group of byId.values()) {
      const keys = group.filter((k) => this.writable(k, day));
      if (keys.length === 0) continue;
      let before: Record<string, number>;
      try {
        await this.keepAlive();
        before = await this.deps.daily.dayTotals(day, keys);
      } catch (err) {
        if (err instanceof FeatureUsageRollupLeaseLostError) throw err;
        this.log.warn({ day, keys, err: (err as Error)?.name }, 'feature usage rollup revisit read failed');
        continue;
      }
      const r = await this.consolidateGroup(group, [day], null);
      const after = r.totals.get(day);
      if (!after) continue;
      if (keys.some((k) => (before[k] ?? 0) !== (after[k] ?? 0))) changed.push({ keys, before, after });
    }
    if (changed.length > 0) this.log.warn({ day, changed }, 'feature usage rollup revisit changed a finalized day');
    const next = addDays(day, -1);
    return { day, next: next < lo ? hi : next };
  }

  /**
   * Backfill por grupo (lease próprio): cada grupo anda 7 dias para trás a partir do seu cursor até o primeiro dado
   * dele (limitado à retenção). Grupo que falha não anda (o passo se repete, idempotente) e não segura os outros.
   * Marco: gravado uma vez quando todo grupo concluiu ou os que faltam falharam 3+ passos seguidos (ficam em
   * `backfillPendingKeys`, e continuam tentando; ao concluir saem de lá).
   */
  private async backfillStep(
    today: string,
    now: Date,
    groups: Record<string, FeatureUsageGroupState>,
    byId: ReadonlyMap<string, readonly string[]>,
    patch: FeatureUsageTickPatch,
  ): Promise<{ outcome: FeatureUsageBackfillOutcome; failedGroups: Set<string> }> {
    const { state, lease } = this.deps;
    const failedGroups = new Set<string>();
    const settled = (s: FeatureUsageRollupState) => !!s.backfillCompletedAt && (s.backfillPendingKeys ?? []).length === 0;
    if (settled(await state.get())) return { outcome: 'done', failedGroups };
    const until = new Date(now.getTime() + FEATURE_USAGE_BACKFILL_LEASE_TTL_MS);
    if (!(await lease.tryAcquire(FEATURE_USAGE_BACKFILL_LEASE, this.ownerId, until, now))) return { outcome: 'busy', failedGroups };
    this.held.add(FEATURE_USAGE_BACKFILL_LEASE);
    try {
      // Relido sob a trava: outro processo pode ter acabado de andar ou de terminar
      const current = await state.get();
      if (settled(current)) return { outcome: 'done', failedGroups };
      const marked = !!current.backfillCompletedAt;
      const pendingBefore = new Set(current.backfillPendingKeys ?? []);
      const retentionFloor = addDays(today, -FEATURE_USAGE_RETENTION_DAYS);
      // Sem dado nenhum: o agregado já cobre a partir de ontem (passo 1). Primeiro dado abaixo da retenção = parou
      // no teto (`RETENTION`); senão chegou ao primeiro dado (`FIRST_DATA`: antes dele nada existe)
      const floorOf = (first: string | null) => {
        const f = first ?? addDays(today, -1);
        return f < retentionFloor ? retentionFloor : f;
      };
      const reasonOf = (first: string | null): FeatureUsageBackfillStopReason =>
        first !== null && first < retentionFloor ? 'RETENTION' : 'FIRST_DATA';

      for (const [id, group] of byId) {
        const g = groups[id]!;
        if (g.backfillDone) continue;
        // Com marco gravado, só os grupos pendentes andam (estado antigo sem grupos já está coberto)
        if (marked && !group.some((k) => pendingBefore.has(k))) continue;
        // Hoje e ontem são do passo 1: o backfill começa anteontem. Cursor único legado só no estado antigo, sem
        // grupos; grupo novo num estado com grupos começa de anteontem (não herda o progresso dos outros)
        const legacy = current.groups === undefined ? current.backfillCursor : null;
        const start = g.backfillCursor ?? legacy ?? addDays(today, -2);
        const days: string[] = [];
        for (let i = FEATURE_USAGE_BACKFILL_STEP_DAYS - 1; i >= 0; i--) {
          const d = addDays(start, -i);
          if (d >= retentionFloor) days.push(d);
        }
        let floor: string;
        let reason: FeatureUsageBackfillStopReason;
        if (days.length > 0) {
          const r = await this.consolidateGroup(group, days, floorOf);
          if (r.failedDays.length > 0) {
            g.backfillFailures += 1;
            failedGroups.add(id);
            // Não anda, mas guarda o início (o cursor legado não se perde quando o estado ganha grupos)
            g.backfillCursor = start;
            continue;
          }
          floor = floorOf(r.firstData);
          reason = reasonOf(r.firstData);
        } else {
          floor = retentionFloor;
          reason = 'RETENTION';
        }
        g.backfillFailures = 0;
        const next = addDays(start, -FEATURE_USAGE_BACKFILL_STEP_DAYS);
        if (next < floor) {
          g.backfillDone = { from: floor, reason };
          g.backfillCursor = null;
        } else {
          g.backfillCursor = next;
        }
      }

      const ids = [...byId.keys()];
      const open = ids.filter((id) => !groups[id]!.backfillDone);
      const pendingKeys = open.flatMap((id) => [...byId.get(id)!]).sort();
      const failedOutcome: FeatureUsageBackfillOutcome = failedGroups.size > 0 ? 'failed' : 'step';
      if (marked) {
        patch.backfillPendingKeys = pendingKeys;
        if (pendingKeys.length === 0) {
          this.log.info({}, 'feature usage backfill pending groups completed');
          return { outcome: 'completed', failedGroups };
        }
        return { outcome: failedOutcome, failedGroups };
      }
      const done = ids.map((id) => groups[id]!.backfillDone).filter((d): d is NonNullable<typeof d> => d !== null);
      const stuck = open.every((id) => groups[id]!.backfillFailures >= FEATURE_USAGE_FAILURE_STREAK_ALERT);
      if (ids.length > 0 && done.length > 0 && stuck) {
        const retention = done.filter((d) => d.reason === 'RETENTION');
        const stopReason: FeatureUsageBackfillStopReason = retention.length > 0 ? 'RETENTION' : 'FIRST_DATA';
        // RETENTION: o maior início entre os que pararam no teto (conservador); FIRST_DATA: o menor primeiro dado
        const backfilledFrom = retention.length > 0
          ? retention.map((d) => d.from).sort().at(-1)!
          : done.map((d) => d.from).sort()[0]!;
        await state.markBackfillCompleted({ completedAt: now, backfilledFrom, stopReason, pendingKeys });
        const info = { backfilledFrom, stopReason, pendingKeys };
        if (pendingKeys.length > 0) this.alert(info, 'feature usage backfill completed with pending groups');
        else this.log.info(info, 'feature usage backfill completed');
        return { outcome: failedGroups.size > 0 ? 'failed' : 'completed', failedGroups };
      }
      if (ids.length === 0) {
        // Sem grupo `LIVE`: nada a consolidar
        await state.markBackfillCompleted({ completedAt: now, backfilledFrom: addDays(today, -1), stopReason: 'FIRST_DATA' });
        return { outcome: 'completed', failedGroups };
      }
      return { outcome: failedOutcome, failedGroups };
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
