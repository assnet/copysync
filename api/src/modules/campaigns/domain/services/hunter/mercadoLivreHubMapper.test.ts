import { describe, expect, it } from 'vitest';
import fixture from '../../../infrastructure/http/__fixtures__/mlHubSearch.json';
import {
  mapMercadoLivreHubCard,
  parseMercadoLivreCommissionChip,
  parseMercadoLivreHubCategories,
  parseMercadoLivreHubPage,
  parseMercadoLivreSales,
  type MercadoLivreHubContext,
} from './mercadoLivreHubMapper';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
type Card = { metadata: Record<string, unknown>; pictures: { pictures: { id: string }[] }; components: Record<string, unknown>[] };
const cards = () => clone(fixture.polycard_client_model.polycards) as unknown as Card[];
const CTX: MercadoLivreHubContext = { pictureTemplate: null, pictureSquare: 'Q', pictureSize: 'AB', categoryId: null };

describe('parseMercadoLivreHubPage (fixture real reduzida)', () => {
  const page = parseMercadoLivreHubPage(fixture, null)!;

  it('mapeia os 4 cartões e lê next_offset', () => {
    expect(page.items.map((c) => c.productId)).toEqual(['MLB7806564298', 'MLB2808852761', 'MLB7643858550', 'MLB7038595266']);
    expect(page.hasNextPage).toBe(true);
    expect(page.dropped).toBe(0);
  });

  it('cartão com chip simples "GANHOS 12%"', () => {
    expect(page.items[0]).toEqual({
      provider: 'MERCADO_LIVRE',
      productId: 'MLB7806564298',
      skc: null,
      activityId: null,
      title: 'Leve 3 Pague 2 Creatina Growth Supplements 250gr Sem Sabor',
      imageUrl: 'https://http2.mlstatic.com/D_Q_NP_2X_810731-MLA107960983825_032026-AB.webp',
      priceCents: 14698,
      retailPriceCents: 16698,
      discountPct: 12,
      commissionNewPct: 12,
      commissionNewCents: 1764,
      commissionReturningPct: 0,
      commissionReturningCents: 0,
      hasSecondaryCommission: false,
      extraFlag: false,
      extraCommissionCents: 0,
      commissionEstimated: false,
      sales: 100,
      reviews: 0,
      rating: 4.9,
      rank: null,
      categoryId: null,
      campaignEndsAt: null,
    });
  });

  it('chip composite "GANHOS EXTRAS" + 17% (patrocinado, extra_commission "false") → extraFlag', () => {
    const c = page.items[1]!;
    expect(c).toMatchObject({ commissionNewPct: 17, extraFlag: true, sales: 50_000, commissionEstimated: false });
    expect(c.commissionNewCents).toBe(Math.round(3288 * 0.17));
  });

  it('extra_commission "true" → extraFlag; % do chip já inclui o extra', () => {
    expect(page.items[2]).toMatchObject({ commissionNewPct: 10, extraFlag: true, extraCommissionCents: 0, sales: 5_000, rating: 4.8 });
  });

  it('sem preço anterior → retail null e desconto 0', () => {
    expect(page.items[3]).toMatchObject({ priceCents: 134900, retailPriceCents: null, discountPct: 0, commissionNewPct: 5 });
  });
});

