import { describe, expect, it } from 'vitest';
import type { AffiliateCredentialItem, MarketplaceAvailability } from '@/types/api.types';
import { sheinCardState, showsRiskBanner, type SheinCardStateInput } from './sheinCardState';

const avail = (over: Partial<MarketplaceAvailability> = {}): MarketplaceAvailability => ({
  enabled: true, plans: ['COPYSYNC_MAX'], riskNotice: { version: '2026-11-10', acceptedAt: '2026-11-10T12:00:00.000Z', acceptedByMe: true }, ...over,
});
const item = (over: Partial<AffiliateCredentialItem> = {}): AffiliateCredentialItem => ({
  provider: 'SHEIN', status: 'ACTIVE', publicIdentifier: '123', publicIdentifierMasked: '••23', hasSecret: false,
  hasSession: true, sessionSyncedAt: '2026-11-10T12:00:00.000Z', lastValidatedAt: null, rejectedAt: null,
  rejectedCode: null, updatedAt: '2026-11-10T12:00:00.000Z', ...over,
});
const base: SheinCardStateInput = {
  availability: avail(), extStatus: 'connected', extLoading: false, supportsShein: true, noLinkFlag: false,
};

describe('sheinCardState', () => {
  it('cobre os 6 estados + reaceite', () => {
    expect(sheinCardState({ ...base, availability: avail({ enabled: false }) })).toBe('locked');
    expect(sheinCardState({ ...base, extStatus: 'not_detected' })).toBe('no_extension');
    expect(sheinCardState({ ...base, supportsShein: false })).toBe('outdated_extension');
    expect(sheinCardState({ ...base, extStatus: 'detected' })).toBe('no_link');
    expect(sheinCardState(base)).toBe('ready');
    expect(sheinCardState({ ...base, item: item() })).toBe('connected');
    expect(sheinCardState({ ...base, item: item({ rejectedAt: '2026-11-10T13:00:00.000Z' }) })).toBe('rejected');
    expect(sheinCardState({
      ...base, item: item(), availability: avail({ riskNotice: { version: '2026-12-01', acceptedAt: null, acceptedByMe: false } }),
    })).toBe('reaccept');
  });

  it('sem vínculo pela flag do 404 mesmo com a extensão autenticada', () => {
    expect(sheinCardState({ ...base, noLinkFlag: true })).toBe('no_link');
  });

  it('sem aceite e sem credencial é "pronto" (o diálogo abre no clique), não reaceite', () => {
    expect(sheinCardState({ ...base, availability: avail({ riskNotice: { version: 'v', acceptedAt: null, acceptedByMe: false } }) }))
      .toBe('ready');
  });

  it('riskNotice null conta como aceite pendente', () => {
    expect(sheinCardState({ ...base, item: item(), availability: avail({ riskNotice: null }) })).toBe('reaccept');
    expect(sheinCardState({ ...base, availability: avail({ riskNotice: null }) })).toBe('ready');
  });

  it('availability ausente com credencial: pede reaceite (lado seguro)', () => {
    expect(sheinCardState({ ...base, availability: undefined, item: item() })).toBe('reaccept');
  });

  it('faixa de aviso em todo estado menos travado', () => {
    expect(showsRiskBanner('locked')).toBe(false);
    for (const s of ['no_extension', 'outdated_extension', 'no_link', 'ready', 'connected', 'rejected', 'reaccept'] as const) {
      expect(showsRiskBanner(s)).toBe(true);
    }
  });
});
