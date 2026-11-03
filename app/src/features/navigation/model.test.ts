import { describe, expect, it } from 'vitest';
import { buildNavigation, findActiveEntry, linkMatches } from './model';

describe('buildNavigation', () => {
  it('ordena os produtos com Afiliados primeiro e cinco no total', () => {
    const model = buildNavigation({ isSuperAdmin: false });
    expect(model.products.map((p) => p.key)).toEqual([
      'affiliates', 'crm-automation', 'group-manager', 'saver', 'chip-warmer',
    ]);
    expect(model.products[0].status).toBe('available');
    expect(model.products[0].children.map((c) => c.path)).toEqual([
      '/offers', '/monitoring', '/link-rotation', '/storefront', '/offer-story',
    ]);
  });

  it('Dashboard no topo; bloco inferior com planos, privacidade e configurações', () => {
    const model = buildNavigation({ isSuperAdmin: false });
    expect(model.top.map((l) => l.path)).toEqual(['/dashboard']);
    expect(model.bottom.map((e) => e.key)).toEqual(['plans', 'privacy', 'settings']);
  });

  it('usuário comum: CRM & Automação é "soon", sem Chat, e não vê Plataforma', () => {
    const model = buildNavigation({ isSuperAdmin: false });
    const crm = model.products.find((p) => p.key === 'crm-automation')!;
    expect(crm.status).toBe('soon');
    expect(crm.children).toEqual([]);
    expect(model.platform).toEqual([]);
  });

  it('super admin: CRM & Automação disponível com Chat e seção Plataforma', () => {
    const model = buildNavigation({ isSuperAdmin: true });
    const crm = model.products.find((p) => p.key === 'crm-automation')!;
    expect(crm.status).toBe('available');
    expect(crm.children.map((c) => c.path)).toEqual(['/chat']);
    expect(model.platform.map((l) => l.path)).toEqual(['/admin/ai', '/admin/link-domains']);
  });

  it('nenhum rótulo leva nome de marca', () => {
    const model = buildNavigation({ isSuperAdmin: true });
    const labels = [
      ...model.top.map((l) => l.label),
      ...model.products.flatMap((p) => [p.label, p.tagline, ...p.children.map((c) => c.label)]),
      ...model.platform.map((l) => l.label),
      ...model.bottom.map((e) => e.label),
    ];
    for (const label of labels) expect(label.toLowerCase()).not.toMatch(/copysync|waio/);
  });
});

describe('linkMatches', () => {
  const settings = { key: 's', label: 'x', path: '/settings/sessions', icon: (() => null) as never, matchPrefix: '/settings' };
  it('casa pelo caminho exato ou pelo prefixo configurado', () => {
    expect(linkMatches(settings, '/settings/sessions')).toBe(true);
    expect(linkMatches(settings, '/settings/account/password')).toBe(true);
    expect(linkMatches(settings, '/settings')).toBe(true);
    expect(linkMatches(settings, '/settingsx')).toBe(false);
    expect(linkMatches(settings, '/offers')).toBe(false);
  });
});

describe('findActiveEntry', () => {
  const model = buildNavigation({ isSuperAdmin: true });

  it('rota de filho devolve o link e o produto', () => {
    const entry = findActiveEntry(model, '/storefront');
    expect(entry?.link.key).toBe('storefront');
    expect(entry?.product?.key).toBe('affiliates');
  });

  it('rota de super admin cai no produto CRM & Automação', () => {
    expect(findActiveEntry(model, '/chat')?.product?.key).toBe('crm-automation');
  });

  it('matchPrefix marca configurações sem produto', () => {
    const entry = findActiveEntry(model, '/settings/account');
    expect(entry?.link.key).toBe('settings');
    expect(entry?.product).toBeUndefined();
  });

  it('rota global e rota desconhecida', () => {
    expect(findActiveEntry(model, '/dashboard')?.link.key).toBe('dashboard');
    expect(findActiveEntry(model, '/nada')).toBeUndefined();
  });
});