describe('mapMercadoLivreHubCard', () => {
  it('id ausente ou fora de MLB\\d+ → null', () => {
    for (const id of [undefined, '', 'MLBU5519564930', 'MLB12', '123456', 'MLB123456789012345678']) {
      const c = cards()[0]!;
      c.metadata.id = id;
      expect(mapMercadoLivreHubCard(c, CTX)).toBeNull();
    }
    expect(mapMercadoLivreHubCard(null, CTX)).toBeNull();
  });

  it('template de foto fora de *.mlstatic.com ou sem https → imageUrl null', () => {
    const c = cards()[0]!;
    for (const pictureTemplate of ['https://evil.example/{id}.webp', 'http://http2.mlstatic.com/D_{id}.webp', 'https://mlstatic.com.evil.io/{id}']) {
      expect(mapMercadoLivreHubCard(c, { ...CTX, pictureTemplate })!.imageUrl).toBeNull();
    }
  });

  it('id de foto inválido → imageUrl null', () => {
    const c = cards()[0]!;
    c.pictures.pictures[0]!.id = '../x?y';
    expect(mapMercadoLivreHubCard(c, CTX)!.imageUrl).toBeNull();
  });

  it('sem chip: estima pela categoria da busca → commissionEstimated', () => {
    const c = cards()[3]!;
    c.components = c.components.filter((x) => x.id !== 'affiliates_commission_chip');
    expect(mapMercadoLivreHubCard(c, { ...CTX, categoryId: 'MLB1051' })).toMatchObject({
      commissionNewPct: 5,
      commissionNewCents: 6745,
      commissionEstimated: true,
      categoryId: 'MLB1051',
    });
  });

  it('sem chip e categoria fora da tabela (ou busca sem categoria) → descartado, nunca 0% como dado real', () => {
    const c = cards()[3]!;
    c.components = c.components.filter((x) => x.id !== 'affiliates_commission_chip');
    expect(mapMercadoLivreHubCard(c, { ...CTX, categoryId: 'MLB5726' })).toBeNull();
    expect(mapMercadoLivreHubCard(c, CTX)).toBeNull();
  });

  it('página conta à parte os cartões sem comissão avaliável', () => {
    const json = clone(fixture);
    const all = json.polycard_client_model.polycards as unknown as Card[];
    all[3]!.components = all[3]!.components.filter((x) => x.id !== 'affiliates_commission_chip');
    const page = parseMercadoLivreHubPage(json, null)!;
    expect(page.items).toHaveLength(3);
    expect(page).toMatchObject({ dropped: 0, noCommission: 1 });
  });
});

describe('parseMercadoLivreCommissionChip', () => {
  it('pill simples e composite', () => {
    expect(parseMercadoLivreCommissionChip({ chip: { pill: { text: 'GANHOS 12%' } } })).toEqual({ pct: 12, extra: false });
    expect(parseMercadoLivreCommissionChip({ chip: { pill: { text: 'GANHOS EXTRAS 20%' } } })).toEqual({ pct: 20, extra: true });
    expect(
      parseMercadoLivreCommissionChip({
        chip: { pill: { text: '{a} {b}', values: [{ key: 'a', label: { text: 'GANHOS' } }, { key: 'b', label: { text: 'EXTRAS' } }] }, label: { text: '7,5%' } },
      }),
    ).toEqual({ pct: 7.5, extra: true });
  });

  it('sem percentual ou > 100 → null', () => {
    expect(parseMercadoLivreCommissionChip({ chip: { pill: { text: 'GANHOS' } } })).toBeNull();
    expect(parseMercadoLivreCommissionChip({ chip: { pill: { text: 'GANHOS 150%' } } })).toBeNull();
    expect(parseMercadoLivreCommissionChip(undefined)).toBeNull();
  });
});

describe('parseMercadoLivreSales', () => {
  it.each([
    ['Classificação 4.9 de 5 estrelas. Mais de 100 produtos vendidos.', null, 100],
    ['Mais de 1000 produtos vendidos.', null, 1000],
    ['Mais de 500mil produtos vendidos.', null, 500_000],
    [null, '| +10mil vendidos', 10_000],
    ['sem vendas', 'nada', 0],
  ])('%s / %s → %i', (alt, label, n) => {
    expect(parseMercadoLivreSales(alt, label)).toBe(n);
  });
});

describe('parseMercadoLivreHubCategories', () => {
  it('"Todas" primeiro + 25 categorias do filtro', () => {
    const cats = parseMercadoLivreHubCategories(fixture)!;
    expect(cats[0]).toEqual({ categoryId: null, name: 'Todas' });
    expect(cats).toHaveLength(26);
    expect(cats[1]).toEqual({ categoryId: 'MLB5726', name: 'Eletrodomésticos' });
  });

  it('sem filtro category → só "Todas"; valores inválidos descartados', () => {
    expect(parseMercadoLivreHubCategories({ filters: [] })).toEqual([{ categoryId: null, name: 'Todas' }]);
    expect(
      parseMercadoLivreHubCategories({
        filters: [{ id: 'category', values: [{ id: 'X1', name: 'a' }, { id: 'MLB1', name: '' }, { id: 'MLB2', name: 'Ok' }, { id: 'MLB2', name: 'Dup' }]}],
      }),
    ).toEqual([{ categoryId: null, name: 'Todas' }, { categoryId: 'MLB2', name: 'Ok' }]);
  });

  it('filters fora do formato → null', () => {
    expect(parseMercadoLivreHubCategories({})).toBeNull();
    expect(parseMercadoLivreHubPage({ polycard_client_model: {} }, null)).toBeNull();
  });
});
