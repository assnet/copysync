import type { SaverExportGrant } from '../entities/SaverEntities';

export interface ISaverExportGrantRepository {
  hasGrant(tenantId: string, userId: string): Promise<boolean>;
  listByTenant(tenantId: string): Promise<SaverExportGrant[]>;
  grant(tenantId: string, userId: string, grantedByUserId: string): Promise<void>;
  revoke(tenantId: string, userId: string): Promise<void>;
}
