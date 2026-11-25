import { describe, it, expect, vi } from 'vitest';
import { UpsertAffiliateCredentialUseCase } from './UpsertAffiliateCredentialUseCase';
import { DeleteAffiliateCredentialUseCase } from './DeleteAffiliateCredentialUseCase';
import { ClearAffiliateSessionUseCase } from './ClearAffiliateSessionUseCase';
import { SetAffiliateCredentialStatusUseCase } from './SetAffiliateCredentialStatusUseCase';
import { ResolveAffiliateCredentialUseCase } from './ResolveAffiliateCredentialUseCase';
import { MarkAffiliateCredentialRejectedUseCase } from './MarkAffiliateCredentialRejectedUseCase';
import { ListAffiliateCredentialsUseCase } from './ListAffiliateCredentialsUseCase';
import type { AffiliateProvider } from '../../domain/enums/AffiliateProvider';
import { AesGcmSecretCipher } from '../../../../shared/security/AesGcmSecretCipher';
import type { IAffiliateCredentialRepository } from '../../domain/contracts/IAffiliateCredentialRepository';
import type { AffiliateCredentialRecord } from '../../domain/contracts/AffiliateCredentialRecords';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import { affiliateCipherAad } from './affiliateCipherAad';

const TENANT = 'tenant-1';
const USER = 'user-1';
const SECRET = 'ABCDEF1234567890ABCDEF1234567890';
const NOW = new Date('2026-10-22T12:00:00.000Z');
const cipher = new AesGcmSecretCipher(new Map([[1, Buffer.alloc(32, 5)]]), 1);

function makeRecord(overrides?: Partial<AffiliateCredentialRecord>): AffiliateCredentialRecord {
  return {
    id: 'c1', tenantId: TENANT, provider: 'SHOPEE', publicIdentifier: '18301234567',
    hasSecret: true, hasSession: false, sessionSyncedAt: null,
    sessionInvalidAt: null, sessionAccountHash: null, sessionAccountKeyVersion: null,
    status: 'ACTIVE', lastValidatedAt: null, rejectedAt: null, rejectedCode: null, createdAt: NOW, updatedAt: NOW,
    secret: cipher.encrypt(SECRET, affiliateCipherAad(TENANT, 'SHOPEE', 'secret')), session: null,
    ...overrides,
  };
}

function makeDeps(existing: AffiliateCredentialRecord | null = null) {
  const repo = {
    listByTenant: vi.fn(),
    findByTenantAndProvider: vi.fn().mockResolvedValue(existing),
    findActiveByTenantAndProvider: vi.fn().mockResolvedValue(existing),
    upsert: vi.fn().mockImplementation(async (i) => ({ ...makeRecord(), publicIdentifier: i.publicIdentifier })),
    upsertSession: vi.fn(),
    delete: vi.fn().mockResolvedValue(existing !== null),
    clearSession: vi.fn().mockResolvedValue(existing?.hasSession ?? false),
    setStatus: vi.fn().mockResolvedValue(existing),
    markRejected: vi.fn().mockResolvedValue(undefined),
    setIdentifiers: vi.fn(),
  } satisfies IAffiliateCredentialRepository;
  const audit = { create: vi.fn().mockResolvedValue(undefined) } satisfies IAuditLogRepository;
  const getCipher = vi.fn(() => cipher);
  return { repo, audit, getCipher };
}

const errorOf = (p: Promise<unknown>) => p.catch((e: unknown) => e);

