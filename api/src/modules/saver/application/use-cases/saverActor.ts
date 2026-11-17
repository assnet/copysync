import { ForbiddenError } from '../../../../shared/errors/internal/AuthErrors';
import type { ISaverExportGrantRepository } from '../../domain/contracts/ISaverExportGrantRepository';
import { canSaver, NO_SAVER_GRANTS, type SaverAction, type SaverGrants, type SaverRole } from '../../domain/services/saverPermissions';

/** Quem chama o use case do Saver (montado pela rota a partir do contexto do tenant). */
export interface SaverActor {
  tenantId: string;
  userId: string;
  role: SaverRole;
}

/** Papel do contexto → papel do Saver. Super admin manda; papel desconhecido = OPERATOR (menor acesso). */
export function toSaverRole(role: string, isSuperAdmin: boolean): SaverRole {
  if (isSuperAdmin || role === 'SUPER_ADMIN') return 'SUPER_ADMIN';
  return role === 'ADMIN' ? 'ADMIN' : 'OPERATOR';
}

/** Liberações do usuário: só OPERATOR consulta (ADMIN/SUPER_ADMIN ignoram liberação). */
export async function loadSaverGrants(
  grants: Pick<ISaverExportGrantRepository, 'hasGrant'>,
  actor: SaverActor,
): Promise<SaverGrants> {
  if (actor.role !== 'OPERATOR') return NO_SAVER_GRANTS;
  return { export: await grants.hasGrant(actor.tenantId, actor.userId) };
}

/** Checagem de permissão do Saver no use case (nunca no handler). */
export function assertCanSaver(actor: SaverActor, action: SaverAction, grants: SaverGrants = NO_SAVER_GRANTS): void {
  if (!canSaver(actor.role, action, grants)) throw new ForbiddenError(`Saver action not allowed: ${action}`);
}
