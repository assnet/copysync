import type { TenantStatus } from '../../domain/entities/Tenant';
import type { ITenantRepository } from '../../domain/contracts/ITenantRepository';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import { internalEventBus } from '../../../../shared/events/InternalEventBus';

export interface UpdateTenantStatusInput {
  tenantId: string;
  status: TenantStatus;
  origin: 'SUPER_ADMIN' | 'BILLING_WEBHOOK';
}

/**
 * Status do tenant. Origem SUPER_ADMIN grava/limpa `adminBlockedAt` SEMPRE (inclusive sem mudança de status)
 * e audita: não-ACTIVE = bloqueio do admin, que o webhook de cobrança e a reconciliação nunca desfazem;
 * ACTIVE = limpa o bloqueio. `suspendedAt` só é gravado na saída de ACTIVE (preserva o início do bloqueio).
 */
export class UpdateTenantStatusUseCase {
  constructor(
    private readonly tenantRepo: ITenantRepository,
    private readonly auditRepo: IAuditLogRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: UpdateTenantStatusInput) {
    const tenant = await this.tenantRepo.findById(input.tenantId);
    if (!tenant) throw new NotFoundError('Tenant');

    const byAdmin = input.origin === 'SUPER_ADMIN';
    const changed = tenant.status !== input.status;
    if (!changed && !byAdmin) return tenant;

    const previousStatus = tenant.status;
    const active = input.status === 'ACTIVE';
    const now = this.now();
    const suspendedAt = active ? null : (previousStatus === 'ACTIVE' ? now : tenant.suspendedAt ?? now);
    const adminBlockedAt = byAdmin ? (active ? null : now) : undefined;

    const updated = await this.tenantRepo.updateStatus(input.tenantId, input.status, suspendedAt, adminBlockedAt);

    await this.auditRepo.create({
      tenantId: input.tenantId,
      action: 'TENANT_STATUS_CHANGED',
      meta: { origin: input.origin, previousStatus, newStatus: input.status, ...(byAdmin && { adminBlocked: !active }) },
    });

    if (changed && !active) {
      internalEventBus.emit('TENANT_SUSPENDED', { type: 'TENANT_SUSPENDED', tenantId: input.tenantId });
    }

    return updated;
  }
}