describe('UpsertAffiliateCredentialUseCase', () => {
  const upsert = (d: ReturnType<typeof makeDeps>) => new UpsertAffiliateCredentialUseCase(d.repo, d.getCipher, d.audit);

  it('Shein (ID segue a sessão): PUT manual recusado com 422, nada gravado', async () => {
    const d = makeDeps();
    const err = await errorOf(upsert(d).execute({ tenantId: TENANT, userId: USER, provider: 'SHEIN', publicIdentifier: '4320454940' }));
    expect(err).toMatchObject({ code: 'AFFILIATE_CREDENTIAL_INVALID', statusCode: 422 });
    expect(d.repo.upsert).not.toHaveBeenCalled();
  });

  it('Shopee nova sem secret: recusa com 422 apontando o campo', async () => {
    const d = makeDeps(null);
    const err = await errorOf(upsert(d).execute({ tenantId: TENANT, userId: USER, provider: 'SHOPEE', publicIdentifier: '18301234567' }));

    expect(err).toMatchObject({ code: 'AFFILIATE_CREDENTIAL_INVALID', statusCode: 422, meta: { field: 'secret' } });
    expect(d.repo.upsert).not.toHaveBeenCalled();
  });

  it('Shopee nova com secret: grava cifrado com AAD do tenant e audita sem o valor', async () => {
    const d = makeDeps(null);
    await upsert(d).execute({ tenantId: TENANT, userId: USER, provider: 'SHOPEE', publicIdentifier: ' 18301234567 ', secret: SECRET });

    const call = d.repo.upsert.mock.calls[0]![0];
    expect(call.publicIdentifier).toBe('18301234567');
    expect(call.secret.ciphertext.toString('utf8')).not.toContain(SECRET);
    expect(cipher.decrypt(call.secret, `${TENANT}:SHOPEE:secret`)).toBe(SECRET);
    expect(d.audit.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'AFFILIATE_CREDENTIAL_UPSERTED' }));
    expect(JSON.stringify(d.audit.create.mock.calls)).not.toContain(SECRET);
  });

  it('Shopee existente sem secret: mantém o segredo atual (não envia blob)', async () => {
    const d = makeDeps(makeRecord());
    await upsert(d).execute({ tenantId: TENANT, userId: USER, provider: 'SHOPEE', publicIdentifier: '99999999', secret: '  ' });

    expect(d.repo.upsert.mock.calls[0]![0]).not.toHaveProperty('secret');
    expect(d.getCipher).not.toHaveBeenCalled();
  });

  it('Amazon não usa a cifra: funciona mesmo sem chave configurada', async () => {
    const d = makeDeps(null);
    d.getCipher.mockImplementation(() => { throw new Error('sem chave'); });
    await upsert(d).execute({ tenantId: TENANT, userId: USER, provider: 'AMAZON', publicIdentifier: 'minhaloja-20' });
    expect(d.repo.upsert).toHaveBeenCalled();
  });

  it('secret enviado a provider sem campo secreto: 422', async () => {
    const d = makeDeps(null);
    const err = await errorOf(upsert(d).execute({ tenantId: TENANT, userId: USER, provider: 'AMAZON', publicIdentifier: 'minhaloja-20', secret: SECRET }));
    expect(err).toMatchObject({ statusCode: 422, meta: { field: 'secret' } });
  });

  it('ID público fora do formato: 422 no campo público', async () => {
    const d = makeDeps(null);
    const err = await errorOf(upsert(d).execute({ tenantId: TENANT, userId: USER, provider: 'AMAZON', publicIdentifier: 'sem-sufixo' }));
    expect(err).toMatchObject({ statusCode: 422, meta: { field: 'publicIdentifier' } });
  });
});

