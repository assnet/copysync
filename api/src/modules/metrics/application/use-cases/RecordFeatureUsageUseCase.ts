import { logger } from '../../../../shared/logger/logger';
import type { IFeatureUsageDailyRepository } from '../../domain/contracts/IFeatureUsageDailyRepository';
import type { FeatureUsageEvent, IFeatureUsageRecorder } from '../../domain/contracts/IFeatureUsageRecorder';
import { FEATURE_USAGE_CATALOG, type FeatureUsageDefinition, findFeature, sourceOn } from '../../domain/services/featureUsageCatalog';
import { dayInZone } from '../../domain/services/featureUsagePeriod';

export interface RecordFeatureUsageDeps {
  daily: Pick<IFeatureUsageDailyRepository, 'increment' | 'markOnce'>;
  catalog?: readonly FeatureUsageDefinition[];
  log?: { warn(obj: object, msg: string): void };
}

/**
 * Contador de uso (design §4.5): grava no agregado diário só o que é do contador naquele dia — recurso do catálogo
 * cuja fonte no dia de Brasília de `at` é `RECORDED` (antes da data de corte quem conta é a fonte viva, e o rollup
 * nunca grava esse dia). Fail-open: nunca rejeita; falha do banco vira log `warn` sem conta nem conteúdo.
 */
export class RecordFeatureUsageUseCase implements IFeatureUsageRecorder {
  constructor(private readonly deps: RecordFeatureUsageDeps) {}

  increment(event: FeatureUsageEvent): Promise<void> {
    return this.write('increment', event);
  }

  markOnce(event: FeatureUsageEvent): Promise<void> {
    return this.write('markOnce', event);
  }

  /** `true` quando o dia de Brasília de `at` é do contador para a chave. */
  counts(event: Pick<FeatureUsageEvent, 'featureKey' | 'at'>): boolean {
    const feature = findFeature(event.featureKey, this.deps.catalog ?? FEATURE_USAGE_CATALOG);
    return !!feature && sourceOn(feature, dayInZone(event.at)) === 'RECORDED';
  }

  private async write(op: 'increment' | 'markOnce', event: FeatureUsageEvent): Promise<void> {
    try {
      if (!this.counts(event)) return;
      await this.deps.daily[op]({ tenantId: event.tenantId, featureKey: event.featureKey, kind: event.kind, at: event.at });
    } catch (err) {
      (this.deps.log ?? logger).warn({ err: (err as Error)?.name, featureKey: event.featureKey }, 'feature usage count failed');
    }
  }
}
