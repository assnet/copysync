import { describe, expect, it, beforeEach } from 'vitest';
import {
  GetOfferHunterDestinationUseCase, GetOfferHunterOptionsUseCase, GetOfferHunterProvidersUseCase, GetOfferHunterUsageUseCase,
} from './OfferHunterInfoUseCases';
import { ListOfferHuntFindsUseCase, ListOfferHuntRunsUseCase, OFFER_HUNT_PAGE_SIZE } from './OfferHuntHistoryUseCases';
import { SetOfferHunterDestinationUseCase } from './SetOfferHunterDestinationUseCase';
import { OfferHunterAudienceGate } from '../../services/hunter/offerHunterAudience';
import { AffiliateApiUnavailableError, AffiliateCredentialRejectedError } from '../../../../../shared/errors/internal/OfferErrors';
import type { OfferHuntRunSummary } from '../../../domain/hunter/OfferHunt';
import type { OfferHuntPageCursor } from '../../../domain/contracts/hunter/IOfferHuntRunRepository';
import { ENTITLEMENT_KEYS } from '../../../../tenants/domain/entitlementKeys';
import {
  AT_TOKEN, FakeCatalog, FakeCredentials, FakeRiskGate, HUNT, InMemorySettings, MAX_ENTITLEMENTS, MEMBER, NOW, TENANT, makeHunt, testProviders, FakeHuntCatalogSource,
} from './hunterTestFakes';

const reader = (map: Record<string, unknown>) => ({
  getBoolean: async (_t: string, k: string) => (typeof map[k] === 'boolean' ? (map[k] as boolean) : null),
  getNumber: async (_t: string, k: string) => (typeof map[k] === 'number' ? (map[k] as number) : null),
});

describe('GetOfferHunterUsageUseCase', () => {
  it('teto ausente = 0 (nunca ilimitado); conta do dia', async () => {
    const uc = new GetOfferHunterUsageUseCase({
      finds: { countCreatedSince: async () => 2, countResendsInDay: async () => 4 }, runs: { countStartedSince: async () => 5 }, entitlements: reader({}), now: () => NOW,
    });
    expect(await uc.execute(TENANT)).toEqual({ used: 2, limit: 0, remaining: 0, runsToday: 5, runsMax: 24, resendsToday: 4, resendsMax: 10 });
  });

  it('MAX 10: saldo = limite − usados, início do dia no fuso', async () => {
    let since: Date | null = null;
    const uc = new GetOfferHunterUsageUseCase({
      finds: { countCreatedSince: async (_t, s) => { since = s; return 3; }, countResendsInDay: async () => 0 }, runs: { countStartedSince: async () => 1 },
      entitlements: reader(MAX_ENTITLEMENTS), now: () => NOW,
    });
    expect(await uc.execute(TENANT)).toMatchObject({ used: 3, limit: 10, remaining: 7 });
    expect(since!.toISOString()).toBe('2026-11-12T03:00:00.000Z');
  });
});

