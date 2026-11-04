import { describe, expect, it, vi } from 'vitest';
import { PrismaEntitlementReader } from './PrismaEntitlementReader';

describe('PrismaEntitlementReader.readAll', () => {
  it('faz 1 findMany filtrado por tenant e devolve mapa chave → valor cru', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { key: 'whatsapp_sessions', value: 3 },
      { key: 'ai_rewrite_enabled', value: false },
      { key: 'telegram_sessions', value: null },
    ]);
    const reader = new PrismaEntitlementReader({ tenantEntitlement: { findMany } } as never);
    const snap = await reader.readAll('t1');
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({ where: { tenantId: 't1' }, select: { key: true, value: true } });
    expect(snap).toEqual({ whatsapp_sessions: 3, ai_rewrite_enabled: false, telegram_sessions: null });
  });

  it('sem linhas devolve objeto vazio', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const reader = new PrismaEntitlementReader({ tenantEntitlement: { findMany } } as never);
    expect(await reader.readAll('t1')).toEqual({});
  });
});
