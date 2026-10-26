import { describe, it, expect } from 'vitest';
import { isPlatformAvailable, isValidAiSettings, resolveAiMode } from './aiModes';

const base = {
  settings: { platformEnabled: true, tenantKeysEnabled: true },
  entitlementEnabled: true,
  hasEnabledPlatformProvider: true,
  tenantCredentialEnabled: true,
};

describe('isValidAiSettings', () => {
  it('recusa só os dois desligados', () => {
    expect(isValidAiSettings({ platformEnabled: false, tenantKeysEnabled: false })).toBe(false);
    expect(isValidAiSettings({ platformEnabled: true, tenantKeysEnabled: false })).toBe(true);
    expect(isValidAiSettings({ platformEnabled: false, tenantKeysEnabled: true })).toBe(true);
  });
});

describe('resolveAiMode', () => {
  it.each([
    ['plataforma disponível', base, 'PLATFORM'],
    ['plataforma desligada → chave do tenant', { ...base, settings: { platformEnabled: false, tenantKeysEnabled: true } }, 'TENANT'],
    ['plano sem IA → chave do tenant', { ...base, entitlementEnabled: false }, 'TENANT'],
    ['sem provedor ativo → chave do tenant', { ...base, hasEnabledPlatformProvider: false }, 'TENANT'],
    ['chaves de tenant desligadas', { ...base, hasEnabledPlatformProvider: false, settings: { platformEnabled: true, tenantKeysEnabled: false } }, 'NONE'],
    ['credencial inativa', { ...base, hasEnabledPlatformProvider: false, tenantCredentialEnabled: false }, 'NONE'],
  ] as const)('%s', (_name, facts, mode) => {
    expect(resolveAiMode(facts)).toBe(mode);
    expect(isPlatformAvailable(facts)).toBe(mode === 'PLATFORM');
  });
});
