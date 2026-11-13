import { describe, expect, it } from 'vitest';
import { HuntProviderRegistry } from './HuntProviderRegistry';
import { SheinHuntProviderAdapter } from './providers/SheinHuntProviderAdapter';
import { createMercadoLivreHuntAdapter } from './providers/mercadoLivreHuntAdapter';
import { FakeCatalog, FakeHuntCatalogSource, MEMBER } from '../../application/use-cases/hunter/hunterTestFakes';
import { HUNT_CAPABILITIES } from '../../domain/services/hunter/huntCapabilities';

describe('HuntProviderRegistry', () => {
  const shein = new SheinHuntProviderAdapter(new FakeCatalog());
  const ml = createMercadoLivreHuntAdapter(new FakeHuntCatalogSource('MERCADO_LIVRE'));

  it('uma entrada por marca; falta de marca = erro de composição', () => {
    const r = new HuntProviderRegistry([shein, ml]);
    expect(r.get('SHEIN')).toBe(shein);
    expect(r.get('MERCADO_LIVRE')).toBe(ml);
    expect(() => new HuntProviderRegistry([shein])).toThrow(/MERCADO_LIVRE/);
  });

  it('capacidades do adaptador = as do domínio (validação e presenter leem de lá)', () => {
    expect(shein.capabilities).toBe(HUNT_CAPABILITIES.SHEIN);
    expect(ml.capabilities).toBe(HUNT_CAPABILITIES.MERCADO_LIVRE);
    expect(shein.imageHosts).toEqual(['ltwebstatic.com']);
  });
});

describe('SheinHuntProviderAdapter', () => {
  const fake = new FakeCatalog();
  const a = new SheinHuntProviderAdapter(fake);

  it('sessão = AT + memberId; sem AT = null', () => {
    const cred = { provider: 'SHEIN' as const, publicIdentifier: MEMBER, secret: null };
    expect(a.sessionFrom({ ...cred, session: { cookies: { AT: 'tok' } } })).toEqual({ provider: 'SHEIN', token: 'tok', memberId: MEMBER });
    expect(a.sessionFrom({ ...cred, session: { cookies: {} } })).toBeNull();
    expect(a.sessionFrom({ ...cred, session: null })).toBeNull();
  });

  it('URL do produto só com goodsId válido', () => {
    expect(a.productUrl('533885353')).toBe('https://br.shein.com/product-p-533885353.html');
    expect(a.productUrl('MLB123456')).toBeNull();
    expect(a.productUrl('12')).toBeNull();
  });

  it('fetchPage: did da categoria listada (sem 2ª chamada); categoria sem did relista; sort fora da Shein = RECOMMENDED', async () => {
    const session = { provider: 'SHEIN' as const, token: 't', memberId: 'm' };
    const [all, women] = await a.catalog.listCategories(session);
    fake.calls.length = 0;
    await a.catalog.fetchPage(session, { page: 1, category: all!, keyword: null, options: { sort: 'TOP_RATED' } });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({ method: 'list', query: { did: 100, category: null, sort: 'TOP_RATED' } });
    await a.catalog.fetchPage(session, { page: 2, category: { categoryId: women!.categoryId, name: 'x' }, keyword: 'vestido', options: { sort: 'relevance' } });
    expect(fake.calls.map((c) => c.method)).toEqual(['list', 'listCategories', 'search']);
    expect(fake.calls[2]!.query).toMatchObject({ did: 101, category: { categoryId: '4436' }, sort: 'RECOMMENDED', keyword: 'vestido' });
    await expect(a.catalog.fetchPage({ provider: 'MERCADO_LIVRE', cookies: {} }, { page: 1, category: null, keyword: null, options: {} }))
      .rejects.toMatchObject({ code: 'AFFILIATE_API_UNAVAILABLE' });
  });
});
