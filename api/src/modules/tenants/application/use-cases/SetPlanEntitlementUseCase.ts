import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import { ValidationError } from '../../../../shared/errors/internal/ResourceErrors';
import { adminEntitlementTypeOf, isAdminEditableEntitlementKey, isValidAdminEntitlementValue } from '../../domain/adminEditableEntitlements';
import type { IPlanEntitlementPresetRepository } from '../../domain/contracts/IPlanEntitlementPresetRepository';
import { PLAN_SLUGS, type PlanSlug } from '../../domain/planPresets';

export interface SetPlanEntitlementCommand {
  planSlug: string;
  key: string;
  /** Validado pelo tipo da chave (`adminEditableEntitlements.ts`): boolean ou inteiro na faixa. */
  value: boolean | number;
  /** Super admin que alterou (AuditLog). */
  actorUserId: string;
}

export interface SetPlanEntitlementResult {
  planSlug: PlanSlug;
  key: string;
  value: boolean | number;
  tenantsUpdated: number;
}

/** Repositórios presos à mesma transação: preset + tenants do plano + auditoria num só commit. */
export type PlanEntitlementTransaction = <T>(
  fn: (scope: { presets: IPlanEntitlementPresetRepository; audit: IAuditLogRepository }) => Promise<T>,
) => Promise<T>;

/**
 * Super admin altera uma chave da allowlist num plano (SHEIN-15/16; inteiro na faixa para chave numérica): grava o preset, propaga
 * para todos os tenants do plano e audita (`PLAN_ENTITLEMENT_CHANGED`), tudo na mesma transação.
 * Não chama a central: eventos de billing seguintes leem o preset novo.
 */
export class SetPlanEntitlementUseCase {
  constructor(private readonly transaction: PlanEntitlementTransaction) {}

  async execute(cmd: SetPlanEntitlementCommand): Promise<SetPlanEntitlementResult> {
    if (!isAdminEditableEntitlementKey(cmd.key)) throw new ValidationError('Entitlement key is not editable', { key: cmd.key });
    if (!(PLAN_SLUGS as readonly string[]).includes(cmd.planSlug)) {
      throw new ValidationError('Unknown plan', { planSlug: cmd.planSlug });
    }
    const type = adminEntitlementTypeOf(cmd.key);
    if (!isValidAdminEntitlementValue(type, cmd.value)) {
      throw new ValidationError('Invalid entitlement value', { key: cmd.key, type });
    }
    const planSlug = cmd.planSlug as PlanSlug;
    const { key, value } = cmd;
    return this.transaction(async ({ presets, audit }) => {
      const { tenantsUpdated } = await presets.setForPlan({ planSlug, key, value });
      await audit.create({
        userId: cmd.actorUserId,
        action: 'PLAN_ENTITLEMENT_CHANGED',
        meta: { planSlug, key, value, tenantsUpdated },
      });
      return { planSlug, key, value, tenantsUpdated };
    });
  }
}
