import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';
import type { SaveLinkRotationGroupInput } from '../../domain/contracts/ILinkRotationRepository';
import type { LinkRotationGroup } from '../../domain/entities/LinkRotationGroup';
import { LinkRotationGroupLinkSource } from '../../domain/enums/LinkRotationEnums';
import { parseInviteCode } from '../../domain/services/inviteUrl';
import {
  LinkGroupInvalidError,
  LinkInviteUrlInvalidError,
  LinkRotationNotFoundError,
} from '../../../../shared/errors/internal/LinkRotationErrors';
import { PlanLimitReachedError } from '../../../../shared/errors/internal/PlanErrors';
import {
  type LinkRotationGroupInputDTO,
  type LinkRotationGroupOutputDTO,
  type SaveLinkRotationGroupsDTO,
  toLinkRotationGroupDTO,
} from '../dtos/LinkRotationDTO';
import { groupStatusFor, tryGroupInvite } from './groupInviteResolution';
import type { LinkRotationUseCaseDeps } from './linkRotationUseCaseDeps';

type Deps = Pick<LinkRotationUseCaseDeps, 'rotations' | 'groups' | 'entitlements' | 'engine'>;

export const GROUP_CAPACITY = { min: 50, max: 1024, default: 1000 } as const;
export const GROUP_WEIGHT = { min: 1, max: 100, default: 1 } as const;

const inRange = (v: number, r: { min: number; max: number }) => Number.isInteger(v) && v >= r.min && v <= r.max;

/**
 * Substitui os grupos do rodízio (menos que o limite é aceito; acima → PlanLimitReachedError).
 * Cada grupo tem de ser conversa `isGroup` do tenant **na sessão do rodízio**.
 *
 * Link por grupo:
 * - `manualInviteUrl` preenchido → valida e guarda só o code (MANUAL).
 * - `manualInviteUrl` ausente e o grupo já era MANUAL → mantém o manual (o painel pode reenviar
 *   a lista sem o campo). `null`/'' → volta para AUTO.
 * - AUTO → `engine.getGroupInviteLink` (sequencial, um por grupo). `GROUP_INVITE_NOT_ALLOWED` →
 *   NEEDS_LINK sem code. Sessão desconectada/engine fora → mantém o code AUTO anterior se houver,
 *   senão NEEDS_LINK; o salvamento não cai (o botão "atualizar" re-tenta depois).
 * Validação inteira roda antes da primeira chamada ao engine.
 */
export class SaveLinkRotationGroupsUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(input: SaveLinkRotationGroupsDTO): Promise<LinkRotationGroupOutputDTO[]> {
    const { rotations, groups: catalog, entitlements, engine } = this.deps;
    const { tenantId, rotationId } = input;

    const rotation = await rotations.findById(tenantId, rotationId);
    if (!rotation) throw new LinkRotationNotFoundError(rotationId);

    const limit = await entitlements.getNumber(tenantId, ENTITLEMENT_KEYS.LINK_ROTATION_GROUPS);
    if (limit !== null && input.groups.length > limit) {
      throw new PlanLimitReachedError(ENTITLEMENT_KEYS.LINK_ROTATION_GROUPS, limit);
    }

    const ordered = validateAndOrder(input.groups);
    const candidates = await catalog.findGroups(tenantId, ordered.map((g) => g.conversationId));
    const byConversation = new Map(candidates.map((c) => [c.conversationId, c]));
    const existing = new Map(rotation.groups.map((g) => [g.conversationId, g]));

    const prepared = ordered.map((g) => {
      const candidate = byConversation.get(g.conversationId);
      if (!candidate || candidate.sessionId !== rotation.sessionId) {
        throw new LinkGroupInvalidError('Group is not from the rotation session', g.conversationId);
      }
      return { input: g, groupJid: candidate.groupJid, manualCode: manualCodeFor(g, existing.get(g.conversationId)) };
    });

    const rows: SaveLinkRotationGroupInput[] = [];
    for (const [position, p] of prepared.entries()) {
      const previous = existing.get(p.input.conversationId);
      const capacity = p.input.capacity ?? GROUP_CAPACITY.default;
      const weight = p.input.weight ?? GROUP_WEIGHT.default;
      let inviteCode: string | null = null;
      let linkSource: LinkRotationGroupLinkSource | null = null;

      if (p.manualCode) {
        inviteCode = p.manualCode;
        linkSource = LinkRotationGroupLinkSource.MANUAL;
      } else {
        const attempt = await tryGroupInvite(engine, rotation.sessionId, p.groupJid);
        if (attempt.kind === 'ok') {
          inviteCode = attempt.inviteCode;
          linkSource = LinkRotationGroupLinkSource.AUTO;
        } else if (attempt.kind === 'unavailable' && previous?.linkSource === LinkRotationGroupLinkSource.AUTO && previous.inviteCode) {
          inviteCode = previous.inviteCode;
          linkSource = LinkRotationGroupLinkSource.AUTO;
        }
      }

      rows.push({
        conversationId: p.input.conversationId,
        groupJid: p.groupJid,
        position,
        weight,
        capacity,
        inviteCode,
        linkSource,
        status: groupStatusFor(!!inviteCode, previous?.memberCount ?? null, capacity),
      });
    }

    const saved = await rotations.replaceGroups(tenantId, rotationId, rows);
    const names = new Map(candidates.map((c) => [c.conversationId, c.name]));
    return saved.map((g) => toLinkRotationGroupDTO(g, names.get(g.conversationId) ?? null));
  }
}

/** Duplicadas e faixas (peso, teto, posição); ordena por `position` (estável) para renumerar 0..n-1. */
function validateAndOrder(groups: LinkRotationGroupInputDTO[]): LinkRotationGroupInputDTO[] {
  const seen = new Set<string>();
  for (const g of groups) {
    if (!g.conversationId) throw new LinkGroupInvalidError('Missing conversation');
    if (seen.has(g.conversationId)) throw new LinkGroupInvalidError('Duplicated group', g.conversationId);
    seen.add(g.conversationId);
    if (g.capacity !== undefined && !inRange(g.capacity, GROUP_CAPACITY)) {
      throw new LinkGroupInvalidError('Group capacity must be between 50 and 1024', g.conversationId);
    }
    if (g.weight !== undefined && !inRange(g.weight, GROUP_WEIGHT)) {
      throw new LinkGroupInvalidError('Group weight must be between 1 and 100', g.conversationId);
    }
    if (g.position !== undefined && (!Number.isInteger(g.position) || g.position < 0)) {
      throw new LinkGroupInvalidError('Group position must be a non-negative integer', g.conversationId);
    }
  }
  return groups
    .map((g, index) => ({ g, index }))
    .sort((a, b) => (a.g.position ?? a.index) - (b.g.position ?? b.index) || a.index - b.index)
    .map(({ g }) => g);
}

/** Code manual a usar, ou null para AUTO. Valida antes de qualquer chamada ao engine. */
function manualCodeFor(g: LinkRotationGroupInputDTO, previous: LinkRotationGroup | undefined): string | null {
  if (g.manualInviteUrl === undefined) {
    return previous?.linkSource === LinkRotationGroupLinkSource.MANUAL ? previous.inviteCode : null;
  }
  if (g.manualInviteUrl === null || g.manualInviteUrl.trim() === '') return null;
  const code = parseInviteCode(g.manualInviteUrl);
  if (!code) throw new LinkInviteUrlInvalidError();
  return code;
}
