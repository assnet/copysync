import { logger } from '../../../../shared/logger/logger';
import { type IFeatureUsageRecorder, recordFeatureUsage } from '../../domain/contracts/IFeatureUsageRecorder';
import { findScreenView } from '../../domain/services/screenViewCatalog';

export interface RecordPageViewInput {
  tenantId: string;
  isSuperAdmin: boolean;
  /** Chave `view:*` da lista fechada (o schema da rota já recusa outra). */
  key: string;
  at: Date;
}

export interface RecordPageViewDeps {
  recorder: IFeatureUsageRecorder | null;
  log?: { warn(obj: object, msg: string): void };
}

/**
 * Visita de tela (P3, design §4.6): marca a conta como "abriu a tela no dia" com `markOnce` (idempotente por
 * dia × conta × tela; repetir não soma). Grava só conta, chave, tipo `ACCESS` e instante: nada de usuário, URL ou IP.
 * Super admin não conta. Fail-open: o contador roda sem `await` e a falha vira log.
 */
export class RecordPageViewUseCase {
  constructor(private readonly deps: RecordPageViewDeps) {}

  execute(input: RecordPageViewInput): void {
    if (input.isSuperAdmin) return;
    if (!findScreenView(input.key)) return;
    recordFeatureUsage(
      this.deps.recorder,
      { tenantId: input.tenantId, featureKey: input.key, kind: 'ACCESS', at: input.at },
      (err) => (this.deps.log ?? logger).warn({ err: (err as Error)?.name, featureKey: input.key }, 'page view count failed'),
      'markOnce',
    );
  }
}
