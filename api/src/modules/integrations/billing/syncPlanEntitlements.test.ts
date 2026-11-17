import { describe, expect, it, vi } from 'vitest';

vi.mock('./applyPlanSideEffects', () => ({ applyPlanSideEffects: vi.fn(async () => ({ linkRotations: {}, storefront: null })) }));

import { syncPlanEntitlements } from './syncPlanEntitlements';

function fakeTx() {
  const written: Array<[string, unknown]> = [];
  const tx = {
    planEntitlementPreset: { findMany: async () => [{ key: 'whatsapp_sessions', value: 2 }, { key: 'saver_contacts', value: 100 }] },
    tenantEntitlement: { upsert: async ({ create }: { create: { key: string; value: unknown } }) => { written.push([create.key, create.value]); return {}; } },
  };
  return { tx: tx as never, written };
}

describe('syncPlanEntitlements', () => {
  it('sem excludeKeys grava todo o preset (saída de hoje)', async () => {
    const { tx, written } = fakeTx();
    await syncPlanEntitlements(tx, 't1', 'SAVER_PRO');
    expect(written).toEqual([['whatsapp_sessions', 2], ['saver_contacts', 100]]);
  });

  it('excludeKeys pula as chaves informadas', async () => {
    const { tx, written } = fakeTx();
    await syncPlanEntitlements(tx, 't1', 'SAVER_PRO', { excludeKeys: ['whatsapp_sessions'] });
    expect(written).toEqual([['saver_contacts', 100]]);
  });
});
