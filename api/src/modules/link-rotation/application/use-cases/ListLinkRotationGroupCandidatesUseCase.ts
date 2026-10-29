import type { ILinkRotationGroupDirectory } from '../../domain/contracts/ILinkRotationGroupDirectory';
import type { LinkRotationGroupStatus } from '../../domain/enums/LinkRotationEnums';
import { LinkRotationNotFoundError } from '../../../../shared/errors/internal/LinkRotationErrors';
import type { LinkRotationUseCaseDeps } from './linkRotationUseCaseDeps';

type Deps = Pick<LinkRotationUseCaseDeps, 'rotations' | 'groups'> & {
  directory: Pick<ILinkRotationGroupDirectory, 'listSessionGroups'>;
};

export interface LinkRotationGroupCandidateDTO {
  groupJid: string;
  title: string | null;
  avatarUrl: string | null;
  conversationId: string | null;
  /** Já está no rodízio. */
  selected: boolean;
  /** Id do grupo no rodízio (quando `selected`). */
  rotationGroupId: string | null;
  status: LinkRotationGroupStatus | null;
}

export interface LinkRotationGroupCandidatesDTO {
  groups: LinkRotationGroupCandidateDTO[];
  partial: boolean;
}

/**
 * Candidatos a entrar no rodízio: grupos da sessão da rotação (listagem do gerador de ofertas).
 * Grupo já selecionado sempre aparece (sem busca), mesmo que a sessão tenha saído dele ou
 * esteja desconectada, para o usuário poder tirá-lo.
 */
export class ListLinkRotationGroupCandidatesUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(input: { tenantId: string; rotationId: string; search?: string }): Promise<LinkRotationGroupCandidatesDTO> {
    const { tenantId, rotationId } = input;
    const rotation = await this.deps.rotations.findById(tenantId, rotationId);
    if (!rotation) throw new LinkRotationNotFoundError(rotationId);

    const search = input.search?.trim() || undefined;
    const list = await this.deps.directory.listSessionGroups(tenantId, rotation.sessionId, search);
    const byJid = new Map(rotation.groups.map((g) => [g.groupJid, g]));
    const seen = new Set<string>();

    const groups: LinkRotationGroupCandidateDTO[] = list.groups.map((c) => {
      seen.add(c.groupJid);
      const sel = byJid.get(c.groupJid);
      return {
        ...c,
        conversationId: c.conversationId ?? sel?.conversationId ?? null,
        selected: !!sel,
        rotationGroupId: sel?.id ?? null,
        status: sel?.status ?? null,
      };
    });

    const missing = search ? [] : rotation.groups.filter((g) => !seen.has(g.groupJid));
    if (missing.length > 0) {
      const names = new Map(
        (await this.deps.groups.findGroups(tenantId, missing.map((g) => g.conversationId))).map((c) => [c.conversationId, c.name]),
      );
      for (const g of missing) {
        groups.push({
          groupJid: g.groupJid,
          title: names.get(g.conversationId) ?? null,
          avatarUrl: null,
          conversationId: g.conversationId,
          selected: true,
          rotationGroupId: g.id,
          status: g.status,
        });
      }
    }
    return { groups, partial: list.partial };
  }
}
