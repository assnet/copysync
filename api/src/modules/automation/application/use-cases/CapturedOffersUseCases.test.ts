import { describe, expect, it } from 'vitest';
import { ListCapturedOffersUseCase, RetryCapturedOfferUseCase, CAPTURED_PAGE_SIZE } from './CapturedOffersUseCases';
import { InMemoryCapturedOfferRepository, InMemoryGroupMonitorRepository, NOW, SESSION, TENANT } from './monitorTestFakes';

async function setup(n = 1) {
  const captured = new InMemoryCapturedOfferRepository();
  const monitors = new InMemoryGroupMonitorRepository();
  for (let i = 0; i < n; i++) {
    await captured.createPending({
      tenantId: TENANT, sessionId: SESSION, configId: 'cfg', monitoredGroupId: 'mg', sourceExternalMessageId: `m${i}`,
      sourceText: 'oferta https://amzn.to/a', sourceMediaUrl: null, imageUnavailable: false, capturedAt: NOW,
    });
  }
  const deps = { captured, monitors };
  return { captured, list: new ListCapturedOffersUseCase(deps), retry: new RetryCapturedOfferUseCase(deps) };
}

describe('CapturedOffersUseCases', () => {
  it('pagina pelo cursor assinado', async () => {
    const s = await setup(CAPTURED_PAGE_SIZE + 3);
    const p1 = await s.list.execute({ tenantId: TENANT, sessionId: SESSION });
    expect(p1.items).toHaveLength(CAPTURED_PAGE_SIZE);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await s.list.execute({ tenantId: TENANT, sessionId: SESSION, cursor: p1.nextCursor! });
    expect(p2.items).toHaveLength(3);
    expect(p2.nextCursor).toBeNull();
  });

  it('retry: só SKIPPED/FAILED recuperável volta para PENDING', async () => {
    const s = await setup(2);
    Object.assign(s.captured.items[0]!, { status: 'SKIPPED', reason: 'CREDENTIAL_MISSING' });
    Object.assign(s.captured.items[1]!, { status: 'SKIPPED', reason: 'EXPIRED' });
    expect(await s.retry.execute({ tenantId: TENANT, id: 'cap-1' })).toMatchObject({ status: 'PENDING', reason: null });
    await expect(s.retry.execute({ tenantId: TENANT, id: 'cap-2' })).rejects.toMatchObject({ code: 'CAPTURED_OFFER_NOT_RETRYABLE' });
    await expect(s.retry.execute({ tenantId: 'outro', id: 'cap-1' })).rejects.toMatchObject({ code: 'CAPTURED_OFFER_NOT_FOUND' });
  });
});
