import { describe, it, expect } from 'vitest';
import { GetOfferGeneratorConfigUseCase, SaveOfferGeneratorConfigUseCase } from './OfferGeneratorConfigUseCases';
import { FakeEntitlementReader, InMemoryOfferGeneratorConfigRepository, TENANT } from './offerTestFakes';

function setup(entitlements: Record<string, unknown> = {}) {
  const configs = new InMemoryOfferGeneratorConfigRepository(
    [
      { id: 's1', tenantId: TENANT, status: 'CONNECTED' },
      { id: 's2', tenantId: TENANT, status: 'CONNECTED' },
      { id: 'sx', tenantId: 'other', status: 'CONNECTED' },
    ],
    [
      { id: 'g1', tenantId: TENANT, sessionId: 's1', isGroup: true, title: 'Grupo 1' },
      { id: 'g2', tenantId: TENANT, sessionId: 's1', isGroup: true },
      { id: 'g3', tenantId: TENANT, sessionId: 's2', isGroup: true },
      { id: 'dm', tenantId: TENANT, sessionId: 's1', isGroup: false },
      { id: 'gx', tenantId: 'other', sessionId: 's1', isGroup: true },
    ],
  );
  const deps = { configs, entitlements: new FakeEntitlementReader(entitlements) };
  return { configs, get: new GetOfferGeneratorConfigUseCase(deps), save: new SaveOfferGeneratorConfigUseCase(deps) };
}

const base = { tenantId: TENANT, sessionId: 's1', intervalMinSeconds: 120, intervalMaxSeconds: 300 };

describe('Offer generator config', () => {
  it('sem configuração: padrões, sem grupos, limite do plano', async () => {
    const s = setup({ broadcast_groups: 5 });
    expect(await s.get.execute(TENANT)).toEqual({
      sessionId: null, intervalMinSeconds: 120, intervalMaxSeconds: 300, groups: [], groupLimit: 5, configured: false,
    });
  });

  it('salva, deduplica e devolve grupos com título', async () => {
    const s = setup();
    const out = await s.save.execute({ ...base, conversationIds: ['g1', 'g2', 'g1'] });
    expect(out).toMatchObject({ sessionId: 's1', configured: true, groupLimit: null });
    expect(out.groups).toEqual([
      { id: 'g1', title: 'Grupo 1', avatarUrl: null, sessionId: 's1' },
      { id: 'g2', title: 'g2', avatarUrl: null, sessionId: 's1' },
    ]);
  });

  it.each([
    ['grupo de outra sessão', 'g3'],
    ['conversa que não é grupo', 'dm'],
    ['grupo de outro tenant', 'gx'],
  ])('%s → NOT_FOUND e nada muda', async (_label, id) => {
    const s = setup();
    await expect(s.save.execute({ ...base, conversationIds: ['g1', id] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(s.configs.saves).toBe(0);
  });

  it('sessão de outro tenant → NOT_FOUND', async () => {
    const s = setup();
    await expect(s.save.execute({ ...base, sessionId: 'sx', conversationIds: [] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('acima de broadcast_groups → PLAN_LIMIT_REACHED', async () => {
    const s = setup({ broadcast_groups: 1 });
    await expect(s.save.execute({ ...base, conversationIds: ['g1', 'g2'] })).rejects.toMatchObject({
      code: 'PLAN_LIMIT_REACHED', statusCode: 403, meta: { key: 'broadcast_groups', limit: 1 },
    });
    expect(s.configs.saves).toBe(0);
  });

  it.each([
    [59, 600, 'intervalMinSeconds'],
    [600, 3601, 'intervalMaxSeconds'],
    [1200, 600, 'intervalMaxSeconds'],
    [90.5, 600, 'intervalMinSeconds'],
  ])('intervalo %s–%s → OFFER_INVALID_INPUT (%s)', async (min, max, field) => {
    const s = setup();
    await expect(
      s.save.execute({ ...base, intervalMinSeconds: min, intervalMaxSeconds: max, conversationIds: [] }),
    ).rejects.toMatchObject({ code: 'OFFER_INVALID_INPUT', meta: { field } });
  });

  it('min = max é válido; lista vazia limpa os grupos', async () => {
    const s = setup();
    s.configs.selected.set(TENANT, ['g1']);
    const out = await s.save.execute({ ...base, intervalMinSeconds: 600, intervalMaxSeconds: 600, conversationIds: [] });
    expect(out.groups).toEqual([]);
  });
});