describe('UpsertAffiliateCredentialUseCase — lojas novas', () => {
  const upsert = (d: ReturnType<typeof makeDeps>) => new UpsertAffiliateCredentialUseCase(d.repo, d.getCipher, d.audit);
  const APP_KEY = '512345';
  const APP_SECRET = 'AbCdEf0123456789AbCdEf0123456789';
  const ali = (over: { appKey?: string; secret?: string }) =>
    ({ tenantId: TENANT, userId: USER, provider: 'ALIEXPRESS' as const, publicIdentifier: 'meu_tracking', ...over });

  it('AliExpress: junta appKey:appSecret, cifra com AAD do tenant; auditoria sem App Key nem segredo', async () => {
    const d = makeDeps(null);
    await upsert(d).execute(ali({ appKey: ` ${APP_KEY} `, secret: APP_SECRET }));
    const call = d.repo.upsert.mock.calls[0]![0];
    expect(cipher.decrypt(call.secret, `${TENANT}:ALIEXPRESS:secret`)).toBe(`${APP_KEY}:${APP_SECRET}`);
    expect(call).not.toHaveProperty('appKey');
    const audited = JSON.stringify(d.audit.create.mock.calls);
    expect(audited).not.toContain(APP_SECRET);
    expect(audited).not.toContain(APP_KEY);
  });

  it.each([
    ['sem App Key', { secret: APP_SECRET }, 'appKey'],
    ['sem Secret', { appKey: APP_KEY }, 'secret'],
    ['sem os dois', {}, 'secret'],
    ['App Key fora do formato', { appKey: 'abc', secret: APP_SECRET }, 'appKey'],
    ['Secret fora do formato', { appKey: APP_KEY, secret: 'curto' }, 'secret'],
  ])('AliExpress criação %s → 422 com field', async (_, over, field) => {
    const d = makeDeps(null);
    const err = await errorOf(upsert(d).execute(ali(over)));
    expect(err).toMatchObject({ code: 'AFFILIATE_CREDENTIAL_INVALID', statusCode: 422, meta: { field } });
    expect(d.repo.upsert).not.toHaveBeenCalled();
  });

  it('AliExpress edição: os dois vazios mantém o segredo; só um preenchido → 422', async () => {
    const existing = makeRecord({ provider: 'ALIEXPRESS', publicIdentifier: 'meu_tracking' });
    const keep = makeDeps(existing);
    await upsert(keep).execute(ali({ appKey: ' ', secret: '' }));
    expect(keep.repo.upsert.mock.calls[0]![0]).not.toHaveProperty('secret');
    expect(keep.getCipher).not.toHaveBeenCalled();

    for (const [over, field] of [[{ appKey: APP_KEY }, 'secret'], [{ secret: APP_SECRET }, 'appKey']] as const) {
      const d = makeDeps(existing);
      expect(await errorOf(upsert(d).execute(ali(over)))).toMatchObject({ statusCode: 422, meta: { field } });
      expect(d.repo.upsert).not.toHaveBeenCalled();
    }
  });

  it('App Key em loja sem esse campo → 422 appKey', async () => {
    const d = makeDeps(null);
    const err = await errorOf(upsert(d).execute({ tenantId: TENANT, userId: USER, provider: 'SHOPEE', publicIdentifier: '18301234567', secret: SECRET, appKey: APP_KEY }));
    expect(err).toMatchObject({ statusCode: 422, meta: { field: 'appKey' } });
  });

  it.each([
    'minhaloja',
    'https://www.magazinevoce.com.br/minhaloja/',
    'https://www.magazinevoce.com.br/minhaloja/notebook/p/237805300/in/note/?x=1',
    'magazinevoce.com.br/minhaloja',
    ' www.magazinevoce.com.br/minhaloja ',
  ])('Magalu: %s → slug', async (value) => {
    const d = makeDeps(null);
    await upsert(d).execute({ tenantId: TENANT, userId: USER, provider: 'MAGALU', publicIdentifier: value });
    expect(d.repo.upsert.mock.calls[0]![0].publicIdentifier).toBe('minhaloja');
    expect(d.getCipher).not.toHaveBeenCalled();
  });

  it('Magalu: URL de outro host ou sem slug → 422 publicIdentifier', async () => {
    for (const value of ['https://www.magazineluiza.com.br/minhaloja', 'https://www.magazinevoce.com.br/', 'https://evil.magazinevoce.com.br.x.io/minhaloja']) {
      const d = makeDeps(null);
      expect(await errorOf(upsert(d).execute({ tenantId: TENANT, userId: USER, provider: 'MAGALU', publicIdentifier: value })))
        .toMatchObject({ statusCode: 422, meta: { field: 'publicIdentifier' } });
    }
  });

  it('Kabum: só Publisher ID; segredo recusado', async () => {
    const d = makeDeps(null);
    await upsert(d).execute({ tenantId: TENANT, userId: USER, provider: 'KABUM', publicIdentifier: '1234567' });
    expect(d.repo.upsert.mock.calls[0]![0]).toMatchObject({ publicIdentifier: '1234567' });
    const err = await errorOf(upsert(makeDeps(null)).execute({ tenantId: TENANT, userId: USER, provider: 'KABUM', publicIdentifier: '1234567', secret: SECRET }));
    expect(err).toMatchObject({ statusCode: 422, meta: { field: 'secret' } });
  });
});

