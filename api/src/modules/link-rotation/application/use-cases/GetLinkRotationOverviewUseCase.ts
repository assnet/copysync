import { limitKeyOfChannel } from '../../../tenants/domain/channelLimits';
import type { LinkRotationSessionRef } from '../../domain/contracts/ILinkRotationSessionReader';
import { LinkDomainStatus } from '../../domain/enums/LinkRotationEnums';
import type { LinkRotationChannel } from '../../domain/services/inviteUrl';
import {
  type LinkRotationOverviewDTO,
  toLinkRotationDTO,
  toLinkRotationSessionDTO,
} from '../dtos/LinkRotationDTO';
import type { LinkRotationUseCaseDeps } from './linkRotationUseCaseDeps';

type Deps = Pick<LinkRotationUseCaseDeps, 'rotations' | 'domains' | 'sessions' | 'groups' | 'entitlements'> &
  Partial<Pick<LinkRotationUseCaseDeps, 'engine'>>;

/**
 * Tela do rodízio: rotações (com grupos e nome do grupo), domínios ACTIVE para escolha, limites do
 * plano e uso por canal (null = ilimitado; campos sem canal = WhatsApp, legado) e sessões do tenant. Rotação em domínio pausado ainda mostra o link
 * (hostname vem da lista completa). Sessão conectada leva a foto da conta (mesma regra da lista
 * de sessões); falha na foto não derruba a tela.
 */
export class GetLinkRotationOverviewUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(tenantId: string): Promise<LinkRotationOverviewDTO> {
    const { rotations, domains, sessions, groups, entitlements } = this.deps;
    const limit = (kind: 'linkRotations' | 'linkRotationGroups', channel: LinkRotationChannel) =>
      entitlements.getNumber(tenantId, limitKeyOfChannel(kind, channel));
    const [list, allDomains, sessionList, waRotations, waGroups, tgRotations, tgGroups] = await Promise.all([
      rotations.listByTenant(tenantId),
      domains.list(),
      sessions.listByTenant(tenantId),
      limit('linkRotations', 'whatsapp'),
      limit('linkRotationGroups', 'whatsapp'),
      limit('linkRotations', 'telegram'),
      limit('linkRotationGroups', 'telegram'),
    ]);
    const conversationIds = list.flatMap((r) => r.groups.map((g) => g.conversationId));
    const candidates = await groups.findGroups(tenantId, conversationIds);
    const names = new Map(candidates.map((c) => [c.conversationId, c.name]));
    const byId = new Map(allDomains.map((d) => [d.id, d]));
    const avatars = await Promise.all(sessionList.map((s) => this.avatarOf(s)));

    return {
      rotations: list.map((r) => toLinkRotationDTO(r, byId.get(r.domainId) ?? null, names)),
      domains: allDomains
        .filter((d) => d.status === LinkDomainStatus.ACTIVE)
        .map((d) => ({ id: d.id, hostname: d.hostname })),
      limits: {
        linkRotations: waRotations,
        linkRotationGroups: waGroups,
        whatsapp: { rotations: waRotations, groupsPerRotation: waGroups },
        telegram: { rotations: tgRotations, groupsPerRotation: tgGroups },
      },
      usage: {
        whatsapp: { rotations: list.filter((r) => r.channel === 'whatsapp').length },
        telegram: { rotations: list.filter((r) => r.channel === 'telegram').length },
      },
      sessions: sessionList.map((s, i) => toLinkRotationSessionDTO(s, avatars[i] ?? null)),
    };
  }

  private async avatarOf(s: LinkRotationSessionRef): Promise<string | null> {
    const { engine } = this.deps;
    if (!engine || !s.phone || s.status !== 'CONNECTED') return null;
    try {
      return await engine.fetchProfilePicture(s.id, s.phone, false);
    } catch {
      return null;
    }
  }
}
