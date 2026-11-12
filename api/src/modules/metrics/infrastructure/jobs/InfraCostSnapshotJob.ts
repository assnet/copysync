import { randomUUID } from 'node:crypto';
import type { IJobLease } from '../../../../shared/jobs/IJobLease';
import { logger } from '../../../../shared/logger/logger';
import {
  INFRA_COST_SNAPSHOT_RETENTION_DAYS,
  type IInfraCostSnapshotRepository,
  type InfraResourceHourSnapshot,
} from '../../domain/contracts/IInfraCostSnapshotRepository';
import type { IInfraCostLiveReader } from '../../domain/contracts/IInfraCostLiveReader';
import type { IInfraCostSettingsRepository } from '../../domain/contracts/IInfraCostSettingsRepository';
import type { IInfraFxFetchStateRepository } from '../../domain/contracts/IInfraFxFetchStateRepository';
import type {
  IInfraResourcePlanReader,
  InfraRenderUnavailableReason,
  InfraResourcePlanReading,
} from '../../domain/contracts/IInfraResourcePlanReader';
import type { IInfraTenantUsageReader } from '../../domain/contracts/IInfraTenantUsageReader';
import { fetchFirstFxRate, type IFxRateSource } from '../../domain/services/fxRate';
import { resolveInfraCostSettings } from '../../domain/services/infraCostSettings';
import { isFxFetchDue, startFxFetchAttempt } from '../../domain/services/infraFxFetchState';

export const INFRA_COST_SNAPSHOT_LEASE = 'infra-cost-snapshot';
export const INFRA_FX_RATE_LEASE = 'infra-fx-rate';
export const INFRA_COST_BUILD_LEASE = 'infra-cost-build';
export const INFRA_COST_RETENTION_LEASE = 'infra-cost-retention';
export const INFRA_COST_SNAPSHOT_TICK_MS = 5 * 60_000;
/** < tick: o dono readquire no tick seguinte (`PrismaJobLease` só pega lease vencido). Solto no `stop()`. */
export const INFRA_COST_SNAPSHOT_LEASE_TTL_MS = 4 * 60_000;
/** Trava da busca da cotação (concorrência); a frequência vem do estado em `platform_settings`. */
export const INFRA_FX_RATE_LEASE_TTL_MS = 10 * 60_000;
/** Build do dia anterior sai a partir de 01:00 UTC (deploys da virada já terminados). */
export const INFRA_COST_BUILD_AFTER_UTC_HOUR = 1;
/** Falha na leitura dos deploys: nova tentativa 1 h depois (o lease não é solto). */
export const INFRA_COST_BUILD_RETRY_MS = 3_600_000;
export const INFRA_COST_RETENTION_LEASE_TTL_MS = 24 * 3_600_000;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const floorHour = (d: Date) => new Date(Math.floor(d.getTime() / HOUR_MS) * HOUR_MS);
const floorDay = (d: Date) => new Date(Math.floor(d.getTime() / DAY_MS) * DAY_MS);

export interface InfraCostSnapshotJobOptions {
  lease: IJobLease;
  snapshots: IInfraCostSnapshotRepository;
  /** Render (plano, instâncias, disco, banda, deploys); `NotConfigured…` sem chave/ids. */
  plans: IInfraResourcePlanReader;
  /** Instâncias do worker pelas amostras da hora (fonte principal; Render é o fallback). */
  live: Pick<IInfraCostLiveReader, 'workerInstancesInHour'>;
  tenants: IInfraTenantUsageReader;
  /** `fx.auto` lido a cada tick. */
  settings: IInfraCostSettingsRepository;
  /** PTAX → SGS. */
  fxSources: readonly IFxRateSource[];
  fxState: IInfraFxFetchStateRepository;
  intervalMs?: number;
  now?: () => Date;
}

/**
 * Snapshot horário dos custos (COST-09/10), só no `worker`/`all` e com `INFRA_COST_SNAPSHOT_ENABLED`.
 * Tick de 5 min (`unref`) sob o lease `infra-cost-snapshot`; cada tick:
 * 1. **Hora fechada** `H = hora cheia anterior`: se `infra_resource_hours` ainda não tem `H`, lê os tenants
 *    (sessão-hora e contratadas), a Render (plano, instâncias, disco de cada recurso; banda de `[H−1h, H)`,
 *    hora fechada há mais de 1 h) e as amostras do worker; renova o lease e grava sessão-hora → banda →
 *    recursos (por último: é a marca de "hora feita"). Qualquer recurso indisponível → hora sem linha, `warn`
 *    uma vez por sequência, tenta de novo no próximo tick; banda indisponível não segura a hora.
 * 2. **Build** do dia anterior, 1×/dia após 01:00 UTC (lease `infra-cost-build` até 01:00 do dia seguinte;
 *    falha = nova tentativa 1 h depois).
 * 3. **Cotação** com `fx.auto` (lease `infra-fx-rate`, estado em `platform_settings["infra_fx_fetch_state"]`):
 *    1×/dia após 16h30 UTC, PTAX → SGS, as duas falhando = 1 nova tentativa 1 h depois.
 * 4. **Retenção** de 400 dias, 1×/24 h (lease `infra-cost-retention`, não solto).
 * Tudo idempotente no banco (troca de dono não dobra). Memória só para não repetir `warn`. Nunca lança.
 */
