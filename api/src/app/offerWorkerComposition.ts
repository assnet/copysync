import type {
  OfferDispatchWorkerOptions,
  OfferWorkerRunContext,
  OfferWorkerStage,
} from '../modules/campaigns/infrastructure/worker/OfferDispatchWorker';
import type { ProcessJob } from './processJobs';
import { mediaDrainBudgetMs } from './shutdownBudget';

/**
 * Composição do worker de ofertas (envio do gerador + capturas do monitoramento), pura para teste
 * sem servidor/engine/banco (.specs/features/monitoring-queue-isolation, T4).
 *
 * - Papel: só onde `jobsFor` inclui `offerDispatch` (`http` nunca).
 * - `independentStages` false: tick sequencial de hoje (envio, depois capturas), sem sinal.
 * - true: uma etapa por flag ligada, cada uma no seu slot, repassando o `ctx` (sinal de parada).
 */
export interface OfferWorkerFlags {
  offerDispatch: boolean;
  groupMonitoring: boolean;
  independentStages: boolean;
}

interface Runnable {
  execute(ctx?: { signal?: AbortSignal }): Promise<{ processed: number }>;
}

export interface OfferWorkerRunners {
  /** Factories lazy: o container só é tocado quando a etapa roda. */
  offerDispatch: () => Runnable;
  groupMonitoring: () => Runnable;
}

export const OFFER_STAGE_DISPATCH = 'offer-dispatch';
export const OFFER_STAGE_MONITORING = 'group-monitoring';

export interface OfferWorkerCompositionInput {
  jobs: ReadonlySet<ProcessJob>;
  flags: OfferWorkerFlags;
  runners: OfferWorkerRunners;
  /** Erro de uma parte no modo legado (o modo etapas loga no próprio worker). */
  onLegacyPartError: (part: string, err: unknown) => void;
}

/** `null` = não criar worker (papel sem o job ou as duas flags desligadas). */
export function buildOfferWorkerOptions(input: OfferWorkerCompositionInput): OfferDispatchWorkerOptions | null {
  const { jobs, flags, runners, onLegacyPartError } = input;
  if (!jobs.has('offerDispatch')) return null;
  if (!flags.offerDispatch && !flags.groupMonitoring) return null;

  if (!flags.independentStages) {
    const safe = async (name: string, run: () => Promise<{ processed: number }>) => {
      try {
        return (await run()).processed;
      } catch (err) {
        onLegacyPartError(name, err);
        return 0;
      }
    };
    return {
      tick: () => ({
        execute: async () => ({
          processed:
            (flags.offerDispatch ? await safe(OFFER_STAGE_DISPATCH, () => runners.offerDispatch().execute()) : 0)
            + (flags.groupMonitoring ? await safe(OFFER_STAGE_MONITORING, () => runners.groupMonitoring().execute()) : 0),
        }),
      }),
    };
  }

  const stages: OfferWorkerStage[] = [];
  if (flags.offerDispatch) {
    stages.push({ name: OFFER_STAGE_DISPATCH, run: (ctx: OfferWorkerRunContext) => runners.offerDispatch().execute(ctx) });
  }
  if (flags.groupMonitoring) {
    stages.push({ name: OFFER_STAGE_MONITORING, run: (ctx: OfferWorkerRunContext) => runners.groupMonitoring().execute(ctx) });
  }
  return { stages };
}

/**
 * Opções do `stop()` no shutdown. Etapas: teto = orçamento restante até a reserva final de
 * sockets/flush/leases (`mediaDrainBudgetMs`, já descontado o tempo de keeper/adoção). Legado: `{}`
 * (teto próprio de 10 s, como hoje).
 */
export function offerWorkerStopOptions(independentStages: boolean, elapsedMs: number): { timeoutMs?: number } {
  return independentStages ? { timeoutMs: mediaDrainBudgetMs(elapsedMs) } : {};
}
