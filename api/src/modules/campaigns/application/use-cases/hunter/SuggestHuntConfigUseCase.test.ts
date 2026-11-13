import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../../../shared/errors/AppError';
import type { IOfferHuntAiSuggestionCounter, OfferHuntAiSuggestionClaim } from '../../../domain/contracts/hunter/IOfferHuntAiSuggestionCounter';
import type { HuntCandidate } from '../../../domain/hunter/HuntCandidate';
import type { HuntCapabilities, HuntSourceQuery, IHuntCatalogSource } from '../../../domain/hunter/HuntProvider';
import { huntCandidate } from '../../../domain/services/hunter/huntTestFixtures';
import type { HuntConfigSuggestInput } from '../../hunter/contracts/IHuntConfigSuggester';
import { SuggestHuntConfigUseCase } from './SuggestHuntConfigUseCase';
import type { IHuntProviderAdapter } from '../../../domain/contracts/hunter/IHuntProviderAdapter';
import { SheinHuntProviderAdapter } from '../../../infrastructure/hunter/providers/SheinHuntProviderAdapter';
import { HUNTER_AI_LIMITS } from '../../../domain/services/hunter/hunterAiLimits';

const NOW = new Date('2026-11-15T15:00:00.000Z');
const ML: HuntCapabilities = {
  provider: 'MERCADO_LIVRE', sorts: ['relevance'], defaultSort: 'relevance',
  sourceFilters: ['keyword', 'category', 'extraEarningsOnly', 'bestSellersOnly'], localFilters: ['maxPriceCents', 'minCommissionPct'],
  commissionModel: 'SINGLE_WITH_EXTRA_FLAG', imageHosts: ['mlstatic.com'], productIdPattern: /^MLB\d+$/,
};
const SHEIN: HuntCapabilities = { ...ML, provider: 'SHEIN', sorts: ['RECOMMENDED', 'BEST_SELLING'], sourceFilters: ['keyword', 'category'] };
const SUGGESTION = {
  draft: { name: 'X', categoryId: null, keyword: null, sort: null, sourceOptions: {}, filters: {}, aiEnabled: null, topN: 3 },
  reasons: { topN: 'Três' }, dropped: ['hack'],
};

class Counter implements IOfferHuntAiSuggestionCounter {
  used = 0;
  released: string[] = [];
  async claim(_t: string, _d: Date, max: number): Promise<OfferHuntAiSuggestionClaim> {
    if (this.used >= max) return { kind: 'DAILY_LIMIT', used: this.used };
    this.used++;
    return { kind: 'OK', id: `s${this.used}`, used: this.used };
  }
  async release(_t: string, id: string) { this.released.push(id); this.used--; }
  async countSince() { return this.used; }
}

function catalogWith(pages: (q: HuntSourceQuery) => HuntCandidate[] | Error): IHuntCatalogSource & { queries: HuntSourceQuery[] } {
  const queries: HuntSourceQuery[] = [];
  return {
    provider: 'MERCADO_LIVRE',
    queries,
    listCategories: vi.fn(async () => [{ categoryId: null, name: 'Todas' }, { categoryId: 'A', name: 'Moda' }, { categoryId: 'B', name: 'Casa' }, { categoryId: 'C', name: 'Tech' }]),
    fetchPage: vi.fn(async (_s, q: HuntSourceQuery) => {
      queries.push(q);
      const out = pages(q);
      if (out instanceof Error) throw out;
      return { items: out, hasNextPage: false };
    }),
  };
}

