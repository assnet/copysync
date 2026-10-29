import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';
import { LinkRotationStatus, LinkRotationStrategy } from '../../domain/enums/LinkRotationEnums';
import { LinkRotationNotFoundError } from '../../../../shared/errors/internal/LinkRotationErrors';
import { PlanLimitReachedError } from '../../../../shared/errors/internal/PlanErrors';
import { ValidationError } from '../../../../shared/errors/internal/ResourceErrors';
import { SessionNotFoundError } from '../../../../shared/errors/internal/SessionErrors';
import { type LinkRotationOutputDTO, type UpdateLinkRotationDTO, toLinkRotationDTO } from '../dtos/LinkRotationDTO';
import type { UpdateLinkRotationInput } from '../../domain/contracts/ILinkRotationRepository';
import { normalizeTitle } from './linkRotationRules';
import type { LinkRotationUseCaseDeps } from './linkRotationUseCaseDeps';

type Deps = Pick<LinkRotationUseCaseDeps, 'rotations' | 'domains' | 'sessions' | 'entitlements'>;

const TENANT_STATUSES: readonly LinkRotationStatus[] = [LinkRotationStatus.ACTIVE, LinkRotationStatus.PAUSED];
const STRATEGIES = new Set<string>(Object.values(LinkRotationStrategy));

/**
 * Status (ACTIVE/PAUSED), estratégia, título e sessão. PAUSED_BY_PLAN é só do sistema
 * (rebaixo de plano): o tenant não grava esse valor, e reativar um rodízio pausado pelo plano
 * só passa se as rotações não pausadas pelo plano ainda couberem em `link_rotations`.
 * Trocar a sessão apaga os grupos (eram da sessão antiga) na mesma transação do repositório.
 */
export class UpdateLinkRotationUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(input: UpdateLinkRotationDTO): Promise<LinkRotationOutputDTO> {
    const { rotations, domains, sessions, entitlements } = this.deps;
    const { tenantId, rotationId } = input;

    const current = await rotations.findById(tenantId, rotationId);
    if (!current) throw new LinkRotationNotFoundError(rotationId);

    const patch: UpdateLinkRotationInput = {};

    if (input.status !== undefined && input.status !== current.status) {
      if (!TENANT_STATUSES.includes(input.status)) throw new ValidationError('Invalid link rotation status');
      // Qualquer volta para ACTIVE (pausa manual ou por plano) precisa caber no plano.
      if (input.status === LinkRotationStatus.ACTIVE) await this.assertFitsPlan(tenantId, rotationId);
      patch.status = input.status;
    }
    if (input.strategy !== undefined) {
      if (!STRATEGIES.has(input.strategy)) throw new ValidationError('Invalid link rotation strategy');
      patch.strategy = input.strategy;
    }
    const title = normalizeTitle(input.title);
    if (title !== undefined) patch.title = title;

    const sessionChanged = input.sessionId !== undefined && input.sessionId !== current.sessionId;
    if (sessionChanged) {
      const session = await sessions.findById(tenantId, input.sessionId!);
      if (!session) throw new SessionNotFoundError(input.sessionId!);
      patch.sessionId = session.id;
    }

    const updated = Object.keys(patch).length > 0 ? await rotations.update(tenantId, rotationId, patch) : current;
    const domain = await domains.findById(current.domainId);
    return toLinkRotationDTO({ ...updated, groups: sessionChanged ? [] : current.groups }, domain);
  }

  private async assertFitsPlan(tenantId: string, rotationId: string): Promise<void> {
    const limit = await this.deps.entitlements.getNumber(tenantId, ENTITLEMENT_KEYS.LINK_ROTATIONS);
    if (limit === null) return;
    const all = await this.deps.rotations.listByTenant(tenantId);
    // Mesma regra do ApplyPlanLimitsToLinkRotationsUseCase: só ACTIVE ocupa vaga.
    const live = all.filter((r) => r.id !== rotationId && r.status === LinkRotationStatus.ACTIVE).length;
    if (live >= limit) throw new PlanLimitReachedError(ENTITLEMENT_KEYS.LINK_ROTATIONS, limit);
  }
}
