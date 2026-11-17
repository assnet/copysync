import { ForbiddenError } from '../../../shared/errors/internal/AuthErrors';
import type { ISaverExportGrantRepository } from '../domain/contracts/ISaverExportGrantRepository';
import { canSaver, NO_SAVER_GRANTS, type SaverAction, type SaverRole } from '../domain/services/saverPermissions';

/** Quem age no Saver dentro de um tenant (vem do contexto do tenant; `SUPER_ADMIN` = suporte). */
export interface SaverTenantActor {
  tenantId: string;
  userId: string;
  role: SaverRole;
}

/**
 * Checa a permissão no use case (nunca no handler). A liberação de exportar só é lida para `OPERATOR`
 * e a cada chamada: revogada vale na requisição seguinte.
 */
export async function assertSaverPermission(
  actor: SaverTenantActor,
  action: SaverAction,
  grants?: Pick<ISaverExportGrantRepository, 'hasGrant'>,
): Promise<void> {
  const needsGrant = actor.role === 'OPERATOR' && action === 'export' && grants;
  const effective = needsGrant ? { export: await grants.hasGrant(actor.tenantId, actor.userId) } : NO_SAVER_GRANTS;
  if (!canSaver(actor.role, action, effective)) throw new ForbiddenError(`Saver action not allowed: ${action}`);
}
