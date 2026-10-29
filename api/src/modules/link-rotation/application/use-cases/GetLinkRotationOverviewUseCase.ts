import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';
import { LinkDomainStatus } from '../../domain/enums/LinkRotationEnums';
import {
  type LinkRotationOverviewDTO,
  toLinkRotationDTO,
  toLinkRotationSessionDTO,
} from '../dtos/LinkRotationDTO';
import type { LinkRotationUseCaseDeps } from './linkRotationUseCaseDeps';

type Deps = Pick<LinkRotationUseCaseDeps, 'rotations' | 'domains' | 'sessions' | 'groups' | 'entitlements'>;

/**
 * Tela do rodízio: rotações (com grupos e nome do grupo), domínios ACTIVE para escolha, limites do
 * plano (null = ilimitado) e sessões do tenant. Rotação em domínio pausado ainda mostra o link
 * (hostname vem da lista completa).
 */
export class GetLinkRotationOverviewUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(tenantId: string): Promise<LinkRotationOverviewDTO> {
    const { rotations, domains, sessions, groups, entitlements } = this.deps;
    const [list, allDomains, sessionList, linkRotations, linkRotationGroups] = await Promise.all([
      rotations.listByTenant(tenantId),
      domains.list(),
      sessions.listByTenant(tenantId),
      entitlements.getNumber(tenantId, ENTITLEMENT_KEYS.LINK_ROTATIONS),
      entitlements.getNumber(tenantId, ENTITLEMENT_KEYS.LINK_ROTATION_GROUPS),
    ]);
    const conversationIds = list.flatMap((r) => r.groups.map((g) => g.conversationId));
    const candidates = await groups.findGroups(tenantId, conversationIds);
    const names = new Map(candidates.map((c) => [c.conversationId, c.name]));
    const byId = new Map(allDomains.map((d) => [d.id, d]));

    return {
      rotations: list.map((r) => toLinkRotationDTO(r, byId.get(r.domainId) ?? null, names)),
      domains: allDomains
        .filter((d) => d.status === LinkDomainStatus.ACTIVE)
        .map((d) => ({ id: d.id, hostname: d.hostname })),
      limits: { linkRotations, linkRotationGroups },
      sessions: sessionList.map(toLinkRotationSessionDTO),
    };
  }
}
