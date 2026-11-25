import { catalogFixture } from '@/features/featureUsage/testFixtures';
import { LEGACY_PRODUCTS as LEGACY } from '@/features/products/productAccess';
import { describe, expect, it } from 'vitest';
import { buildNavigation, findActiveEntry, linkMatches } from './model';

describe('buildNavigation', () => {
  it('ordena os produtos com Afiliados primeiro; Saver só com saverVisible', () => {
    const model = buildNavigation({ isSuperAdmin: false, offerHunterVisible: false, watermarkVisible: false, saverVisible: false, products: LEGACY });
    expect(model.products.map((p) => p.key)).toEqual([
      'affiliates', 'crm-automation', 'group-manager', 'chip-warmer', 'group-filler',
    ]);
    const visible = buildNavigation({ isSuperAdmin: false, offerHunterVisible: false, watermarkVisible: false, saverVisible: true, products: LEGACY });
    expect(visible.products.map((p) => p.key)).toEqual([
      'affiliates', 'crm-automation', 'group-manager', 'saver', 'chip-warmer', 'group-filler',
    ]);
    expect(model.products[0].status).toBe('available');
    expect(model.products[0].children.map((c) => c.path)).toEqual([
      '/offers', '/monitoring', '/broadcast-groups', '/link-rotation', '/storefront', '/offer-story',
      '/affiliates/credentials', '/affiliates/tutorials', '/affiliates/plans',
    ]);
  });

  it('Dashboard no topo; bloco inferior com planos, privacidade e configurações', () => {
    const model = buildNavigation({ isSuperAdmin: false, offerHunterVisible: false, watermarkVisible: false, saverVisible: false, products: LEGACY });
    expect(model.top.map((l) => l.path)).toEqual(['/dashboard']);
    expect(model.bottom.map((e) => e.key)).toEqual(['privacy', 'settings']);
  });

  it('usuário comum: CRM & Automação é "soon", sem Chat, e não vê Plataforma', () => {
    const model = buildNavigation({ isSuperAdmin: false, offerHunterVisible: false, watermarkVisible: false, saverVisible: false, products: LEGACY });
    const crm = model.products.find((p) => p.key === 'crm-automation')!;
    expect(crm.status).toBe('soon');
    expect(crm.children).toEqual([]);
    expect(model.platform).toEqual([]);
  });

  it('Chat só de super admin enquanto o uso do chat contar só conta interna (contrato `internalOnlyFeatures`)', () => {
    const model = buildNavigation({ isSuperAdmin: true, offerHunterVisible: false, watermarkVisible: false, saverVisible: false, products: LEGACY });
    const chat = model.products.flatMap((p) => p.children).find((c) => c.key === 'chat')!;
    // Chat aberto aos planos: tirar `chat_send` de INTERNAL_ONLY_FEATURES (api) e de `internalOnlyFeatures` no contrato
    expect(chat.superAdminOnly === true).toBe(catalogFixture.internalOnlyFeatures.includes('chat_send'));
  });

  it('super admin: CRM & Automação disponível com Chat e seção Plataforma', () => {
    const model = buildNavigation({ isSuperAdmin: true, offerHunterVisible: false, watermarkVisible: false, saverVisible: false, products: LEGACY });
    const crm = model.products.find((p) => p.key === 'crm-automation')!;
    expect(crm.status).toBe('available');
    expect(crm.children.map((c) => c.path)).toEqual(['/chat']);
    expect(model.platform.map((l) => l.path)).toEqual(['/admin/ai', '/admin/link-domains', '/admin/workers', '/admin/costs', '/admin/usage', '/admin/redirect-links', '/admin/saver', '/admin/plan-entitlements']);
  });

  it('uso dos recursos: só super admin, logo depois de custos, sem produto novo', () => {
    const common = buildNavigation({ isSuperAdmin: false, offerHunterVisible: true, watermarkVisible: false, saverVisible: true, products: LEGACY });
    const allKeys = [...common.top, ...common.platform, ...common.products.flatMap((p) => p.children)].map((l) => l.key);
    expect(allKeys).not.toContain('admin-usage');
    const admin = buildNavigation({ isSuperAdmin: true, offerHunterVisible: false, watermarkVisible: false, saverVisible: false, products: LEGACY });
    const keys = admin.platform.map((l) => l.key);
    expect(keys.indexOf('admin-usage')).toBe(keys.indexOf('admin-costs') + 1);
    expect(admin.platform.find((l) => l.key === 'admin-usage')?.label).toBe('Uso dos recursos');
  });

  it('marca d\'água: item em Afiliados só com watermarkVisible, com selo MAX', () => {
    const affiliateKeys = (watermarkVisible: boolean) =>
      buildNavigation({ isSuperAdmin: false, offerHunterVisible: false, watermarkVisible, saverVisible: false, products: LEGACY })
        .products.find((p) => p.key === 'affiliates')!.children;
    expect(affiliateKeys(false).map((l) => l.key)).not.toContain('offer-watermark');
    const item = affiliateKeys(true).find((l) => l.key === 'offer-watermark');
    expect(item).toMatchObject({ label: 'Marca d\'água', path: '/offer-watermark', badge: 'MAX' });
  });

  it('nenhum rótulo leva nome de marca', () => {
    const model = buildNavigation({ isSuperAdmin: true, offerHunterVisible: false, watermarkVisible: false, saverVisible: false, products: LEGACY });
    const labels = [
      ...model.top.map((l) => l.label),
      ...model.products.flatMap((p) => [p.label, p.tagline, ...p.children.map((c) => c.label)]),
      ...model.platform.map((l) => l.label),
      ...model.bottom.map((e) => e.label),
    ];
    for (const label of labels) expect(label.toLowerCase()).not.toMatch(/copysync|waio/);
  });

  it('Caçador de Ofertas: some com offerHunterVisible false, mesmo para super admin', () => {
    for (const isSuperAdmin of [false, true]) {
      const model = buildNavigation({ isSuperAdmin, offerHunterVisible: false, watermarkVisible: false, saverVisible: false, products: LEGACY });
      expect(model.products[0].children.some((c) => c.key === 'offer-hunter')).toBe(false);
      expect(findActiveEntry(model, '/offer-hunter')).toBeUndefined();
    }
  });

  it('Caçador de Ofertas: aparece em Afiliados com offerHunterVisible true, mesmo sem super admin', () => {
    const model = buildNavigation({ isSuperAdmin: false, offerHunterVisible: true, watermarkVisible: false, saverVisible: false, products: LEGACY });
    const children = model.products[0].children;
    expect(children.map((c) => c.path)).toEqual([
      '/offers', '/monitoring', '/broadcast-groups', '/link-rotation', '/storefront', '/offer-story', '/offer-hunter',
      '/affiliates/credentials', '/affiliates/tutorials', '/affiliates/plans',
    ]);
    const hunter = children.find((c) => c.key === 'offer-hunter')!;
    expect(hunter).toMatchObject({ label: 'Caçador de Ofertas', badge: 'MAX' });
    expect(hunter.superAdminOnly).toBeUndefined();
    expect(findActiveEntry(model, '/offer-hunter/h1')?.link.key).toBe('offer-hunter');
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
  const model = buildNavigation({ isSuperAdmin: true, offerHunterVisible: false, watermarkVisible: false, saverVisible: false, products: LEGACY });

  it('rota de filho devolve o link e o produto', () => {
    const entry = findActiveEntry(model, '/storefront');
    expect(entry?.link.key).toBe('storefront');
    expect(entry?.product?.key).toBe('affiliates');
  });

  it('grupos de disparo ficam em Afiliados', () => {
    const entry = findActiveEntry(model, '/broadcast-groups');
    expect(entry?.link.label).toBe('Grupos de disparo');
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

  it('Workers: abas Ocupação e Consumo ativam o mesmo item', () => {
    expect(findActiveEntry(model, '/admin/workers')?.link.key).toBe('admin-workers');
    expect(findActiveEntry(model, '/admin/workers/usage')?.link.key).toBe('admin-workers');
  });

  it('Custos: abas por sub-rota ativam o mesmo item', () => {
    expect(findActiveEntry(model, '/admin/costs')?.link.key).toBe('admin-costs');
    expect(findActiveEntry(model, '/admin/costs/prices')?.link.key).toBe('admin-costs');
    expect(findActiveEntry(model, '/admin/usage/plans')?.link.key).toBe('admin-usage');
    expect(findActiveEntry(model, '/admin/usage/features/offer_generator')?.link.key).toBe('admin-usage');
  });

  it('rota global e rota desconhecida', () => {
    expect(findActiveEntry(model, '/dashboard')?.link.key).toBe('dashboard');
    expect(findActiveEntry(model, '/nada')).toBeUndefined();
  });
});

describe('buildNavigation — produtos do tenant', () => {
  const affiliatesOf = (products: Parameters<typeof buildNavigation>[0]['products']) =>
    buildNavigation({ isSuperAdmin: false, offerHunterVisible: true, watermarkVisible: false, saverVisible: false, products }).products[0];

  it('legado: Afiliados sem cadeado e com todos os itens', () => {
    const affiliates = affiliatesOf(LEGACY);
    expect(affiliates.locked).toBeUndefined();
    expect(affiliates.children).toHaveLength(10);
  });

  it('só-Saver: Afiliados travado, só com a vitrine de planos', () => {
    const affiliates = affiliatesOf(['SAVER']);
    expect(affiliates).toMatchObject({ key: 'affiliates', status: 'available', locked: true });
    expect(affiliates.children.map((c) => c.path)).toEqual(['/affiliates/plans']);
  });

  it('ambos: Afiliados e Saver liberados', () => {
    const model = buildNavigation({ isSuperAdmin: false, offerHunterVisible: false, watermarkVisible: false, saverVisible: true, products: ['AFFILIATES', 'CHAT', 'SAVER'] });
    expect(model.products[0].locked).toBeUndefined();
    expect(model.products[0].children.map((c) => c.key)).toContain('offers');
    const saver = model.products.find((p) => p.key === 'saver')!;
    expect(saver).toMatchObject({ status: 'available', tagline: 'Exporte os contatos dos seus grupos' });
    expect(saver.locked).toBeUndefined();
    expect(saver.children.map((c) => c.path)).toEqual(['/saver', '/saver/settings', '/saver/plans']);
    expect(findActiveEntry(model, '/saver/settings')?.link.key).toBe('saver-settings');
    expect(findActiveEntry(model, '/saver')?.link.key).toBe('saver-groups');
  });

  it('produto travado não casa rotas internas: só a vitrine fica ativa', () => {
    const model = buildNavigation({ isSuperAdmin: false, offerHunterVisible: false, watermarkVisible: false, saverVisible: false, products: [] });
    expect(findActiveEntry(model, '/offers')).toBeUndefined();
    expect(findActiveEntry(model, '/affiliates/plans')?.product?.key).toBe('affiliates');
  });
});

describe('buildNavigation — Saver (audiência SAVER-47)', () => {
  const saverOf = (input: Partial<Parameters<typeof buildNavigation>[0]>) =>
    buildNavigation({ isSuperAdmin: false, offerHunterVisible: false, watermarkVisible: false, saverVisible: false, products: LEGACY, ...input })
      .products.find((p) => p.key === 'saver');

  it('audiência "Só super admin": usuário comum não vê (API devolve false), super admin vê', () => {
    expect(saverOf({ saverVisible: false })).toBeUndefined();
    expect(saverOf({ isSuperAdmin: true, saverVisible: true, products: ['SAVER'] })?.status).toBe('available');
  });

  it('audiência aberta sem o produto: cadeado e só a vitrine', () => {
    const saver = saverOf({ saverVisible: true, products: LEGACY })!;
    expect(saver.locked).toBe(true);
    expect(saver.children.map((c) => c.path)).toEqual(['/saver/plans']);
  });

  it('item legado fora do Saver não muda com saverVisible', () => {
    const strip = (visible: boolean) => {
      const m = buildNavigation({ isSuperAdmin: false, offerHunterVisible: false, watermarkVisible: false, saverVisible: visible, products: LEGACY });
      return { ...m, products: m.products.filter((p) => p.key !== 'saver') };
    };
    expect(strip(true)).toEqual(strip(false));
  });

  it('Base de contatos só para super admin', () => {
    const normal = buildNavigation({ isSuperAdmin: false, offerHunterVisible: false, watermarkVisible: false, saverVisible: true, products: ['SAVER'] });
    expect(normal.platform.some((l) => l.path === '/admin/saver')).toBe(false);
    const admin = buildNavigation({ isSuperAdmin: true, offerHunterVisible: false, watermarkVisible: false, saverVisible: false, products: LEGACY });
    expect(findActiveEntry(admin, '/admin/saver')?.link.key).toBe('admin-saver');
  });
});
