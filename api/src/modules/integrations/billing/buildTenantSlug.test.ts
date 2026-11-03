import { describe, expect, it } from 'vitest';
import { buildTenantSlug, tenantNameFrom } from './buildTenantSlug';

describe('buildTenantSlug', () => {
  it('remove acentos e símbolos e acrescenta o sufixo', () => {
    expect(buildTenantSlug('  João & Cia. Ltda ', 'a1b2c3')).toBe('joao-cia-ltda-a1b2c3');
  });

  it('nome sem letras vira "conta"', () => {
    expect(buildTenantSlug('***', 'ff00ff')).toBe('conta-ff00ff');
  });

  it('sufixo aleatório muda a cada chamada e respeita o padrão do slug', () => {
    const a = buildTenantSlug('Ana');
    expect(a).toMatch(/^ana-[a-f0-9]{6}$/);
    expect(buildTenantSlug('Ana')).not.toBe(a);
  });
});

describe('tenantNameFrom', () => {
  it('usa o nome ou a parte local do e-mail', () => {
    expect(tenantNameFrom(' Ana ', 'x@y.com')).toBe('Ana');
    expect(tenantNameFrom(undefined, 'bia.silva@y.com')).toBe('bia.silva');
  });
});
