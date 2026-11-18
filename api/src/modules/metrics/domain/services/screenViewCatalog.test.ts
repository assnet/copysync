import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FEATURE_USAGE_CATALOG, sourceOn } from './featureUsageCatalog';
import { SCREEN_VIEW_CATALOG, SCREEN_VIEW_KEYS, findScreenView, screenAsFeature } from './screenViewCatalog';

const contract = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../../../contracts/feature-usage/catalog.json'), 'utf8'),
) as { featureKeys: string[]; screenKeys: string[]; screenProducts: Record<string, string> };

describe('telas medidas por visita', () => {
  it('mesma lista do contrato, separada das chaves de recurso', () => {
    expect([...SCREEN_VIEW_KEYS]).toEqual(contract.screenKeys);
    // Produto de cada tela: o painel o usa para distinguir telas de mesmo nome ("Configurações · Saver")
    expect(Object.fromEntries(SCREEN_VIEW_CATALOG.map((s) => [s.key, s.product]))).toEqual(contract.screenProducts);
    for (const k of contract.screenKeys) expect(contract.featureKeys).not.toContain(k);
  });

  it('chaves view:<chave do menu> únicas, sem a marca e fora do catálogo de recursos (resumo e rollup)', () => {
    expect(new Set(SCREEN_VIEW_KEYS).size).toBe(SCREEN_VIEW_KEYS.length);
    for (const k of SCREEN_VIEW_KEYS) expect(k).toMatch(/^view:[a-z]+(-[a-z]+)*$/);
    expect(JSON.stringify(SCREEN_VIEW_CATALOG).toLowerCase()).not.toMatch(/copysync|waioprime/);
    expect(FEATURE_USAGE_CATALOG.some((f) => (f.key as string).startsWith('view:'))).toBe(false);
  });

  it('só do contador, tipo acesso, sem data de corte: conta em qualquer dia', () => {
    for (const s of SCREEN_VIEW_CATALOG) {
      expect(s.source).toBe('RECORDED');
      expect(s.kinds).toEqual(['ACCESS']);
      const f = screenAsFeature(s);
      expect(f.recordedFrom).toBe('FIRST_WRITE');
      expect(sourceOn(f, '2020-01-01')).toBe('RECORDED');
    }
  });

  it('telas do Saver na família do Saver; Chat e telas do super admin fora', () => {
    expect(SCREEN_VIEW_CATALOG.filter((s) => s.planFamily === 'SAVER').map((s) => s.key)).toEqual([
      'view:saver-groups',
      'view:saver-settings',
      'view:saver-plans',
    ]);
    expect(findScreenView('view:chat')).toBeUndefined();
    expect(SCREEN_VIEW_KEYS.some((k) => k.startsWith('view:admin'))).toBe(false);
    expect(findScreenView('offers')).toBeUndefined();
  });
});
