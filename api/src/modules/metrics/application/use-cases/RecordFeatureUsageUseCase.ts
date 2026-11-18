import { logger } from '../../../../shared/logger/logger';
import type { IFeatureUsageDailyRepository } from '../../domain/contracts/IFeatureUsageDailyRepository';
import type { FeatureUsageEvent, IFeatureUsageRecorder } from '../../domain/contracts/IFeatureUsageRecorder';
import type { IFeatureUsageCutoverStore } from '../../domain/contracts/IFeatureUsageRollupStateRepository';
import { FEATURE_USAGE_CATALOG, type FeatureUsageDefinition, findFeature } from '../../domain/services/featureUsageCatalog';
import { addDays, dayInZone } from '../../domain/services/featureUsagePeriod';

export interface RecordFeatureUsageDeps {
  daily: Pick<IFeatureUsageDailyRepository, 'increment' | 'markOnce'>;
  /** Corte dos recursos `CUTOVER` em `platform_settings` (gravado uma vez, na primeira escrita). */
  cutovers: IFeatureUsageCutoverStore;
  catalog?: readonly FeatureUsageDefinition[];
  log?: { warn(obj: object, msg: string): void };
}

/**
 * Contador de uso (design §4.5): grava no agregado diário só o que é do contador.
 * - `FIRST_WRITE` (sem fonte anterior, ex.: `chat_send`): conta sempre, desde a primeira escrita.
 * - `CUTOVER` (fonte viva anterior, ex.: `offer_story`): a primeira escrita grava, uma única vez e de forma atômica,
 *   o corte = dia seguinte (Brasília) ao dia dela; só conta dia ≥ corte. O dia da primeira escrita (parcial) fica
 *   com a fonte viva, e o rollup nunca grava dia ≥ corte.
 * - Recurso sem contador ou fora do catálogo: não grava.
 * O corte gravado nunca muda: depois de lido fica em memória (cache de valor imutável, não estado operacional).
 * Fail-open: nunca rejeita; falha do banco vira log `warn` sem conta nem conteúdo.
 */
export class RecordFeatureUsageUseCase implements IFeatureUsageRecorder {
  private readonly cutoverCache = new Map<string, string>();

  constructor(private readonly deps: RecordFeatureUsageDeps) {}

  increment(event: FeatureUsageEvent): Promise<void> {
    return this.write('increment', event);
  }

  markOnce(event: FeatureUsageEvent): Promise<void> {
    return this.write('markOnce', event);
  }

  /** `true` quando o dia de Brasília de `at` é do contador para a chave (pode gravar o corte). */
  private async counts(event: Pick<FeatureUsageEvent, 'featureKey' | 'at'>): Promise<boolean> {
    const feature = findFeature(event.featureKey, this.deps.catalog ?? FEATURE_USAGE_CATALOG);
    if (!feature?.recordedFrom) return false;
    if (feature.recordedFrom === 'FIRST_WRITE') return true;
    const day = dayInZone(event.at);
    let cut = this.cutoverCache.get(feature.key);
    if (cut === undefined) {
      cut = await this.deps.cutovers.claimCutover(feature.key, addDays(day, 1));
      this.cutoverCache.set(feature.key, cut);
    }
    return day >= cut;
  }

  private async write(op: 'increment' | 'markOnce', event: FeatureUsageEvent): Promise<void> {
    try {
      if (!(await this.counts(event))) return;
      await this.deps.daily[op]({ tenantId: event.tenantId, featureKey: event.featureKey, kind: event.kind, at: event.at });
    } catch (err) {
      (this.deps.log ?? logger).warn({ err: (err as Error)?.name, featureKey: event.featureKey }, 'feature usage count failed');
    }
  }
}