describe('ListAffiliateCredentialsUseCase — audiência', () => {
  const HIDDEN: AffiliateProvider[] = ['KABUM', 'MAGALU', 'ALIEXPRESS'];
  function makeList(items: AffiliateProvider[]) {
    const d = makeDeps(null);
    d.repo.listByTenant.mockResolvedValue(items.map((provider) => makeRecord({ provider })));
    const isVisible = vi.fn(async (p: AffiliateProvider, v: { isSuperAdmin: boolean }) => v.isSuperAdmin || !HIDDEN.includes(p));
    const entitlements = { getBoolean: vi.fn().mockResolvedValue(true), getNumber: vi.fn().mockResolvedValue(null) };
    const presets = { listByKeys: vi.fn().mockResolvedValue([]) };
    const risk = { findCurrent: vi.fn().mockResolvedValue(null) };
    const uc = new ListAffiliateCredentialsUseCase(d.repo, entitlements as never, presets as never, risk as never, { isVisible });
    return { uc, presets };
  }

  it('usuário comum: loja oculta some de items e de marketplaceAvailability', async () => {
    const { uc, presets } = makeList(['SHOPEE', 'KABUM', 'ALIEXPRESS']);
    const r = await uc.execute({ tenantId: TENANT, userId: USER, viewer: { isSuperAdmin: false } });
    expect(r.items.map((c) => c.provider)).toEqual(['SHOPEE']);
    expect(Object.keys(r.marketplaceAvailability)).toEqual(['SHOPEE', 'MERCADO_LIVRE', 'AMAZON', 'SHEIN']);
    expect(presets.listByKeys).toHaveBeenCalledWith(['marketplace_shein_enabled']);
  });

  it('super admin: vê as 7 lojas e as credenciais delas', async () => {
    const { uc } = makeList(['SHOPEE', 'KABUM', 'ALIEXPRESS']);
    const r = await uc.execute({ tenantId: TENANT, userId: USER, viewer: { isSuperAdmin: true } });
    expect(r.items.map((c) => c.provider)).toEqual(['SHOPEE', 'KABUM', 'ALIEXPRESS']);
    expect(Object.keys(r.marketplaceAvailability)).toHaveLength(7);
  });
});

describe('DeleteAffiliateCredentialUseCase', () => {
  it('inexistente: 404', async () => {
    const d = makeDeps(null);
    const err = await errorOf(new DeleteAffiliateCredentialUseCase(d.repo, d.audit).execute({ tenantId: TENANT, userId: USER, provider: 'SHOPEE' }));
    expect(err).toMatchObject({ code: 'AFFILIATE_CREDENTIAL_NOT_FOUND', statusCode: 404 });
    expect(d.audit.create).not.toHaveBeenCalled();
  });

  it('existente: apaga e audita', async () => {
    const d = makeDeps(makeRecord());
    await new DeleteAffiliateCredentialUseCase(d.repo, d.audit).execute({ tenantId: TENANT, userId: USER, provider: 'SHOPEE' });
    expect(d.repo.delete).toHaveBeenCalledWith(TENANT, 'SHOPEE');
    expect(d.audit.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'AFFILIATE_CREDENTIAL_DELETED' }));
  });
});

describe('ClearAffiliateSessionUseCase', () => {
  it('com sessão: zera e audita sem segredo', async () => {
    const d = makeDeps(makeRecord({ provider: 'MERCADO_LIVRE', hasSession: true }));
    await new ClearAffiliateSessionUseCase(d.repo, d.audit).execute({ tenantId: TENANT, userId: USER, provider: 'MERCADO_LIVRE' });
    expect(d.repo.clearSession).toHaveBeenCalledWith(TENANT, 'MERCADO_LIVRE');
    expect(d.audit.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'AFFILIATE_SESSION_ACCOUNT_RESET' }));
  });

  it('sem sessão: idempotente, não audita', async () => {
    const d = makeDeps(null);
    await new ClearAffiliateSessionUseCase(d.repo, d.audit).execute({ tenantId: TENANT, userId: USER, provider: 'MERCADO_LIVRE' });
    expect(d.audit.create).not.toHaveBeenCalled();
  });
});

describe('SetAffiliateCredentialStatusUseCase', () => {
  it('inexistente: 404', async () => {
    const d = makeDeps(null);
    const err = await errorOf(new SetAffiliateCredentialStatusUseCase(d.repo).execute({ tenantId: TENANT, userId: USER, provider: 'AMAZON', status: 'INACTIVE' }));
    expect(err).toMatchObject({ statusCode: 404 });
  });
});

