import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_PLATFORM_AI_REQUESTS_PER_DAY, ResolveAiTextProviderUseCase } from './ResolveAiTextProviderUseCase';
import { GetAiStatusUseCase } from './GetAiStatusUseCase';
import { SecretCipherUnavailableError } from '../../../../shared/errors/internal/SecretCipherErrors';
import { cipher, FakeCredentials, FakeProviders, FakeSettings } from './aiTestFakes';

const T = 'tenant-a';
let settings: FakeSettings;
let providers: FakeProviders;
let credentials: FakeCredentials;
let entitled: boolean;
let perDay: number | null;

const entitlements = { isAiRewriteEnabled: async () => entitled, aiRequestsPerDay: async () => perDay };
const resolver = () => new ResolveAiTextProviderUseCase(settings, providers, credentials, entitlements, cipher);
const status = () => new GetAiStatusUseCase(settings, providers, credentials, entitlements);

beforeEach(() => {
  settings = new FakeSettings();
  providers = new FakeProviders();
  credentials = new FakeCredentials();
  entitled = true;
  perDay = null;
});

describe('ResolveAiTextProviderUseCase', () => {
  it('plataforma: provedor ativo de menor prioridade, chave decifrada com AAD do id', async () => {
    providers.add({ id: 'p2', priority: 5 }, 'sk-second-key');
    providers.add({ id: 'p1', priority: 1, kind: 'OPENAI', model: 'gpt-4o-mini' }, 'sk-first-key');
    providers.add({ id: 'p0', priority: 0, enabled: false });
    credentials.add(T);
    expect(await resolver().execute(T)).toEqual({
      source: 'PLATFORM', kind: 'OPENAI', model: 'gpt-4o-mini', providerId: 'p1', apiKey: 'sk-first-key', baseUrl: null,
      dailyLimit: DEFAULT_PLATFORM_AI_REQUESTS_PER_DAY,
    });
  });

  it('teto diário: provedor > entitlement ai_requests_per_day > padrão', async () => {
    providers.add({ id: 'p1', dailyLimitPerTenant: 3 });
    perDay = 50;
    await expect(resolver().execute(T)).resolves.toMatchObject({ dailyLimit: 3 });
    providers.rows.get('p1')!.p.dailyLimitPerTenant = null;
    await expect(resolver().execute(T)).resolves.toMatchObject({ dailyLimit: 50 });
    perDay = null;
    await expect(resolver().execute(T)).resolves.toMatchObject({ dailyLimit: 200 });
  });

  it.each([
    ['plataforma desligada', () => { settings.value.platformEnabled = false; }],
    ['entitlement ai_rewrite_enabled = false', () => { entitled = false; }],
    ['nenhum provedor ativo', () => { providers.rows.get('p1')!.p.enabled = false; }],
  ])('%s → chave do tenant', async (_n, arrange) => {
    providers.add({ id: 'p1' });
    credentials.add(T, {}, 'sk-tenant-own');
    arrange();
    expect(await resolver().execute(T)).toEqual({
      source: 'TENANT', kind: 'OPENAI', model: 'gpt-4o-mini', providerId: null, apiKey: 'sk-tenant-own', baseUrl: null,
      dailyLimit: null,
    });
  });

  it.each([
    ['sem credencial', () => undefined],
    ['credencial inativa', () => credentials.add(T, { enabled: false })],
    ['chaves de tenant desligadas', () => { credentials.add(T); settings.value.tenantKeysEnabled = false; }],
  ])('%s e sem plataforma → 409 AI_NOT_CONFIGURED', async (_n, arrange) => {
    arrange();
    await expect(resolver().execute(T)).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED', statusCode: 409 });
  });

  it('chave de outro tenant não decifra (AAD amarra ao tenant) → AI_NOT_CONFIGURED', async () => {
    credentials.add('tenant-b');
    credentials.rows.set(T, credentials.rows.get('tenant-b')!);
    await expect(resolver().execute(T)).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED', statusCode: 409 });
  });

  it('cifra indisponível (SECRET_CIPHER_UNAVAILABLE) → AI_NOT_CONFIGURED', async () => {
    providers.add({ id: 'p1' });
    const broken = () => { throw new SecretCipherUnavailableError(); };
    const uc = new ResolveAiTextProviderUseCase(settings, providers, credentials, entitlements, broken);
    await expect(uc.execute(T)).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
  });
});

describe('GetAiStatusUseCase', () => {
  it('PLATFORM com credencial mascarada', async () => {
    providers.add({ id: 'p1' });
    credentials.add(T, { enabled: false });
    expect(await status().execute(T)).toEqual({
      mode: 'PLATFORM', tenantKeysAllowed: true, platformAvailable: true,
      credential: { kind: 'OPENAI', model: 'gpt-4o-mini', masked: '••••', enabled: false },
    });
  });

  it('TENANT quando a plataforma não serve e NONE sem nada', async () => {
    credentials.add(T);
    expect(await status().execute(T)).toMatchObject({ mode: 'TENANT', platformAvailable: false });
    settings.value.tenantKeysEnabled = false;
    expect(await status().execute(T)).toMatchObject({ mode: 'NONE', tenantKeysAllowed: false });
    credentials.rows.clear();
    expect((await status().execute(T)).credential).toBeNull();
  });
});
