import { describe, expect, it, vi } from 'vitest';
import { SetFeatureAudienceUseCase, type FeatureAudienceTransaction } from './SetFeatureAudienceUseCase';
import { ValidationError } from '../../../../shared/errors/internal/ResourceErrors';
import { FeatureAudienceReader } from '../services/FeatureAudienceReader';
import { parseFeatureAudience } from '../../domain/featureAudience';

function setup() {
  const calls: string[] = [];
  const audience = { set: vi.fn(async () => { calls.push('set'); }) };
  const audit = { create: vi.fn(async () => { calls.push('audit'); }) };
  const transaction = vi.fn(async (fn) => {
    calls.push('begin');
    const r = await fn({ audience, audit });
    calls.push('commit');
    return r;
  }) as unknown as FeatureAudienceTransaction;
  return { uc: new SetFeatureAudienceUseCase(transaction), audience, audit, calls };
}

describe('SetFeatureAudienceUseCase', () => {
  it('grava a flag e audita PLAN_ENTITLEMENT_CHANGED com meta.audience na mesma transação', async () => {
    const { uc, audience, audit, calls } = setup();
    expect(await uc.execute({ key: 'offer_hunter_enabled', superAdminOnly: false, actorUserId: 'admin-1' }))
      .toEqual({ key: 'offer_hunter_enabled', superAdminOnly: false });
    expect(audience.set).toHaveBeenCalledWith('offer_hunter_enabled', false, 'admin-1');
    expect(audit.create).toHaveBeenCalledWith({
      userId: 'admin-1', action: 'PLAN_ENTITLEMENT_CHANGED', meta: { key: 'offer_hunter_enabled', audience: { superAdminOnly: false } },
    });
    expect(calls).toEqual(['begin', 'set', 'audit', 'commit']);
  });

  it('lojas Kabum/Magalu/AliExpress têm audiência: grava e audita', async () => {
    const { uc, audience, audit } = setup();
    for (const key of ['marketplace_kabum_enabled', 'marketplace_magalu_enabled', 'marketplace_aliexpress_enabled']) {
      expect(await uc.execute({ key, superAdminOnly: false, actorUserId: 'admin-1' })).toEqual({ key, superAdminOnly: false });
      expect(audience.set).toHaveBeenCalledWith(key, false, 'admin-1');
      expect(audit.create).toHaveBeenCalledWith({ userId: 'admin-1', action: 'PLAN_ENTITLEMENT_CHANGED', meta: { key, audience: { superAdminOnly: false } } });
    }
  });

  it('foto oficial e marca d\'água têm audiência: grava e audita', async () => {
    const { uc, audience, audit } = setup();
    for (const key of ['offer_clean_image_enabled', 'offer_watermark_enabled']) {
      expect(await uc.execute({ key, superAdminOnly: false, actorUserId: 'admin-1' })).toEqual({ key, superAdminOnly: false });
      expect(audience.set).toHaveBeenCalledWith(key, false, 'admin-1');
      expect(audit.create).toHaveBeenCalledWith({ userId: 'admin-1', action: 'PLAN_ENTITLEMENT_CHANGED', meta: { key, audience: { superAdminOnly: false } } });
    }
  });

  it('chave sem audiência → ValidationError (400), sem transação', async () => {
    const { uc, calls } = setup();
    for (const key of ['marketplace_shein_enabled', 'offer_hunter_finds_per_day', 'x']) {
      await expect(uc.execute({ key, superAdminOnly: true, actorUserId: 'a' })).rejects.toBeInstanceOf(ValidationError);
    }
    expect(calls).toEqual([]);
  });
});

describe('FeatureAudienceReader', () => {
  it('gravado vence; ausente = valor inicial (env) lido a cada uso', async () => {
    let saved = {};
    let initial = true;
    const reader = new FeatureAudienceReader({ get: async () => saved }, () => ({
      offer_hunter_enabled: initial, saver: true,
      marketplace_kabum_enabled: true, marketplace_magalu_enabled: true, marketplace_aliexpress_enabled: true,
      offer_clean_image_enabled: true, offer_watermark_enabled: true,
    }));
    expect(await reader.superAdminOnly('offer_hunter_enabled')).toBe(true);
    initial = false;
    expect(await reader.superAdminOnly('offer_hunter_enabled')).toBe(false);
    saved = { offer_hunter_enabled: true };
    expect(await reader.superAdminOnly('offer_hunter_enabled')).toBe(true);
    // Chaves independentes: a do Saver segue o próprio valor inicial.
    expect(await reader.superAdminOnly('saver')).toBe(true);
    saved = { offer_hunter_enabled: true, saver: false };
    expect(await reader.superAdminOnly('saver')).toBe(false);
  });

  it('parse: só chave conhecida com boolean; lixo = ausente', () => {
    expect(parseFeatureAudience({ offer_hunter_enabled: false, other: true })).toEqual({ offer_hunter_enabled: false });
    expect(parseFeatureAudience({ saver: false })).toEqual({ saver: false });
    expect(parseFeatureAudience({ offer_hunter_enabled: 'false' })).toEqual({});
    expect(parseFeatureAudience([true])).toEqual({});
    expect(parseFeatureAudience(null)).toEqual({});
  });
});
