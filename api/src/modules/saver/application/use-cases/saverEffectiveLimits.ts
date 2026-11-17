import type { IEntitlementSnapshotReader } from '../../../tenants/domain/contracts/IEntitlementSnapshotReader';
import type { IProductAccessReader } from '../../../tenants/domain/contracts/IProductAccessReader';
import { effectiveSaverLimits, isSaverPilot, type SaverLimits } from '../../domain/services/saverLimits';
import type { SaverActor } from './saverActor';

export interface SaverLimitSources {
  entitlements: IEntitlementSnapshotReader;
  products: Pick<IProductAccessReader, 'has'>;
}

/**
 * Limites efetivos do ator no tenant (SAVER-47). O produto só é consultado para o super admin; a leitura
 * vai a cada pedido (o leitor de produto já tem o cache do processo, nada de cache aqui).
 */
export async function loadSaverLimits(src: SaverLimitSources, actor: SaverActor): Promise<{ limits: SaverLimits; pilot: boolean }> {
  const superAdmin = actor.role === 'SUPER_ADMIN';
  const [snapshot, hasProduct] = await Promise.all([
    src.entitlements.readAll(actor.tenantId),
    superAdmin ? src.products.has(actor.tenantId, 'SAVER') : Promise.resolve(true),
  ]);
  const pilot = isSaverPilot(superAdmin, hasProduct);
  return { limits: effectiveSaverLimits(snapshot, pilot), pilot };
}
