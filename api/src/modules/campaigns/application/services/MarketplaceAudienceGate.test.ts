import { describe, expect, it } from 'vitest';
import { MarketplaceAudienceGate } from './MarketplaceAudienceGate';
import { FeatureAudienceGate } from '../../../tenants/application/services/FeatureAudienceGate';
import type { FeatureAudienceKey } from '../../../tenants/domain/featureAudience';

function gateWith(flags: () => Partial<Record<FeatureAudienceKey, boolean>>) {
  const asked: FeatureAudienceKey[] = [];
  const reader = { superAdminOnly: async (k: FeatureAudienceKey) => (asked.push(k), flags()[k] ?? true) };
  return { gate: new MarketplaceAudienceGate(new FeatureAudienceGate(reader)), asked };
}
const SUPER = { isSuperAdmin: true };
const TENANT = { isSuperAdmin: false };

describe('MarketplaceAudienceGate', () => {
  it('lojas antigas sempre visíveis, sem ler flag', async () => {
    const { gate, asked } = gateWith(() => ({}));
    for (const p of ['SHOPEE', 'MERCADO_LIVRE', 'AMAZON', 'SHEIN'] as const) {
      expect(await gate.isVisible(p, TENANT)).toBe(true);
      expect(await gate.superAdminOnly(p)).toBe(false);
    }
    expect(asked).toEqual([]);
  });

  it('lojas novas: nunca gravada = só super admin, cada uma pela própria chave', async () => {
    const { gate, asked } = gateWith(() => ({}));
    for (const p of ['KABUM', 'MAGALU', 'ALIEXPRESS'] as const) {
      expect(await gate.isVisible(p, TENANT)).toBe(false);
      expect(await gate.isVisible(p, SUPER)).toBe(true);
      expect(await gate.superAdminOnly(p)).toBe(true);
    }
    expect(new Set(asked)).toEqual(new Set(['marketplace_kabum_enabled', 'marketplace_magalu_enabled', 'marketplace_aliexpress_enabled']));
  });

  it('flag desligada = visível para todos; lida a cada chamada', async () => {
    let flags: Partial<Record<FeatureAudienceKey, boolean>> = { marketplace_kabum_enabled: false };
    const { gate } = gateWith(() => flags);
    expect(await gate.isVisible('KABUM', TENANT)).toBe(true);
    expect(await gate.isVisible('MAGALU', TENANT)).toBe(false);
    flags = { marketplace_kabum_enabled: true };
    expect(await gate.isVisible('KABUM', TENANT)).toBe(false);
    expect(await gate.superAdminOnly('KABUM')).toBe(true);
  });
});