export class InfraCostSnapshotJob {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private abort: AbortController | null = null;
  private stopped = false;
  /** Só para o log: motivo da falha em curso da Render (um `warn` por sequência). */
  private renderFailure: string | null = null;
  private readonly ownerId = randomUUID();
  private readonly log = logger.child({ module: 'InfraCostSnapshotJob' });

  constructor(private readonly options: InfraCostSnapshotJobOptions) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => void this.runTick(), this.options.intervalMs ?? INFRA_COST_SNAPSHOT_TICK_MS);
    this.timer.unref();
  }

  /** Para o timer, cancela a cotação em voo, espera o tick e solta o lease. Nunca lança. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.abort?.abort();
    await this.running?.catch(() => undefined);
    try {
      await this.options.lease.release(INFRA_COST_SNAPSHOT_LEASE, this.ownerId);
    } catch (err) {
      this.log.warn({ err: (err as Error)?.name }, 'infra cost lease release failed');
    }
  }

  /** Exposto para teste; nunca lança. */
  runTick(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.tickOnce()
      .catch((err) => this.log.warn({ err: (err as Error)?.name }, 'infra cost tick failed'))
      .finally(() => {
        this.running = null;
        this.abort = null;
      });
    return this.running;
  }

  private async tickOnce(): Promise<void> {
    if (this.stopped) return;
    const now = this.now();
    const until = new Date(now.getTime() + INFRA_COST_SNAPSHOT_LEASE_TTL_MS);
    if (!(await this.options.lease.tryAcquire(INFRA_COST_SNAPSHOT_LEASE, this.ownerId, until, now))) return;
    this.abort = new AbortController();
    const steps: [string, () => Promise<void>][] = [
      ['hour', () => this.snapshotHour(new Date(floorHour(now).getTime() - HOUR_MS))],
      ['build', () => this.buildMinutes(now)],
      ['fx', () => this.fxRate(now)],
      ['retention', () => this.retention(now)],
    ];
    for (const [step, run] of steps) {
      if (this.stopped) return;
      try {
        await run();
      } catch (err) {
        this.log.warn({ step, err: (err as Error)?.name }, 'infra cost step failed');
      }
    }
  }

  /** Renova o lease antes de gravar (o tick pode ter passado do TTL). Perdeu = não grava. */
  private async renewLease(): Promise<boolean> {
    const { lease } = this.options;
    try {
      await lease.release(INFRA_COST_SNAPSHOT_LEASE, this.ownerId);
      const now = this.now();
      return await lease.tryAcquire(INFRA_COST_SNAPSHOT_LEASE, this.ownerId, new Date(now.getTime() + INFRA_COST_SNAPSHOT_LEASE_TTL_MS), now);
    } catch (err) {
      this.log.warn({ err: (err as Error)?.name }, 'infra cost lease renew failed');
      return false;
    }
  }

  private async snapshotHour(hour: Date): Promise<void> {
    const { snapshots, plans, live, tenants } = this.options;
    if (await snapshots.hasResourceHour(hour)) return;
    const keys = plans.configuredKeys();
    const sessionSamples = await tenants.readHour();

    let failure: InfraRenderUnavailableReason | null = keys.length === 0 ? 'not_configured' : null;
    const readings: InfraResourcePlanReading[] = [];
    for (const key of keys) {
      const r = await plans.readResource(key);
      if (r.status !== 'ok') {
        failure = r.reason;
        break;
      }
      readings.push(r.reading);
    }
    const bandwidth = failure ? null : await plans.readBandwidthGb(new Date(hour.getTime() - HOUR_MS), hour);
    let workerSamples: number | null = null;
    if (!failure && keys.includes('worker')) {
      try {
        workerSamples = await live.workerInstancesInHour(hour, new Date(hour.getTime() + HOUR_MS));
      } catch (err) {
        this.log.warn({ err: (err as Error)?.name }, 'infra cost worker samples read failed, render fallback');
      }
    }

    if (!(await this.renewLease())) {
      this.log.warn('infra cost lease lost before write, skipped');
      return;
    }
    await snapshots.addSessionHour(hour, sessionSamples);
    if (failure) {
      if (this.renderFailure !== failure) this.log.warn({ reason: failure }, 'infra cost hour without render reading');
      this.renderFailure = failure;
      return;
    }
    if (this.renderFailure) this.log.info('infra cost render reading back');
    this.renderFailure = null;

    if (bandwidth?.status === 'ok') {
      for (const [resourceKey, value] of Object.entries(bandwidth.byKey)) {
        if (value == null) continue;
        await snapshots.addUsageHour(new Date(hour.getTime() - HOUR_MS), {
          metric: 'bandwidth_gb', resourceKey: resourceKey as InfraResourceHourSnapshot['resourceKey'], value, source: 'render_metrics',
        });
      }
    } else if (bandwidth) {
      this.log.warn({ reason: bandwidth.reason }, 'infra cost bandwidth unavailable, hour skipped');
    }

    await snapshots.upsertResourceHours(readings.map((r): InfraResourceHourSnapshot => {
      const fromSamples = r.resourceKey === 'worker' && workerSamples !== null;
      return {
        hour,
        resourceKey: r.resourceKey,
        plan: r.plan,
        instances: fromSamples ? workerSamples! : r.instances ?? 1,
        instancesSource: fromSamples ? 'samples' : 'render',
        diskGb: r.diskGb === null ? null : Math.round(r.diskGb),
        suspended: r.suspended ?? false,
      };
    }));
  }

  /** Minutos de build do dia anterior (UTC), regravados 1×/dia. */
  private async buildMinutes(now: Date): Promise<void> {
    const { plans, lease, snapshots } = this.options;
    if (plans.configuredKeys().length === 0) return;
    const today = floorDay(now);
    const due = new Date(today.getTime() + INFRA_COST_BUILD_AFTER_UTC_HOUR * HOUR_MS);
    if (now < due) return;
    // 1ª trava curta: falha deixa vencer em 1 h; sucesso troca pela trava até 01:00 de amanhã
    if (!(await lease.tryAcquire(INFRA_COST_BUILD_LEASE, this.ownerId, new Date(now.getTime() + INFRA_COST_BUILD_RETRY_MS), now))) return;
    const day = new Date(today.getTime() - DAY_MS);
    const r = await plans.readBuildMinutes(day, today);
    if (r.status !== 'ok') {
      this.log.warn({ reason: r.reason }, 'infra cost build minutes unavailable, retry in 1 h');
      return;
    }
    for (const [resourceKey, value] of Object.entries(r.byKey)) {
      if (value == null) continue;
      await snapshots.upsertUsageDay({
        day, metric: 'build_minutes', resourceKey: resourceKey as InfraResourceHourSnapshot['resourceKey'], value, source: 'render_deploys',
      });
    }
    await lease.release(INFRA_COST_BUILD_LEASE, this.ownerId);
    await lease.tryAcquire(INFRA_COST_BUILD_LEASE, this.ownerId, new Date(due.getTime() + DAY_MS), now);
  }

  /** Cotação do dia (COST-06a), só com `fx.auto`. */
  private async fxRate(now: Date): Promise<void> {
    const { settings, fxState, lease, fxSources, snapshots } = this.options;
    if (!isFxFetchDue(await fxState.get(), now)) return;
    if (!resolveInfraCostSettings(await settings.get()).value.fx.auto) return;
    if (!(await lease.tryAcquire(INFRA_FX_RATE_LEASE, this.ownerId, new Date(now.getTime() + INFRA_FX_RATE_LEASE_TTL_MS), now))) return;
    try {
      // Relido sob a trava: outro processo pode ter acabado de buscar
      const state = await fxState.get();
      if (!isFxFetchDue(state, now)) return;
      const attempt = startFxFetchAttempt(state, now);
      await fxState.save(attempt);
      const fetched = await fetchFirstFxRate(fxSources, this.abort?.signal);
      if (!fetched) {
        this.log.warn({ attempts: attempt.attempts }, 'infra fx rate fetch failed, keeping last known');
        return;
      }
      await snapshots.upsertFxRate({
        referenceDate: new Date(`${fetched.referenceDate}T00:00:00Z`),
        rate: fetched.rate,
        source: fetched.source,
        fetchedAt: now,
      });
      await fxState.save({ ...attempt, ok: true });
    } finally {
      await lease.release(INFRA_FX_RATE_LEASE, this.ownerId);
    }
  }

  /** Apaga > 400 dias, 1×/24 h no cluster (lease não é solto: vence sozinho). */
  private async retention(now: Date): Promise<void> {
    const { lease, snapshots } = this.options;
    if (!(await lease.tryAcquire(INFRA_COST_RETENTION_LEASE, this.ownerId, new Date(now.getTime() + INFRA_COST_RETENTION_LEASE_TTL_MS), now))) return;
    const deleted = await snapshots.deleteOlderThan(new Date(now.getTime() - INFRA_COST_SNAPSHOT_RETENTION_DAYS * DAY_MS));
    this.log.debug({ deleted }, 'infra cost retention');
  }
}
