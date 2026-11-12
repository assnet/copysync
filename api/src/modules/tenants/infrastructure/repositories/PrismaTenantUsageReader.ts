import type { Prisma, PrismaClient } from '@prisma/client';
import type { ITenantUsageReader } from '../../domain/contracts/ITenantUsageReader';
import type { SubscriptionUsage } from '../../domain/services/subscriptionLimits';
import { channelOfEngine, countByChannel, type LimitChannel } from '../../domain/channelLimits';
import { startOfDayInZone } from '../../../campaigns/domain/services/startOfDayInZone';
import { ENTITLEMENT_KEYS } from '../../domain/entitlementKeys';
import { identifierLimitOf } from '../../domain/services/affiliateIdentifierLimit';
import { effectiveLinkedIdentifiers } from '../../../integrations/domain/services/effectiveLinkedIdentifiers';
import { PrismaEntitlementReader } from './PrismaEntitlementReader';

type UsagePrisma = Pick<
  PrismaClient,
  | 'session' | 'monitoredGroup' | 'broadcastGroup' | 'linkRotation' | 'offer' | 'offerHuntFind' | 'aiUsageLog'
  | 'affiliateCredential' | 'tenantEntitlement'
>;

/** Mesmo filtro de `PrismaOfferRepository` (`countsTowardGeneratorQuota`): o caçador tem teto próprio (D4). */
const generatorOffersSince = (tenantId: string, since: Date): Prisma.OfferWhereInput => ({
  tenantId, createdAt: { gte: since }, origin: { not: 'HUNTER' },
});

/**
 * Contagens com `tenantId` em toda consulta. Regras copiadas das telas de recurso:
 * - sessões: `deletedAt: null`, canal pela engine (`GetSessionLimitsUseCase`);
 * - grupos: sessão dona (e, no disparo, a do monitoramento) existe e não está apagada
 *   (`PrismaGroupMonitorRepository.tenantGroupJids`); sessão sumida = WhatsApp, fora da conta;
 * - rodízios: todos do tenant, canal pela engine da sessão (`PrismaLinkRotationRepository.countByChannel`);
 * - ofertas: `createdAt >= startOfDayInZone(now)` sem `origin = HUNTER` (`GetOfferUsageUseCase`);
 * - achados do caçador: `offer_hunt_finds` desde o mesmo início do dia (teto do caçador);
 * - IA: só `source = PLATFORM`, a mesma base do teto diário (`PrismaAiUsageLogRepository`);
 * - etiquetas do ML: conjunto **efetivo** (`effectiveLinkedIdentifiers` com o limite do plano), o mesmo
 *   `used` de `GET …/MERCADO_LIVRE/identifiers`; plano rebaixado não mostra uso acima do limite.
 */
export class PrismaTenantUsageReader implements ITenantUsageReader {
  constructor(
    private readonly prisma: UsagePrisma,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async read(tenantId: string): Promise<SubscriptionUsage> {
    const since = startOfDayInZone(this.now());
    const [
      sessions, groups, linkRotations, offerGenerationsToday, offerHunterFindsToday, aiRequestsToday, mercadoLivreAffiliateTags,
    ] = await Promise.all([
      this.countSessions(tenantId),
      this.countGroups(tenantId),
      this.countLinkRotations(tenantId),
      this.prisma.offer.count({ where: generatorOffersSince(tenantId, since) }),
      this.prisma.offerHuntFind.count({ where: { tenantId, createdAt: { gte: since } } }),
      this.prisma.aiUsageLog.count({ where: { tenantId, source: 'PLATFORM', createdAt: { gte: since } } }),
      this.countMercadoLivreTags(tenantId),
    ]);
    return {
      sessions, ...groups, linkRotations, offerGenerationsToday, offerHunterFindsToday, aiRequestsToday, mercadoLivreAffiliateTags,
    };
  }

  private async countMercadoLivreTags(tenantId: string): Promise<number> {
    const [row, value] = await Promise.all([
      this.prisma.affiliateCredential.findUnique({
        where: { tenantId_provider: { tenantId, provider: 'MERCADO_LIVRE' } },
        select: { publicIdentifier: true, linkedIdentifiers: true },
      }),
      new PrismaEntitlementReader(this.prisma).getNumber(tenantId, ENTITLEMENT_KEYS.MERCADO_LIVRE_AFFILIATE_TAGS),
    ]);
    if (!row) return 0;
    return effectiveLinkedIdentifiers(row.publicIdentifier, row.linkedIdentifiers, identifierLimitOf(value)).length;
  }

  private async countSessions(tenantId: string): Promise<Record<LimitChannel, number>> {
    const rows = await this.prisma.session.groupBy({
      by: ['engine'],
      where: { tenantId, deletedAt: null },
      _count: { _all: true },
    });
    const out: Record<LimitChannel, number> = { whatsapp: 0, telegram: 0 };
    for (const r of rows) out[channelOfEngine(r.engine)] += r._count._all;
    return out;
  }

  private async countGroups(tenantId: string): Promise<Pick<SubscriptionUsage, 'monitoredGroups' | 'broadcastGroups'>> {
    const [monitored, broadcast] = await Promise.all([
      this.prisma.monitoredGroup.findMany({ where: { tenantId }, select: { sessionId: true } }),
      this.prisma.broadcastGroup.findMany({ where: { tenantId }, select: { sessionId: true, config: { select: { sessionId: true } } } }),
    ]);
    const ids = [...new Set([...monitored.map((m) => m.sessionId), ...broadcast.flatMap((b) => [b.sessionId, b.config.sessionId])])];
    const live = new Map<string, string>();
    if (ids.length > 0) {
      const rows = await this.prisma.session.findMany({
        where: { tenantId, id: { in: ids }, deletedAt: null },
        select: { id: true, engine: true },
      });
      for (const r of rows) live.set(r.id, r.engine);
    }
    return {
      monitoredGroups: countByChannel(monitored.filter((m) => live.has(m.sessionId)), (m) => live.get(m.sessionId)),
      broadcastGroups: countByChannel(
        broadcast.filter((b) => live.has(b.sessionId) && live.has(b.config.sessionId)),
        (b) => live.get(b.sessionId),
      ),
    };
  }

  private async countLinkRotations(tenantId: string): Promise<Record<LimitChannel, number>> {
    const [telegram, whatsapp] = await Promise.all([
      this.prisma.linkRotation.count({ where: { tenantId, session: { engine: 'telegram' } } }),
      this.prisma.linkRotation.count({ where: { tenantId, session: { engine: { not: 'telegram' } } } }),
    ]);
    return { whatsapp, telegram };
  }
}
