import { limitKeyOfChannel } from '../../../tenants/domain/channelLimits';
import type { ILinkRotationGroupDirectory } from '../../domain/contracts/ILinkRotationGroupDirectory';
import {
  LinkGroupInvalidError,
  LinkRotationNotFoundError,
} from '../../../../shared/errors/internal/LinkRotationErrors';
import { PlanLimitReachedError } from '../../../../shared/errors/internal/PlanErrors';
import type { LinkRotationGroupInputDTO, LinkRotationGroupOutputDTO } from '../dtos/LinkRotationDTO';
import type { SaveLinkRotationGroupsUseCase } from './SaveLinkRotationGroupsUseCase';
import type { LinkRotationUseCaseDeps } from './linkRotationUseCaseDeps';

type Deps = Pick<LinkRotationUseCaseDeps, 'rotations' | 'entitlements'> & {
  directory: Pick<ILinkRotationGroupDirectory, 'ensureConversation'>;
  save: Pick<SaveLinkRotationGroupsUseCase, 'execute'>;
};

/** Grupo vindo do painel: conversa já conhecida, ou só o JID de um grupo da sessão. */
export type LinkRotationGroupSelectionDTO = Omit<LinkRotationGroupInputDTO, 'conversationId'> & {
  conversationId?: string;
  groupJid?: string;
};

/**
 * Entrada do `PUT /:id/groups`. Candidato sem conversa no chat chega só com `groupJid`: a conversa
 * é garantida aqui (só grupo de que a sessão participa) e o resto é `SaveLinkRotationGroupsUseCase`.
 * O limite do plano é checado antes, para não criar conversa num pedido que vai ser recusado.
 */
export class SelectLinkRotationGroupsUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(input: { tenantId: string; rotationId: string; groups: LinkRotationGroupSelectionDTO[] }): Promise<LinkRotationGroupOutputDTO[]> {
    const { tenantId, rotationId } = input;
    const rotation = await this.deps.rotations.findById(tenantId, rotationId);
    if (!rotation) throw new LinkRotationNotFoundError(rotationId);

    const key = limitKeyOfChannel('linkRotationGroups', rotation.channel);
    const limit = await this.deps.entitlements.getNumber(tenantId, key);
    if (limit !== null && input.groups.length > limit) throw new PlanLimitReachedError(key, limit);

    const groups: LinkRotationGroupInputDTO[] = [];
    for (const { groupJid, conversationId, ...rest } of input.groups) {
      if (conversationId) {
        groups.push({ ...rest, conversationId });
        continue;
      }
      if (!groupJid) throw new LinkGroupInvalidError('Missing conversation');
      const ensured = await this.deps.directory.ensureConversation(tenantId, rotation.sessionId, groupJid);
      groups.push({ ...rest, conversationId: ensured });
    }
    return this.deps.save.execute({ tenantId, rotationId, groups });
  }
}