describe('ResolveAffiliateCredentialUseCase', () => {
  it('ativa: devolve o segredo decifrado', async () => {
    const d = makeDeps(makeRecord());
    const r = await new ResolveAffiliateCredentialUseCase(d.repo, d.getCipher).execute(TENANT, 'SHOPEE');
    expect(r).toEqual({ provider: 'SHOPEE', publicIdentifier: '18301234567', secret: SECRET, session: null });
    expect(d.repo.findActiveByTenantAndProvider).toHaveBeenCalledWith(TENANT, 'SHOPEE');
  });

  it('inativa ou só-sessão (repositório não devolve): null', async () => {
    const d = makeDeps(null);
    await expect(new ResolveAffiliateCredentialUseCase(d.repo, d.getCipher).execute(TENANT, 'MERCADO_LIVRE')).resolves.toBeNull();
  });

  it('Shopee sem segredo gravado não resolve (credencial incompleta)', async () => {
    const d = makeDeps(makeRecord({ secret: null, hasSecret: false }));
    await expect(new ResolveAffiliateCredentialUseCase(d.repo, d.getCipher).execute(TENANT, 'SHOPEE')).resolves.toBeNull();
  });

  it('ML: sessão decifrada; JSON inválido vira erro genérico sem o texto', async () => {
    const mlRecord = (plain: string) => makeRecord({
      provider: 'MERCADO_LIVRE', publicIdentifier: 'minhaetq', secret: null, hasSecret: false, hasSession: true,
      session: cipher.encrypt(plain, affiliateCipherAad(TENANT, 'MERCADO_LIVRE', 'session')),
    });
    const ok = makeDeps(mlRecord('{"cookies":{"ssid":"tok123"},"csrf":"c"}'));
    const r = await new ResolveAffiliateCredentialUseCase(ok.repo, ok.getCipher).execute(TENANT, 'MERCADO_LIVRE');
    expect(r?.session).toEqual({ cookies: { ssid: 'tok123' }, csrf: 'c' });

    const bad = makeDeps(mlRecord('segredo-em-claro{'));
    const err = await errorOf(new ResolveAffiliateCredentialUseCase(bad.repo, bad.getCipher).execute(TENANT, 'MERCADO_LIVRE'));
    expect(err).toMatchObject({ code: 'SECRET_CIPHER_FAILED' });
    expect(String((err as Error).message)).not.toContain('segredo-em-claro');
  });

  it('provider sem sessão não decifra a sessão gravada', async () => {
    // Se fosse decifrada, o JSON inválido lançaria
    const d = makeDeps(makeRecord({ session: cipher.encrypt('{', affiliateCipherAad(TENANT, 'SHOPEE', 'session')) }));
    const r = await new ResolveAffiliateCredentialUseCase(d.repo, d.getCipher).execute(TENANT, 'SHOPEE');
    expect(r?.session).toBeNull();
  });

  it('linha sem ID público nunca resolve, mesmo se vier do repositório', async () => {
    const d = makeDeps(makeRecord({ publicIdentifier: null }));
    await expect(new ResolveAffiliateCredentialUseCase(d.repo, d.getCipher).execute(TENANT, 'SHOPEE')).resolves.toBeNull();
  });
});

describe('ResolveAffiliateCredentialUseCase — etiquetas da conta', () => {
  it('repassa accountIdentifiers e linkedIdentifiers crus (sem aplicar limite) em execute e resolveState', async () => {
    const lists = { accountIdentifiers: ['a', 'b', 'c', 'd'], linkedIdentifiers: ['b', 'c', 'd'] };
    const d = makeDeps(makeRecord(lists));
    const uc = new ResolveAffiliateCredentialUseCase(d.repo, d.getCipher);
    expect(await uc.execute(TENANT, 'SHOPEE')).toMatchObject(lists);
    expect(await uc.resolveState(TENANT, 'SHOPEE')).toMatchObject({ state: 'ok', cred: lists });
  });
});

