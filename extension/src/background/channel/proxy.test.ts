import { describe, it, expect } from 'vitest';
import { isTrustedProxySender, senderOrigin } from './proxy';
import { buildPanelOrigins, isPanelOrigin } from '../../core/panelOrigin';

const SELF = 'self-id';

describe('proxy sender', () => {
  it('aceita content script desta extensão no painel', () => {
    expect(isTrustedProxySender({ id: SELF, frameId: 0, origin: 'https://app.test.local' }, SELF, isPanelOrigin)).toBe(true);
  });
  it('usa url/tab.url quando origin falta', () => {
    expect(senderOrigin({ url: 'https://app.test.local/x?y' })).toBe('https://app.test.local');
    expect(isTrustedProxySender({ id: SELF, tab: { url: 'https://app.test.local/' } }, SELF, isPanelOrigin)).toBe(true);
  });
  it('recusa outra extensão, iframe, origem estranha ou sem origem', () => {
    expect(isTrustedProxySender({ id: 'outra', origin: 'https://app.test.local' }, SELF, isPanelOrigin)).toBe(false);
    expect(isTrustedProxySender({ id: SELF, frameId: 2, origin: 'https://app.test.local' }, SELF, isPanelOrigin)).toBe(false);
    expect(isTrustedProxySender({ id: SELF, origin: 'https://app.test.local.evil.com' }, SELF, isPanelOrigin)).toBe(false);
    expect(isTrustedProxySender({ id: SELF }, SELF, isPanelOrigin)).toBe(false);
    expect(isTrustedProxySender(undefined, SELF, isPanelOrigin)).toBe(false);
  });
});

describe('panelOrigin', () => {
  it('monta origens exatas a partir de PANEL_URL e DEV_ORIGINS', () => {
    expect(buildPanelOrigins('https://app.x.app/', ['http://localhost:5173/*', 'lixo'])).toEqual(['https://app.x.app', 'http://localhost:5173']);
  });
  it('compara origem exata', () => {
    expect(isPanelOrigin('https://app.test.local')).toBe(true);
    expect(isPanelOrigin('https://app.test.local:8443')).toBe(false);
    expect(isPanelOrigin(undefined)).toBe(false);
  });
});
