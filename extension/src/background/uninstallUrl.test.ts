import { describe, it, expect } from 'vitest';
import { buildUninstallUrl, UNINSTALL_URL_MAX_LENGTH } from './uninstallUrl.js';

describe('buildUninstallUrl', () => {
  it('monta /extension-removed com i, e, v codificados', () => {
    const url = buildUninstallUrl('https://app.test.local', 'inst 1&x', 'abc', '3.3.0');
    expect(url).toBe('https://app.test.local/extension-removed?i=inst+1%26x&e=abc&v=3.3.0');
  });

  it('aceita panelUrl com barra final', () => {
    expect(buildUninstallUrl('https://app.test.local/', 'i', 'e', '1')).toBe(
      'https://app.test.local/extension-removed?i=i&e=e&v=1',
    );
  });

  it('panelUrl vazio ou inválido → null', () => {
    expect(buildUninstallUrl('', 'i', 'e', '1')).toBeNull();
    expect(buildUninstallUrl('not a url', 'i', 'e', '1')).toBeNull();
  });

  it('acima de 1023 chars → null', () => {
    const long = 'x'.repeat(UNINSTALL_URL_MAX_LENGTH);
    expect(buildUninstallUrl('https://app.test.local', long, 'e', '1')).toBeNull();
    const ok = buildUninstallUrl('https://app.test.local', 'i', 'e', '1');
    expect(ok!.length).toBeLessThanOrEqual(UNINSTALL_URL_MAX_LENGTH);
  });
});
