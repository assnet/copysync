import { describe, expect, it } from 'vitest';
import { FeatureAudienceGate } from './FeatureAudienceGate';
import { FeatureAudienceReader } from './FeatureAudienceReader';
import type { FeatureAudienceSettings } from '../../domain/featureAudience';

const defaults = () => ({
  offer_hunter_enabled: true, saver: true,
  marketplace_kabum_enabled: true, marketplace_magalu_enabled: true, marketplace_aliexpress_enabled: true,
});
const SUPER = { isSuperAdmin: true };
const TENANT = { isSuperAdmin: false };

describe('FeatureAudienceGate', () => {
  it('chave nunca gravada = só super admin', async () => {
    const gate = new FeatureAudienceGate(new FeatureAudienceReader({ get: async () => ({}) }, defaults));
    expect(await gate.superAdminOnly('marketplace_kabum_enabled')).toBe(true);
    expect(await gate.isVisible('marketplace_kabum_enabled', SUPER)).toBe(true);
    expect(await gate.isVisible('marketplace_kabum_enabled', TENANT)).toBe(false);
  });

  it('flag desligada = visível para todos', async () => {
    const gate = new FeatureAudienceGate(new FeatureAudienceReader({ get: async () => ({ marketplace_magalu_enabled: false }) }, defaults));
    expect(await gate.superAdminOnly('marketplace_magalu_enabled')).toBe(false);
    expect(await gate.isVisible('marketplace_magalu_enabled', TENANT)).toBe(true);
    expect(await gate.isVisible('marketplace_magalu_enabled', SUPER)).toBe(true);
  });

  it('lê a flag a cada chamada (sem cache)', async () => {
    let saved: FeatureAudienceSettings = {};
    let reads = 0;
    const gate = new FeatureAudienceGate(new FeatureAudienceReader({ get: async () => (reads++, saved) }, defaults));
    expect(await gate.isVisible('marketplace_aliexpress_enabled', TENANT)).toBe(false);
    saved = { marketplace_aliexpress_enabled: false };
    expect(await gate.isVisible('marketplace_aliexpress_enabled', TENANT)).toBe(true);
    saved = { marketplace_aliexpress_enabled: true };
    expect(await gate.isVisible('marketplace_aliexpress_enabled', TENANT)).toBe(false);
    expect(reads).toBe(3);
  });
});
