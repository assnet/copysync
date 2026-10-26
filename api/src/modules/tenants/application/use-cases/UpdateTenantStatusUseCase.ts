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

export class UpdateTenantStatusUseCase {
  constructor(
    private readonly tenantRepo: ITenantRepository,
    private readonly auditRepo: IAuditLogRepository,
  ) {}

  async execute(input: UpdateTenantStatusInput) {
    const tenant = await this.tenantRepo.findById(input.tenantId);
    if (!tenant) throw new NotFoundError('Tenant');

    if (tenant.status === input.status) return tenant;

    const previousStatus = tenant.status;
    const suspendedAt = input.status === 'ACTIVE' ? null : new Date();

    const updated = await this.tenantRepo.updateStatus(input.tenantId, input.status, suspendedAt);

    await this.auditRepo.create({
      tenantId: input.tenantId,
      action: 'TENANT_STATUS_CHANGED',
      meta: { origin: input.origin, previousStatus, newStatus: input.status },
    });

    if (input.status === 'SUSPENDED' || input.status === 'CANCELLED') {
      internalEventBus.emit('TENANT_SUSPENDED', {
        type: 'TENANT_SUSPENDED',
        tenantId: input.tenantId,
      });
    }

    return updated;
  }
}