describe('GetOfferHunterOptionsUseCase', () => {
  let catalog: FakeCatalog;
  let credentials: FakeCredentials;
  let risk: FakeRiskGate;
  let settings: InMemorySettings;
  let ent: Record<string, unknown>;
  const make = (ai = true) => new GetOfferHunterOptionsUseCase({
    entitlements: reader(ent), credentials, riskGate: risk, ai: { isAvailable: async () => ai }, settings, providers: testProviders(catalog),
  });

  beforeEach(() => {
    catalog = new FakeCatalog();
    credentials = new FakeCredentials();
    risk = new FakeRiskGate();
    settings = new InMemorySettings();
    ent = { ...MAX_ENTITLEMENTS };
  });

  it('tudo em dia: categorias sem "All" nem did; nenhum token/memberId na saída', async () => {
    await settings.upsert(TENANT, 's1', 'c1');
    const out = await make().execute(TENANT);
    expect(out.sourceStatus).toBe('OK');
    expect(out.categories).toEqual([{ categoryId: '4436', name: 'Women Apparel' }]);
    expect(out.gates).toEqual({ plan: true, hunterEntitlement: true, credential: true, riskAccepted: true, aiAvailable: true, destination: true });
    expect(out.presets.map((p) => p.key)).toContain('TOP_COMMISSION');
    expect(risk.calls[0]).toEqual([TENANT, 'SHEIN', 'OFFER_HUNTER']);
    const json = JSON.stringify(out);
    expect(json).not.toContain(AT_TOKEN);
    expect(json).not.toContain(MEMBER);
    expect(json).not.toContain('"did"');
  });

  it('sem credencial: lista vazia NO_CREDENTIAL, sem chamar a fonte', async () => {
    credentials.state = { state: 'missing' };
    const out = await make().execute(TENANT);
    expect(out).toMatchObject({ categories: [], sourceStatus: 'NO_CREDENTIAL', gates: { credential: false, destination: false } });
    expect(catalog.calls).toHaveLength(0);
  });

  it('aviso não aceito ou sem plano: LOCKED, sem chamar a fonte', async () => {
    risk.accepted = false;
    expect((await make().execute(TENANT)).sourceStatus).toBe('LOCKED');
    risk.accepted = true;
    ent = { ...MAX_ENTITLEMENTS, [ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED]: false };
    expect((await make().execute(TENANT)).gates.hunterEntitlement).toBe(false);
    expect(catalog.calls).toHaveLength(0);
  });

  it('fonte indisponível/recusada: lista vazia, não falha; IA ausente', async () => {
    catalog.error = new AffiliateApiUnavailableError('SHEIN');
    expect(await make(false).execute(TENANT)).toMatchObject({ categories: [], sourceStatus: 'UNAVAILABLE', gates: { aiAvailable: false } });
    catalog.error = new AffiliateCredentialRejectedError('SHEIN');
    expect((await make().execute(TENANT)).sourceStatus).toBe('CREDENTIAL_REJECTED');
    credentials.state = { state: 'rejected', since: NOW, code: 'X' };
    expect((await make().execute(TENANT)).sourceStatus).toBe('CREDENTIAL_REJECTED');
  });

  it('erro da IA ao checar vira aiAvailable false', async () => {
    const uc = new GetOfferHunterOptionsUseCase({
      entitlements: reader(ent), credentials, riskGate: risk, ai: { isAvailable: async () => { throw new Error('x'); } }, settings, providers: testProviders(catalog),
    });
    expect((await uc.execute(TENANT)).gates.aiAvailable).toBe(false);
  });
});

describe('destino', () => {
  const configs = (groupsOf: Record<string, string[]>) => ({
    findSession: async (t: string, s: string) => (t === TENANT && s === 's1' ? { id: 's1', engine: 'baileys' } as never : null),
    filterSessionGroups: async (t: string, _s: string[], ids: string[]) =>
      ids.filter((id) => (groupsOf[t] ?? []).includes(id)).map((conversationId) => ({ conversationId, sessionId: 's1', groupJid: `${conversationId}@g.us` })),
    listSessionGroupConversations: async (t: string) =>
      (groupsOf[t] ?? []).map((conversationId) => ({ conversationId, groupJid: `${conversationId}@g.us`, title: `Grupo ${conversationId}`, avatarUrl: null })),
  });

  it('GET: não escolhido → valid false; grupo ainda da sessão → true; sumiu → false', async () => {
    const settings = new InMemorySettings();
    const uc = (g: Record<string, string[]>) => new GetOfferHunterDestinationUseCase({ settings, configs: configs(g) });
    expect(await uc({}).execute(TENANT)).toEqual({ sessionId: null, conversationId: null, valid: false, groupName: null });
    await settings.upsert(TENANT, 's1', 'c1');
    expect(await uc({ [TENANT]: ['c1'] }).execute(TENANT)).toMatchObject({ valid: true, groupName: 'Grupo c1' });
    expect((await uc({}).execute(TENANT)).valid).toBe(false);
  });

  it('PUT: grupo de outro tenant → 404, nada gravado', async () => {
    const settings = new InMemorySettings();
    const uc = new SetOfferHunterDestinationUseCase({
      settings, configs: configs({ 'tenant-2': ['c9'] }), groupUsage: { listRows: async () => [] }, entitlements: reader(MAX_ENTITLEMENTS),
    });
    await expect(uc.execute({ tenantId: TENANT, sessionId: 's1', conversationId: 'c9' })).rejects.toMatchObject({ statusCode: 404 });
    expect(settings.items.size).toBe(0);
  });
});

