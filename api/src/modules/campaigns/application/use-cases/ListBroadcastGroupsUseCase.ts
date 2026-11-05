import type { IEntitlementReader } from '../../domain/contracts/IEntitlementReader';
import type { BroadcastGroupUse, IBroadcastGroupUsageReader } from '../../domain/contracts/IBroadcastGroupUsageReader';
import { countDistinctBroadcastGroups } from '../../domain/services/broadcastGroupUnion';
import { channelOfEngine, LIMIT_CHANNELS, limitKeyOfChannel, type LimitChannel } from '../../../tenants/domain/channelLimits';

export interface BroadcastGroupCatalogItemDTO {
  conversationId: string;
  sessionId: string;
  sessionName: string;
  channel: LimitChannel;
  title: string | null;
  avatarUrl: string | null;
  usedBy: BroadcastGroupUse[];
}

export interface ListBroadcastGroupsOutput {
  items: BroadcastGroupCatalogItemDTO[];
  /** Limite `broadcast_groups` por canal; `null` = plano não define. */
  limits: Record<LimitChannel, { broadcastGroups: number | null }>;
  /** Grupos distintos (sessão + JID) por canal: a mesma conta do limite (BG-01). */
  usage: Record<LimitChannel, { broadcastGroups: number }>;
}

interface Deps {
  groupUsage: IBroadcastGroupUsageReader;
  entitlements: IEntitlementReader;
}

/** Catálogo dos grupos de disparo do tenant (BG-04): gerador ⋃ monitoramentos, sem texto de mensagem. */
export class ListBroadcastGroupsUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(tenantId: string): Promise<ListBroadcastGroupsOutput> {
    const { groupUsage, entitlements } = this.deps;
    const [catalog, ...limitValues] = await Promise.all([
      groupUsage.listCatalog(tenantId),
      ...LIMIT_CHANNELS.map((ch) => entitlements.getNumber(tenantId, limitKeyOfChannel('broadcastGroups', ch))),
    ]);
    const count = countDistinctBroadcastGroups(catalog, (g) => g.engine);
    const limits = {} as ListBroadcastGroupsOutput['limits'];
    const usage = {} as ListBroadcastGroupsOutput['usage'];
    LIMIT_CHANNELS.forEach((ch, i) => {
      limits[ch] = { broadcastGroups: limitValues[i] ?? null };
      usage[ch] = { broadcastGroups: count[ch] };
    });
    return {
      items: catalog.map((g) => ({
        conversationId: g.conversationId,
        sessionId: g.sessionId,
        sessionName: g.sessionName,
        channel: channelOfEngine(g.engine),
        title: g.title,
        avatarUrl: g.avatarUrl,
        usedBy: [...g.usedBy],
      })),
      limits,
      usage,
    };
  }
}