function setup(opts: {
  ent?: Record<string, boolean>; accepted?: boolean; credential?: boolean; caps?: HuntCapabilities | null; aiAvailable?: boolean;
  catalog?: ReturnType<typeof catalogWith>; suggest?: () => Promise<typeof SUGGESTION | null>; clock?: () => number;
} = {}) {
  const ent = { offer_hunter_enabled: true, marketplace_shein_enabled: true, ...opts.ent };
  const catalog = opts.catalog ?? catalogWith(() => [huntCandidate()]);
  const adapterOf = (caps: HuntCapabilities) => ({
    provider: caps.provider, capabilities: caps, catalog, imageHosts: caps.imageHosts,
    sessionFrom: vi.fn(() => ({ provider: 'MERCADO_LIVRE' as const, cookies: { ssid: 'S' } })), productUrl: () => null,
  }) as unknown as IHuntProviderAdapter;
  const registry = {
    get: vi.fn((p: string) => {
      const caps = opts.caps === undefined ? (p === 'SHEIN' ? SHEIN : ML) : opts.caps;
      if (!caps) throw new Error('missing');
      return adapterOf(caps);
    }),
  };
  const credentials = {
    resolveState: vi.fn(async () => (opts.credential === false ? { state: 'missing' } : { state: 'ok', cred: { secret: 'x' } }) as never),
  };
  const suggest = vi.fn(async (_i: HuntConfigSuggestInput) => (opts.suggest ? opts.suggest() : SUGGESTION));
  const counter = new Counter();
  const sleep = vi.fn(async (_ms: number) => undefined);
  const uc = new SuggestHuntConfigUseCase({
    entitlements: { getBoolean: async (_t: string, k: string) => ent[k as keyof typeof ent] ?? null, getNumber: async () => null } as never,
    riskGate: { isAccepted: async () => opts.accepted ?? true },
    ai: { isAvailable: async () => opts.aiAvailable ?? true },
    registry,
    credentials,
    suggester: { suggest },
    counter,
    logger: { warn: vi.fn() },
    sleep,
    rand: () => 0.5,
    clock: opts.clock ?? (() => 0),
  });
  return { uc, suggest, counter, catalog, credentials, sleep };
}
const run = (uc: SuggestHuntConfigUseCase, patch: Partial<Parameters<SuggestHuntConfigUseCase['execute']>[0]> = {}) =>
  uc.execute({ tenantId: 't1', provider: 'MERCADO_LIVRE', intent: 'moda feminina barata', pickProduct: false, now: NOW, ...patch });