describe('ResolveAffiliateCredentialUseCase.resolveState', () => {
  const uc = (d: ReturnType<typeof makeDeps>) => new ResolveAffiliateCredentialUseCase(d.repo, d.getCipher);

  it('ok: credencial decifrada', async () => {
    const r = await uc(makeDeps(makeRecord())).resolveState(TENANT, 'SHOPEE');
    expect(r).toMatchObject({ state: 'ok', cred: { provider: 'SHOPEE', secret: SECRET } });
  });

  it('missing: sem linha, ou INACTIVE sem rejeição (findActive não devolve)', async () => {
    expect(await uc(makeDeps(null)).resolveState(TENANT, 'SHOPEE')).toEqual({ state: 'missing' });
    const d = makeDeps(makeRecord({ status: 'INACTIVE' }));
    d.repo.findActiveByTenantAndProvider.mockResolvedValue(null);
    expect(await uc(d).resolveState(TENANT, 'SHOPEE')).toEqual({ state: 'missing' });
  });

  it('rejected: com rejectedAt, mesmo ACTIVE, INACTIVE ou só-sessão; sem decifrar', async () => {
    for (const over of [{}, { status: 'INACTIVE' as const }, { publicIdentifier: null }]) {
      const d = makeDeps(makeRecord({ ...over, rejectedAt: NOW, rejectedCode: 'AFFILIATE_CREDENTIAL_REJECTED' }));
      expect(await uc(d).resolveState(TENANT, 'SHOPEE')).toEqual({ state: 'rejected', since: NOW, code: 'AFFILIATE_CREDENTIAL_REJECTED' });
      expect(d.getCipher).not.toHaveBeenCalled();
    }
  });
});

describe('MarkAffiliateCredentialRejectedUseCase', () => {
  it('grava a rejeição e audita só provider e código', async () => {
    const d = makeDeps(makeRecord());
    await new MarkAffiliateCredentialRejectedUseCase(d.repo, d.audit, () => NOW).execute(TENANT, 'MERCADO_LIVRE', 'AFFILIATE_CREDENTIAL_REJECTED');
    expect(d.repo.markRejected).toHaveBeenCalledWith(TENANT, 'MERCADO_LIVRE', 'AFFILIATE_CREDENTIAL_REJECTED', NOW);
    expect(d.audit.create).toHaveBeenCalledWith({ tenantId: TENANT, action: 'AFFILIATE_CREDENTIAL_REJECTED', meta: { provider: 'MERCADO_LIVRE', code: 'AFFILIATE_CREDENTIAL_REJECTED' } });
  });
});

describe('UpsertAffiliateCredentialUseCase — limpar rejeição', () => {
  const upsert = (d: ReturnType<typeof makeDeps>) => new UpsertAffiliateCredentialUseCase(d.repo, d.getCipher, d.audit);
  const rejected = () => makeRecord({ rejectedAt: NOW, rejectedCode: 'AFFILIATE_CREDENTIAL_REJECTED' });

  it('Shopee com secret novo limpa; AppID diferente limpa; igual sem secret mantém', async () => {
    const a = makeDeps(rejected());
    await upsert(a).execute({ tenantId: TENANT, userId: USER, provider: 'SHOPEE', publicIdentifier: '18301234567', secret: SECRET });
    expect(a.repo.upsert.mock.calls[0]![0]).toMatchObject({ clearRejection: true });
    const b = makeDeps(rejected());
    await upsert(b).execute({ tenantId: TENANT, userId: USER, provider: 'SHOPEE', publicIdentifier: '99999999' });
    expect(b.repo.upsert.mock.calls[0]![0]).toMatchObject({ clearRejection: true });
    const c = makeDeps(rejected());
    await upsert(c).execute({ tenantId: TENANT, userId: USER, provider: 'SHOPEE', publicIdentifier: '18301234567' });
    expect(c.repo.upsert.mock.calls[0]![0]).toMatchObject({ clearRejection: false });
  });

  it('ML pelo painel (só etiqueta) nunca limpa: a recusa é da sessão', async () => {
    const d = makeDeps(makeRecord({ provider: 'MERCADO_LIVRE', hasSecret: false, secret: null, rejectedAt: NOW, rejectedCode: 'X' }));
    await upsert(d).execute({ tenantId: TENANT, userId: USER, provider: 'MERCADO_LIVRE', publicIdentifier: 'outra-etq' });
    expect(d.repo.upsert.mock.calls[0]![0]).toMatchObject({ clearRejection: false });
  });
});
