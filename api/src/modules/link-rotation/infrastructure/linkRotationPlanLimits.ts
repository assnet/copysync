import type { PrismaClient } from '@prisma/client';
import { LIMIT_CHANNELS, limitKeyOfChannel } from '../../tenants/domain/channelLimits';
import { PrismaEntitlementReader } from '../../tenants/infrastructure/repositories/PrismaEntitlementReader';
import {
  type ApplyPlanLimitsResult,
  ApplyPlanLimitsToLinkRotationsUseCase,
  type LinkRotationPlanLimits,
} from '../application/use-cases/ApplyPlanLimitsToLinkRotationsUseCase';
import { PrismaLinkRotationPlanEnforcementStore } from './repositories/PrismaLinkRotationPlanEnforcementStore';

/** Client normal ou `TransactionClient` do billing. */
export type LinkRotationPlanLimitsClient = Pick<PrismaClient, 'tenantEntitlement' | 'linkRotation' | 'linkRotationGroup'>;

/**
 * Ponto de entrada do billing (LROT-14): lê os limites por canal já gravados (WhatsApp:
 * `link_rotations`/`link_rotation_groups`; Telegram: `telegram_link_rotations`/
 * `telegram_link_rotation_groups`; mesmo client/transação; ausente ou não numérico = ilimitado) e aplica.
 */
export async function applyLinkRotationPlanLimits(
  client: LinkRotationPlanLimitsClient,
  tenantId: string,
): Promise<ApplyPlanLimitsResult> {
  const reader = new PrismaEntitlementReader(client);
  // Sequencial: dentro de transação interativa o client não paraleliza.
  const limits = {} as LinkRotationPlanLimits;
  for (const channel of LIMIT_CHANNELS) {
    limits[channel] = {
      linkRotations: await reader.getNumber(tenantId, limitKeyOfChannel('linkRotations', channel)),
      linkRotationGroups: await reader.getNumber(tenantId, limitKeyOfChannel('linkRotationGroups', channel)),
    };
  }
  return new ApplyPlanLimitsToLinkRotationsUseCase(new PrismaLinkRotationPlanEnforcementStore(client)).execute({ tenantId, limits });
}
