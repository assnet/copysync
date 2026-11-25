import { env } from '../../../shared/config/env';
import { PrismaAuditLogRepository } from '../../../shared/audit/PrismaAuditLogRepository';
import { UnitOfWork } from '../../../shared/database/UnitOfWork';
import { FeatureAudienceReader, type FeatureAudienceDefaults } from '../application/services/FeatureAudienceReader';
import type { FeatureAudienceTransaction } from '../application/use-cases/SetFeatureAudienceUseCase';
import { ENTITLEMENT_KEYS } from '../domain/entitlementKeys';
import { SAVER_AUDIENCE_KEY } from '../domain/featureAudience';
import { PrismaFeatureAudienceRepository } from './repositories/PrismaFeatureAudienceRepository';

/**
 * Valor inicial (chave nunca gravada): `OFFER_HUNTER_AUDIENCE`/`SAVER_AUDIENCE`, lidas a cada uso (`super_admin` = só
 * super admin). Lojas Kabum/Magalu/AliExpress, foto oficial e marca d'água: `true` fixo, sem env; liberar só pela flag em `/admin/plan-entitlements`.
 */
export const featureAudienceDefaults: FeatureAudienceDefaults = () => ({
  [ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED]: env.OFFER_HUNTER_AUDIENCE !== 'entitled',
  [SAVER_AUDIENCE_KEY]: env.SAVER_AUDIENCE !== 'entitled',
  [ENTITLEMENT_KEYS.MARKETPLACE_KABUM_ENABLED]: true,
  [ENTITLEMENT_KEYS.MARKETPLACE_MAGALU_ENABLED]: true,
  [ENTITLEMENT_KEYS.MARKETPLACE_ALIEXPRESS_ENABLED]: true,
  [ENTITLEMENT_KEYS.OFFER_CLEAN_IMAGE_ENABLED]: true,
  [ENTITLEMENT_KEYS.OFFER_WATERMARK_ENABLED]: true,
});

let reader: FeatureAudienceReader | null = null;
/** Leitor único (sem estado: lê o banco a cada uso). Importar não toca o banco. */
export const featureAudienceReader = (): FeatureAudienceReader =>
  (reader ??= new FeatureAudienceReader(new PrismaFeatureAudienceRepository(), featureAudienceDefaults));

/** Flag + AuditLog no mesmo `tx`. */
export const prismaFeatureAudienceTransaction: FeatureAudienceTransaction = (fn) =>
  new UnitOfWork().runInTransaction((tx) => fn({ audience: new PrismaFeatureAudienceRepository(tx), audit: new PrismaAuditLogRepository(tx) }));