describe('SuggestHuntConfigUseCase', () => {
  it('com intenção: lê só categorias, devolve rascunho com marca e restante do dia', async () => {
    const { uc, suggest, catalog } = setup();
    const out = await run(uc);
    expect(out).toEqual({
      draft: { provider: 'MERCADO_LIVRE', ...SUGGESTION.draft }, reasons: SUGGESTION.reasons, dropped: ['hack'],
      sourceUsed: true, remainingToday: 4,
    });
    expect(catalog.queries).toHaveLength(0);
    expect(suggest.mock.calls[0][0]).toMatchObject({ intent: 'moda feminina barata', sample: null, capabilities: ML });
    expect(suggest.mock.calls[0][0].categories).toHaveLength(4);
  });

  it('portões: caçador sempre; plano Shein só para Shein; ML sem chave extra (D7)', async () => {
    await expect(run(setup({ ent: { offer_hunter_enabled: false } }).uc)).rejects.toMatchObject({ code: 'PLAN_FEATURE_UNAVAILABLE' });
    await expect(run(setup({ ent: { marketplace_shein_enabled: false } }).uc, { provider: 'SHEIN' }))
      .rejects.toMatchObject({ code: 'PLAN_FEATURE_UNAVAILABLE', meta: { key: 'marketplace_shein_enabled' } });
    await expect(run(setup({ ent: { marketplace_shein_enabled: false } }).uc)).resolves.toBeTruthy();
    await expect(run(setup().uc, { provider: 'AMAZON' })).rejects.toMatchObject({ code: 'OFFER_HUNT_AI_SUGGEST_PROVIDER_UNAVAILABLE' });
    await expect(run(setup({ caps: null }).uc)).rejects.toMatchObject({ code: 'OFFER_HUNT_AI_SUGGEST_PROVIDER_UNAVAILABLE' });
  });

  it('sem aceite ou sem credencial: não lê a fonte, categoria fica de fora, sourceUsed false', async () => {
    for (const opts of [{ accepted: false }, { credential: false }]) {
      const { uc, suggest, catalog, credentials } = setup(opts);
      const out = await run(uc, { pickProduct: true });
      expect(out.sourceUsed).toBe(false);
      expect(catalog.listCategories).not.toHaveBeenCalled();
      expect(suggest.mock.calls[0][0]).toMatchObject({ categories: [], sample: null });
      if (opts.accepted === false) expect(credentials.resolveState).not.toHaveBeenCalled();
    }
  });

  it('sem intenção e sem "IA escolhe" → 422; IA não configurada → 409 sem gastar sugestão', async () => {
    const a = setup();
    await expect(run(a.uc, { intent: '  ' })).rejects.toMatchObject({ code: 'OFFER_HUNT_AI_SUGGEST_INPUT_REQUIRED' });
    const b = setup({ aiAvailable: false });
    await expect(run(b.uc)).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED', statusCode: 409 });
    expect(b.counter.used).toBe(0);
  });

  it('teto 5/dia → 429; erro do gerador e saída inválida devolvem a reserva (só sugestão entregue conta)', async () => {
    const { uc, counter } = setup();
    for (let i = 0; i < 5; i++) await run(uc);
    await expect(run(uc)).rejects.toMatchObject({ code: 'OFFER_HUNT_AI_SUGGEST_DAILY_LIMIT', statusCode: 429 });

    const failing = setup({ suggest: async () => { throw new AppError('AI_PROVIDER_UNAVAILABLE', 'x', 503); } });
    await expect(run(failing.uc)).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' });
    expect(failing.counter.released).toEqual(['s1']);
    expect(failing.counter.used).toBe(0);

    const invalid = setup({ suggest: async () => null });
    await expect(run(invalid.uc)).rejects.toMatchObject({ code: 'OFFER_HUNT_AI_SUGGEST_INVALID_OUTPUT' });
    expect(invalid.counter.released).toEqual(['s1']);
    expect(invalid.counter.used).toBe(0);
    expect(counter.used).toBe(5);
  });

  it('amostra: passado o orçamento de tempo não abre consulta nova e a sugestão segue com o que leu', async () => {
    let t = 0;
    const catalog = catalogWith(() => [huntCandidate({ productId: String(++t) })]);
    // cada leitura do relógio avança 12 s: a 3ª consulta já encontra o orçamento (20 s) estourado
    let now = 0;
    const { uc, suggest } = setup({ catalog, clock: () => (now += 12_000) });
    const out = await run(uc, { intent: null, pickProduct: true });
    expect(catalog.queries).toHaveLength(2);
    expect(suggest.mock.calls[0][0].sample!.pool).toHaveLength(2);
    expect(out.sourceUsed).toBe(true);
  });

  it('IA escolhe o produto (ML): 5 consultas (mais vendidos, extras, geral, 2 categorias de maior comissão), 40 melhores', async () => {
    let n = 0;
    const catalog = catalogWith((q) => Array.from({ length: 30 }, () => {
      n++;
      const cat = q.category?.categoryId ?? (n % 3 === 0 ? 'A' : n % 3 === 1 ? 'B' : 'C');
      const pct = cat === 'A' ? 20 : cat === 'B' ? 12 : 5;
      return huntCandidate({ productId: String(100000 + n), categoryId: cat, commissionNewPct: pct, sales: n });
    }));
    const { uc, suggest, sleep } = setup({ catalog });
    const out = await run(uc, { intent: null, pickProduct: true });
    expect(out.sourceUsed).toBe(true);
    // Pausa curta da amostra entre consultas (não antes da 1ª): requisição interativa
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([650, 650]);
    for (const [ms] of sleep.mock.calls) {
      expect(ms).toBeGreaterThanOrEqual(HUNTER_AI_LIMITS.samplePauseMs.min);
      expect(ms).toBeLessThanOrEqual(HUNTER_AI_LIMITS.samplePauseMs.max);
    }
    expect(catalog.queries.map((q) => [q.category?.categoryId ?? null, q.options])).toEqual([
      [null, { bestSellersOnly: true }], [null, { extraEarningsOnly: true }], [null, {}],
    ]); // pool chegou a 90 nas 3 primeiras: categorias não são lidas
    const sample = suggest.mock.calls[0][0].sample!;
    expect(sample.pool).toHaveLength(90);
    expect(sample.items).toHaveLength(40);
  });

  it('amostra pequena lê as 2 categorias de maior comissão média; 1º erro da fonte encerra', async () => {
    const catalog = catalogWith((q) => {
      if (q.category?.categoryId === 'B') return new AppError('AFFILIATE_API_UNAVAILABLE', 'x', 503);
      if (q.category?.categoryId) return [huntCandidate({ productId: `9${String(q.category.categoryId).charCodeAt(0)}`, categoryId: q.category.categoryId })];
      const o = q.options;
      const tag = o.bestSellersOnly ? 1 : o.extraEarningsOnly ? 2 : 3;
      return [
        huntCandidate({ productId: `${tag}01`, categoryId: 'A', commissionNewPct: 20 }),
        huntCandidate({ productId: `${tag}02`, categoryId: 'B', commissionNewPct: 15 }),
        huntCandidate({ productId: `${tag}03`, categoryId: 'C', commissionNewPct: 5 }),
        huntCandidate({ productId: `${tag}04`, categoryId: 'ZZ', commissionNewPct: 50 }), // fora da lista real
      ];
    });
    const { uc, suggest } = setup({ catalog });
    await run(uc, { pickProduct: true });
    expect(catalog.queries.map((q) => q.category?.categoryId ?? null)).toEqual([null, null, null, 'A', 'B']);
    expect(suggest.mock.calls[0][0].sample!.pool).toHaveLength(13);
  });

  it('Shein sem filtros de fonte próprios usa a ordenação BEST_SELLING e não pede extras', async () => {
    const catalog = catalogWith(() => new AppError('AFFILIATE_API_UNAVAILABLE', 'x', 503));
    const { uc, suggest } = setup({ catalog });
    const out = await run(uc, { provider: 'SHEIN', pickProduct: true });
    expect(catalog.queries).toEqual([
      { page: 1, category: { categoryId: null, name: 'Todas' }, keyword: null, options: { sort: 'BEST_SELLING' } },
    ]);
    expect(suggest.mock.calls[0][0].sample).toBeNull();
    expect(out.sourceUsed).toBe(true); // categorias lidas
  });

  it('Shein: amostra resolve o `did` de "Todas" uma vez (1 listCategories na leitura toda)', async () => {
    const client = {
      listCategories: vi.fn(async () => [
        { categoryId: null, name: 'All', did: 0 }, { categoryId: '4436', name: 'Vestidos', did: 12 },
      ]),
      list: vi.fn(async () => ({ items: [huntCandidate({ productId: '123456', categoryId: '4436' })], hasNextPage: false })),
      search: vi.fn(),
    };
    const adapter = new SheinHuntProviderAdapter(client as never);
    const base = setup();
    const uc = new SuggestHuntConfigUseCase({
      ...(base.uc as unknown as { deps: ConstructorParameters<typeof SuggestHuntConfigUseCase>[0] }).deps,
      registry: { get: () => adapter } as never,
      credentials: { resolveState: async () => ({ state: 'ok', cred: { publicIdentifier: 'm1', session: { cookies: { AT: 'tok' } } } }) as never },
    });
    await run(uc, { provider: 'SHEIN', pickProduct: true });
    expect(client.list).toHaveBeenCalledTimes(3); // mais vendidos, geral, categoria 4436
    expect(client.listCategories).toHaveBeenCalledTimes(1);
  });
});
