import type { PrismaClient } from '@prisma/client';
import { ENTITLEMENT_KEYS } from '../../tenants/domain/entitlementKeys';
import { PrismaEntitlementReader } from '../../tenants/infrastructure/repositories/PrismaEntitlementReader';
import {
  type ApplyPlanLimitsResult,
  ApplyPlanLimitsToLinkRotationsUseCase,
} from '../application/use-cases/ApplyPlanLimitsToLinkRotationsUseCase';
import { PrismaLinkRotationPlanEnforcementStore } from './repositories/PrismaLinkRotationPlanEnforcementStore';

/** Client normal ou `TransactionClient` do billing. */
export type LinkRotationPlanLimitsClient = Pick<PrismaClient, 'tenantEntitlement' | 'linkRotation' | 'linkRotationGroup'>;

/**
 * Ponto de entrada do billing (LROT-14): lê `link_rotations`/`link_rotation_groups` já gravados
 * (mesmo client/transação; ausente ou não numérico = ilimitado, igual ao resto do produto) e aplica.
 */
export async function applyLinkRotationPlanLimits(
  client: LinkRotationPlanLimitsClient,
  tenantId: string,
): Promise<ApplyPlanLimitsResult> {
  const reader = new PrismaEntitlementReader(client);
  // Sequencial: dentro de transação interativa o client não paraleliza.
  const linkRotations = await reader.getNumber(tenantId, ENTITLEMENT_KEYS.LINK_ROTATIONS);
  const linkRotationGroups = await reader.getNumber(tenantId, ENTITLEMENT_KEYS.LINK_ROTATION_GROUPS);
  return new ApplyPlanLimitsToLinkRotationsUseCase(new PrismaLinkRotationPlanEnforcementStore(client)).execute({
    tenantId,
    limits: { linkRotations, linkRotationGroups },
  });
}
