import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import { InvalidInfraCostSettingsError } from '../../../../shared/errors/internal/InfraCostErrors';
import type { IInfraCostSettingsRepository } from '../../domain/contracts/IInfraCostSettingsRepository';
import { parseInfraCostSettings, resolveInfraCostSettings } from '../../domain/services/infraCostSettings';
import type { InfraCostSettingsView } from './GetInfraCostSettingsUseCase';

export interface UpdateInfraCostSettingsCommand {
  /** Documento inteiro; validado aqui (400 com `field`). */
  settings: unknown;
  /** `updatedAt` lido no GET; `null` = não havia linha. */
  expectedUpdatedAt: string | null;
  /** Super admin que salvou (auditoria e `updatedById`). */
  actorUserId: string;
}

/**
 * Super admin grava a configuração de custos (COST-01/03): valida o documento inteiro, grava com
 * controle de concorrência (`InfraCostSettingsConflictError` 409 propaga sem auditar) e audita
 * antes/depois (`INFRA_COST_SETTINGS_CHANGED`). Preços em USD da infraestrutura; nunca preço de plano do produto.
 */
export class UpdateInfraCostSettingsUseCase {
  constructor(
    private readonly repository: IInfraCostSettingsRepository,
    private readonly audit: IAuditLogRepository,
  ) {}

  async execute(cmd: UpdateInfraCostSettingsCommand): Promise<InfraCostSettingsView> {
    const settings = parseInfraCostSettings(cmd.settings);
    const expectedUpdatedAt = parseExpectedUpdatedAt(cmd.expectedUpdatedAt);

    const before = resolveInfraCostSettings(await this.repository.get()).value;
    const saved = await this.repository.save(settings, cmd.actorUserId, expectedUpdatedAt);
    await this.audit.create({
      userId: cmd.actorUserId,
      action: 'INFRA_COST_SETTINGS_CHANGED',
      meta: { before, after: settings },
    });
    return { settings, origin: 'saved', updatedAt: saved.updatedAt.toISOString() };
  }
}

function parseExpectedUpdatedAt(raw: string | null): Date | null {
  if (raw === null) return null;
  const date = typeof raw === 'string' ? new Date(raw) : new Date(Number.NaN);
  if (Number.isNaN(date.getTime())) {
    throw new InvalidInfraCostSettingsError('expectedUpdatedAt', 'must be an ISO date or null');
  }
  return date;
}
