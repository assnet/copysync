import type { LinkRotationGroup } from '../../domain/entities/LinkRotationGroup';
import { LinkRotationGroupLinkSource, LinkRotationGroupStatus } from '../../domain/enums/LinkRotationEnums';
import { LinkRotationNotFoundError } from '../../../../shared/errors/internal/LinkRotationErrors';
import {
  type LinkRotationGroupOutputDTO,
  type RefreshLinkRotationGroupDTO,
  toLinkRotationGroupDTO,
} from '../dtos/LinkRotationDTO';
import { groupStatusFor, tryGroupInvite } from './groupInviteResolution';
import type { LinkRotationUseCaseDeps } from './linkRotationUseCaseDeps';

type Deps = Pick<LinkRotationUseCaseDeps, 'rotations' | 'engine' | 'now'>;

/** Pausa manual/por plano não é desfeita por um refresh. */
const SYSTEM_HELD = new Set<LinkRotationGroupStatus>([LinkRotationGroupStatus.PAUSED, LinkRotationGroupStatus.PAUSED_BY_PLAN]);

/**
 * Botão "atualizar" do grupo: `getGroupSummary` (membros agora; zera `clicksSinceSync`, que só
 * estima o intervalo desde a última leitura) e, se o link não é MANUAL, re-tenta o convite AUTO.
 * Sessão desconectada: o erro do resumo sobe (`SESSION_NOT_CONNECTED`, nada gravado).
 * Status: sem link → NEEDS_LINK; membros ≥ teto → FULL; senão ACTIVE.
 */
export class RefreshLinkRotationGroupUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(input: RefreshLinkRotationGroupDTO): Promise<LinkRotationGroupOutputDTO> {
    const { rotations, engine } = this.deps;
    const { tenantId, rotationId, groupId } = input;
    const now = this.deps.now?.() ?? new Date();

    const rotation = await rotations.findById(tenantId, rotationId);
    const group = rotation?.groups.find((g) => g.id === groupId);
    if (!rotation || !group) throw new LinkRotationNotFoundError(rotationId);

    const summary = await engine.getGroupSummary(rotation.sessionId, group.groupJid);
    const link = await this.resolveLink(rotation.sessionId, group);

    const updated = await rotations.updateGroup(tenantId, rotationId, groupId, {
      ...link,
      memberCount: summary.memberCount,
      memberCountAt: now,
      clicksSinceSync: 0,
      status: SYSTEM_HELD.has(group.status)
        ? group.status
        : groupStatusFor(!!link.inviteCode, summary.memberCount, group.capacity),
    });
    return toLinkRotationGroupDTO(updated, summary.name || null);
  }

  private async resolveLink(
    sessionId: string,
    group: LinkRotationGroup,
  ): Promise<{ inviteCode: string | null; linkSource: LinkRotationGroupLinkSource | null }> {
    if (group.linkSource === LinkRotationGroupLinkSource.MANUAL && group.inviteCode) {
      return { inviteCode: group.inviteCode, linkSource: LinkRotationGroupLinkSource.MANUAL };
    }
    const attempt = await tryGroupInvite(this.deps.engine, sessionId, group.groupJid);
    if (attempt.kind === 'ok') return { inviteCode: attempt.inviteCode, linkSource: LinkRotationGroupLinkSource.AUTO };
    if (attempt.kind === 'unavailable') return { inviteCode: group.inviteCode, linkSource: group.linkSource };
    return { inviteCode: null, linkSource: null };
  }
}