describe('histórico com cursor keyset assinado', () => {
  const run = (i: number): OfferHuntRunSummary => ({
    id: `run-${String(i).padStart(3, '0')}`, tenantId: TENANT, provider: 'SHEIN', huntId: HUNT, trigger: 'MANUAL', status: 'SUCCEEDED',
    seenCount: 0, matchedCount: 0, chosenCount: 0, sentCount: 0, aiUsed: false, aiFallback: false, rejectedBy: null, hasRanking: false, errorCode: null,
    startedAt: new Date(NOW.getTime() - i * 60_000), finishedAt: null,
  });
  const all = Array.from({ length: 25 }, (_, i) => run(i));
  const hunts = { findById: async (t: string, id: string) => (t === TENANT && id === HUNT ? makeHunt() : null) };
  const runs = {
    listByHunt: async (_t: string, _h: string, p: { limit: number; after?: OfferHuntPageCursor }) => {
      const start = p.after ? all.findIndex((r) => r.id === p.after!.id) + 1 : 0;
      return all.slice(start, start + p.limit);
    },
  };
  const uc = new ListOfferHuntRunsUseCase({ hunts, runs });

  it('página do servidor + próximo cursor; última página sem cursor', async () => {
    const p1 = await uc.execute({ tenantId: TENANT, huntId: HUNT });
    expect(p1.items).toHaveLength(OFFER_HUNT_PAGE_SIZE);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await uc.execute({ tenantId: TENANT, huntId: HUNT, cursor: p1.nextCursor! });
    expect(p2.items.map((r) => r.id)).toEqual(all.slice(20).map((r) => r.id));
    expect(p2.nextCursor).toBeNull();
  });

  it('cursor adulterado, de outra caçada ou de outra lista → 400', async () => {
    const { nextCursor } = await uc.execute({ tenantId: TENANT, huntId: HUNT });
    const [, sig] = nextCursor!.split('~');
    const forged = `${Buffer.from(JSON.stringify({ a: NOW.toISOString(), i: 'run-999' })).toString('base64url')}~${sig}`;
    await expect(uc.execute({ tenantId: TENANT, huntId: HUNT, cursor: forged })).rejects.toMatchObject({ code: 'OFFER_HUNT_CURSOR_INVALID', statusCode: 400 });
    await expect(uc.execute({ tenantId: TENANT, huntId: HUNT, cursor: 'lixo' })).rejects.toMatchObject({ statusCode: 400 });
    const finds = new ListOfferHuntFindsUseCase({ hunts, finds: { listByHunt: async () => [] } });
    await expect(finds.execute({ tenantId: TENANT, huntId: HUNT, cursor: nextCursor! })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('caçada de outro tenant → 404', async () => {
    await expect(uc.execute({ tenantId: 'tenant-2', huntId: HUNT })).rejects.toMatchObject({ code: 'OFFER_HUNT_NOT_FOUND' });
  });
});

describe('OfferHunterAudienceGate', () => {
  const gate = (enabled: boolean | null) => new OfferHunterAudienceGate({ getBoolean: async () => enabled });

  it('super_admin: só super admin, sem olhar o plano', async () => {
    expect(await gate(true).allows({ audience: 'super_admin', isSuperAdmin: false, tenantId: TENANT })).toBe(false);
    expect(await gate(null).allows({ audience: 'super_admin', isSuperAdmin: true, tenantId: TENANT })).toBe(true);
  });

  it('entitled: precisa do tenant com offer_hunter_enabled === true', async () => {
    expect(await gate(true).allows({ audience: 'entitled', isSuperAdmin: false, tenantId: TENANT })).toBe(true);
    expect(await gate(null).allows({ audience: 'entitled', isSuperAdmin: true, tenantId: TENANT })).toBe(false);
    expect(await gate(true).allows({ audience: 'entitled', isSuperAdmin: false, tenantId: null })).toBe(false);
  });
});

describe('Opções por marca e GET /options/providers', () => {
  const ML_STATE = { state: 'ok' as const, cred: { provider: 'MERCADO_LIVRE' as const, publicIdentifier: 'tag', secret: null, session: { cookies: { ssid: 'S' } } } };

  it('options(MERCADO_LIVRE): capacidades e presets da marca, plano livre, fonte ML (sem chamar a Shein)', async () => {
    const shein = new FakeCatalog();
    const ml = new FakeHuntCatalogSource('MERCADO_LIVRE');
    const credentials = new FakeCredentials();
    credentials.state = ML_STATE;
    const uc = new GetOfferHunterOptionsUseCase({
      entitlements: reader({ ...MAX_ENTITLEMENTS, [ENTITLEMENT_KEYS.MARKETPLACE_SHEIN_ENABLED]: false }), credentials,
      riskGate: new FakeRiskGate(), ai: { isAvailable: async () => true }, settings: new InMemorySettings(), providers: testProviders(shein, ml),
    });
    const out = await uc.execute(TENANT, 'MERCADO_LIVRE');
    expect(out).toMatchObject({ provider: 'MERCADO_LIVRE', sourceStatus: 'OK', sorts: ['relevance', 'lowest_price', 'highest_price'] });
    expect(out.gates).toMatchObject({ plan: true, credential: true });
    expect(out.capabilities.localFilters).not.toContain('minReviews');
    expect(out.categories).toEqual([{ categoryId: 'MLB1430', name: 'Roupas' }]);
    // Predefinições: nenhuma usa filtro fora da marca; ordenação sempre da marca
    for (const p of out.presets) expect(out.sorts).toContain(p.definition.source.sort);
    expect(out.presets.map((p) => p.key)).not.toContain('NEW_ARRIVALS');
    expect(shein.calls).toHaveLength(0);
    expect(JSON.stringify(out)).not.toContain('"S"');
  });

  it('options(SHEIN) padrão: presets e sorts de antes', async () => {
    const uc = new GetOfferHunterOptionsUseCase({
      entitlements: reader(MAX_ENTITLEMENTS), credentials: new FakeCredentials(), riskGate: new FakeRiskGate(),
      ai: { isAvailable: async () => true }, settings: new InMemorySettings(), providers: testProviders(new FakeCatalog()),
    });
    const out = await uc.execute(TENANT);
    expect(out.provider).toBe('SHEIN');
    expect(out.presets.map((p) => p.key)).toEqual(['TOP_COMMISSION', 'BEST_SELLERS', 'BIGGEST_DISCOUNT', 'NEW_ARRIVALS', 'CUSTOM']);
    expect(out.sorts).toContain('BEST_SELLING');
  });

  it('providers: portões de cada marca sem chamar nenhuma fonte', async () => {
    const shein = new FakeCatalog();
    const ml = new FakeHuntCatalogSource('MERCADO_LIVRE');
    const credentials = new FakeCredentials();
    (credentials as unknown as { resolveState: (t: string, p: string) => Promise<unknown> }).resolveState = async (_t: string, p: string) => (p === 'MERCADO_LIVRE' ? { state: 'rejected', since: NOW, code: 'X' } : credentials.state) as never;
    const risk = new FakeRiskGate();
    const uc = new GetOfferHunterProvidersUseCase({
      entitlements: reader({ ...MAX_ENTITLEMENTS, [ENTITLEMENT_KEYS.MARKETPLACE_SHEIN_ENABLED]: false }), credentials, riskGate: risk,
      ai: { isAvailable: async () => false }, settings: new InMemorySettings(), providers: testProviders(shein, ml),
    });
    const { items } = await uc.execute(TENANT);
    expect(items.map((i) => [i.provider, i.credentialState, i.gates.plan, i.gates.credential])).toEqual([
      ['SHEIN', 'OK', false, true], ['MERCADO_LIVRE', 'REJECTED', true, false],
    ]);
    expect(risk.calls.map((c) => c[1])).toEqual(['SHEIN', 'MERCADO_LIVRE']);
    expect(shein.calls).toHaveLength(0);
    expect(ml.calls).toHaveLength(0);
  });
});
