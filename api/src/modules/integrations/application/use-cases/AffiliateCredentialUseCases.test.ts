import { describe, it, expect, vi } from 'vitest';
import { UpsertAffiliateCredentialUseCase } from './UpsertAffiliateCredentialUseCase';
import { DeleteAffiliateCredentialUseCase } from './DeleteAffiliateCredentialUseCase';
import { ClearAffiliateSessionUseCase } from './ClearAffiliateSessionUseCase';
import { SetAffiliateCredentialStatusUseCase } from './SetAffiliateCredentialStatusUseCase';
import { ResolveAffiliateCredentialUseCase } from './ResolveAffiliateCredentialUseCase';
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
    status: 'ACTIVE', lastValidatedAt: null, createdAt: NOW, updatedAt: NOW,
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
  } satisfies IAffiliateCredentialRepository;
  const audit = { create: vi.fn().mockResolvedValue(undefined) } satisfies IAuditLogRepository;
  const getCipher = vi.fn(() => cipher);
  return { repo, audit, getCipher };
}

const errorOf = (p: Promise<unknown>) => p.catch((e: unknown) => e);

describe('UpsertAffiliateCredentialUseCase', () => {
  const upsert = (d: ReturnType<typeof makeDeps>) => new UpsertAffiliateCredentialUseCase(d.repo, d.getCipher, d.audit);

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
