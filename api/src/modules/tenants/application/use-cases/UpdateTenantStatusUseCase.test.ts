import { describe, expect, it, vi } from 'vitest';

const emit = vi.hoisted(() => vi.fn());
vi.mock('../../../../shared/events/InternalEventBus', () => ({ internalEventBus: { emit } }));

import { UpdateTenantStatusUseCase } from './UpdateTenantStatusUseCase';
import type { ITenantRepository } from '../../domain/contracts/ITenantRepository';

const NOW = new Date('2026-11-07T12:00:00Z');
const SINCE = new Date('2026-10-01T00:00:00Z');

function setup(status: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED', suspendedAt: Date | null = null) {
  const tenant = { id: 't1', status, suspendedAt };
  const updateStatus = vi.fn(async (_id: string, s: string, sa: Date | null) => ({ ...tenant, status: s, suspendedAt: sa }));
  const repo = { findById: vi.fn(async () => tenant), updateStatus } as unknown as ITenantRepository;
  const audit = { create: vi.fn(async () => undefined) };
  emit.mockReset();
  return { uc: new UpdateTenantStatusUseCase(repo, audit, () => NOW), updateStatus, audit };
}

describe('UpdateTenantStatusUseCase (adminBlockedAt)', () => {
  it('super-admin suspende: grava adminBlockedAt e suspendedAt, audita e emite', async () => {
    const { uc, updateStatus, audit } = setup('ACTIVE');
    await uc.execute({ tenantId: 't1', status: 'SUSPENDED', origin: 'SUPER_ADMIN' });
    expect(updateStatus).toHaveBeenCalledWith('t1', 'SUSPENDED', NOW, NOW);
    expect(audit.create).toHaveBeenCalledWith(expect.objectContaining({ meta: expect.objectContaining({ origin: 'SUPER_ADMIN', adminBlocked: true }) }));
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('super-admin com o mesmo status (já suspenso por cobrança): marca bloqueio, mantém suspendedAt, audita, não reemite', async () => {
    const { uc, updateStatus, audit } = setup('SUSPENDED', SINCE);
    await uc.execute({ tenantId: 't1', status: 'SUSPENDED', origin: 'SUPER_ADMIN' });
    expect(updateStatus).toHaveBeenCalledWith('t1', 'SUSPENDED', SINCE, NOW);
    expect(audit.create).toHaveBeenCalledTimes(1);
    expect(emit).not.toHaveBeenCalled();
  });

  it('super-admin reativa: limpa adminBlockedAt e suspendedAt', async () => {
    const { uc, updateStatus } = setup('CANCELLED', SINCE);
    await uc.execute({ tenantId: 't1', status: 'ACTIVE', origin: 'SUPER_ADMIN' });
    expect(updateStatus).toHaveBeenCalledWith('t1', 'ACTIVE', null, null);
  });

  it('origem de cobrança sem mudança: no-op; com mudança não toca adminBlockedAt', async () => {
    const same = setup('SUSPENDED', SINCE);
    await same.uc.execute({ tenantId: 't1', status: 'SUSPENDED', origin: 'BILLING_WEBHOOK' });
    expect(same.updateStatus).not.toHaveBeenCalled();
    const change = setup('ACTIVE');
    await change.uc.execute({ tenantId: 't1', status: 'SUSPENDED', origin: 'BILLING_WEBHOOK' });
    expect(change.updateStatus).toHaveBeenCalledWith('t1', 'SUSPENDED', NOW, undefined);
  });
});
