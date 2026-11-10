import { describe, it, expect, vi } from 'vitest';
import { UpsertAffiliateSessionUseCase } from './UpsertAffiliateSessionUseCase';
import { AesGcmSecretCipher } from '../../../../shared/security/AesGcmSecretCipher';
import type { IAffiliateCredentialRepository } from '../../domain/contracts/IAffiliateCredentialRepository';
import type { AffiliateCredentialRecord } from '../../domain/contracts/AffiliateCredentialRecords';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';

const TENANT = 'tenant-1';
const USER = 'user-1';
const NOW = new Date('2026-10-22T12:00:00.000Z');
const AAD = `${TENANT}:MERCADO_LIVRE:session`;
const cipher = new AesGcmSecretCipher(new Map([[1, Buffer.alloc(32, 5)]]), 1);

function record(session: AffiliateCredentialRecord['session'], publicIdentifier: string | null = null): AffiliateCredentialRecord {
  return {
    id: 'c1', tenantId: TENANT, provider: 'MERCADO_LIVRE', publicIdentifier,
    hasSecret: false, hasSession: session !== null, sessionSyncedAt: NOW,
    sessionInvalidAt: null, sessionAccountHash: null, sessionAccountKeyVersion: null, status: 'ACTIVE',
    lastValidatedAt: null, rejectedAt: null, rejectedCode: null, createdAt: NOW, updatedAt: NOW, secret: null, session,
  };
}

function makeDeps(existing: AffiliateCredentialRecord | null) {
  const repo = {
    listByTenant: vi.fn(),
    findByTenantAndProvider: vi.fn().mockResolvedValue(existing),
    findActiveByTenantAndProvider: vi.fn(),
    upsert: vi.fn(),
    upsertSession: vi.fn().mockImplementation(async (i) => record(i.session, i.publicIdentifierIfEmpty ?? null)),
    delete: vi.fn(),
    clearSession: vi.fn(),
    setStatus: vi.fn(),
    markRejected: vi.fn(),
  } satisfies IAffiliateCredentialRepository;
  const audit = { create: vi.fn().mockResolvedValue(undefined) } satisfies IAuditLogRepository;
  const useCase = new UpsertAffiliateSessionUseCase(repo, () => cipher, audit, () => NOW);
  return { repo, audit, useCase };
}

const input = (over?: object) => ({
  tenantId: TENANT, userId: USER, provider: 'MERCADO_LIVRE' as const,
  cookies: { ssid: 'ssid-abc' }, csrf: 'csrf-xyz', capturedAt: '2026-10-22T11:59:00.000Z', ...over,
});

describe('UpsertAffiliateSessionUseCase', () => {
  it('sessão nova sem tag: cria linha sem ID público, cifrada, com relógio do servidor, e audita', async () => {
    const d = makeDeps(null);
    await d.useCase.execute(input());

    const call = d.repo.upsertSession.mock.calls[0]![0];
    expect(call).not.toHaveProperty('publicIdentifierIfEmpty');
    expect(call.syncedAt).toEqual(NOW);
    expect(call.session.ciphertext.toString('utf8')).not.toContain('ssid-abc');
    expect(JSON.parse(cipher.decrypt(call.session, AAD))).toEqual({ cookies: { ssid: 'ssid-abc' }, csrf: 'csrf-xyz' });
    expect(d.audit.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'AFFILIATE_SESSION_SYNCED' }));
    expect(JSON.stringify(d.audit.create.mock.calls)).not.toContain('ssid-abc');
  });

  it('tag válida vai como ID só-se-vazio; tag inválida é descartada e a sessão grava mesmo assim', async () => {
    const ok = makeDeps(null);
    await ok.useCase.execute(input({ affiliateTag: ' minha_loja ' }));
    expect(ok.repo.upsertSession.mock.calls[0]![0].publicIdentifierIfEmpty).toBe('minha_loja');

    const bad = makeDeps(null);
    await bad.useCase.execute(input({ affiliateTag: 'tag com espaço!' }));
    expect(bad.repo.upsertSession.mock.calls[0]![0]).not.toHaveProperty('publicIdentifierIfEmpty');
    expect(bad.audit.create.mock.calls[0]![0].meta).toMatchObject({ tagIgnored: true });
  });

  it('segundo sync com o mesmo token não audita', async () => {
    const current = cipher.encrypt(JSON.stringify({ cookies: { ssid: 'ssid-abc' }, csrf: 'old' }), AAD);
    const d = makeDeps(record(current));
    await d.useCase.execute(input());

    expect(d.repo.upsertSession).toHaveBeenCalled();
    expect(d.audit.create).not.toHaveBeenCalled();
  });

  it('token diferente audita', async () => {
    const current = cipher.encrypt(JSON.stringify({ cookies: { ssid: 'ssid-velho' }, csrf: 'old' }), AAD);
    const d = makeDeps(record(current));
    await d.useCase.execute(input());
    expect(d.audit.create).toHaveBeenCalledTimes(1);
  });

  it('blob atual indecifrável: regrava e audita, sem erro', async () => {
    const current = cipher.encrypt('x', 'outro-tenant:MERCADO_LIVRE:session');
    const d = makeDeps(record(current));
    await expect(d.useCase.execute(input())).resolves.toBeDefined();
    expect(d.repo.upsertSession).toHaveBeenCalled();
    expect(d.audit.create).toHaveBeenCalledTimes(1);
  });

  it('provider sem sessão: 422', async () => {
    const d = makeDeps(null);
    const err = await d.useCase.execute(input({ provider: 'SHOPEE' })).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'AFFILIATE_CREDENTIAL_INVALID', statusCode: 422 });
    expect(d.repo.upsertSession).not.toHaveBeenCalled();
  });
});

describe('UpsertAffiliateSessionUseCase — rejeição', () => {
  it('mesmo token: mantém a rejeição (clearRejection false); token novo: limpa', async () => {
    const same = makeDeps(record(cipher.encrypt(JSON.stringify({ cookies: { ssid: 'ssid-abc' } }), AAD)));
    await same.useCase.execute(input());
    expect(same.repo.upsertSession.mock.calls[0]![0]).toMatchObject({ clearRejection: false });
    const fresh = makeDeps(record(cipher.encrypt(JSON.stringify({ cookies: { ssid: 'old' } }), AAD)));
    await fresh.useCase.execute(input());
    expect(fresh.repo.upsertSession.mock.calls[0]![0]).toMatchObject({ clearRejection: true });
  });

  const rejectedRecord = () => ({
    ...record(cipher.encrypt(JSON.stringify({ cookies: { ssid: 'ssid-abc' } }), AAD)),
    rejectedAt: new Date('2026-11-01T00:00:00.000Z'),
    rejectedCode: 'AFFILIATE_CREDENTIAL_REJECTED',
  });

  it('loja aceitou (VALID): libera mesmo com o mesmo token', async () => {
    const d = makeDeps(rejectedRecord());
    await d.useCase.execute(input({ sessionCheck: 'VALID' }));
    const call = d.repo.upsertSession.mock.calls[0]![0];
    expect(call).toMatchObject({ clearRejection: true });
    expect(call.rejectWith).toBeUndefined();
  });

  it('loja recusou (REJECTED): grava a rejeição e audita, mesmo com token novo', async () => {
    const d = makeDeps(record(cipher.encrypt(JSON.stringify({ cookies: { ssid: 'old' } }), AAD)));
    await d.useCase.execute(input({ sessionCheck: 'REJECTED' }));
    expect(d.repo.upsertSession.mock.calls[0]![0]).toMatchObject({
      clearRejection: false,
      rejectWith: { at: NOW, code: 'AFFILIATE_CREDENTIAL_REJECTED' },
    });
    expect(d.audit.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'AFFILIATE_CREDENTIAL_REJECTED' }));
  });

  it('já recusada e loja recusa de novo: mantém a data original, sem nova auditoria de recusa', async () => {
    const d = makeDeps(rejectedRecord());
    await d.useCase.execute(input({ sessionCheck: 'REJECTED' }));
    const call = d.repo.upsertSession.mock.calls[0]![0];
    expect(call).toMatchObject({ clearRejection: false });
    expect(call.rejectWith).toBeUndefined();
    expect(d.audit.create).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'AFFILIATE_CREDENTIAL_REJECTED' }));
  });
});

describe('UpsertAffiliateSessionUseCase — Shein (token `AT`, ID segue a sessão)', () => {
  const SHEIN_AAD = `${TENANT}:SHEIN:session`;
  const shein = (over?: object) => input({
    provider: 'SHEIN', cookies: { AT: 'at-token-1', memberId: '4320454940' }, csrf: undefined, sessionIdentifier: '4320454940', ...over,
  });
  const sheinRecord = (at: string) => ({
    ...record(cipher.encrypt(JSON.stringify({ cookies: { AT: at, memberId: '4320454940' } }), SHEIN_AAD), '4320454940'),
    provider: 'SHEIN' as const,
    rejectedAt: new Date('2026-11-01T00:00:00.000Z'),
    rejectedCode: 'AFFILIATE_CREDENTIAL_REJECTED',
  });

  it('nova: grava cifrado com AAD SHEIN, ID como override (nunca só-se-vazio) e audita sem o token', async () => {
    const d = makeDeps(null);
    await d.useCase.execute(shein());
    const call = d.repo.upsertSession.mock.calls[0]![0];
    expect(call).toMatchObject({ provider: 'SHEIN', publicIdentifierOverride: '4320454940' });
    expect(call).not.toHaveProperty('publicIdentifierIfEmpty');
    expect(JSON.parse(cipher.decrypt(call.session, SHEIN_AAD)).cookies).toEqual({ AT: 'at-token-1', memberId: '4320454940' });
    expect(call.session.ciphertext.toString('utf8')).not.toContain('at-token-1');
    expect(d.audit.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'AFFILIATE_SESSION_SYNCED' }));
    expect(JSON.stringify(d.audit.create.mock.calls)).not.toContain('at-token-1');
  });

  it('mesmo AT: não zera a recusa nem audita de novo (compara `AT`, não `ssid`)', async () => {
    const d = makeDeps(sheinRecord('at-token-1'));
    await d.useCase.execute(shein());
    expect(d.repo.upsertSession.mock.calls[0]![0]).toMatchObject({ clearRejection: false });
    expect(d.audit.create).not.toHaveBeenCalled();
  });

  it('AT novo: zera a recusa e audita', async () => {
    const d = makeDeps(sheinRecord('at-velho'));
    await d.useCase.execute(shein());
    expect(d.repo.upsertSession.mock.calls[0]![0]).toMatchObject({ clearRejection: true });
    expect(d.audit.create).toHaveBeenCalledTimes(1);
  });

  it('troca de conta: o ID novo vai como override', async () => {
    const d = makeDeps(sheinRecord('at-velho'));
    await d.useCase.execute(shein({ cookies: { AT: 'at-2', memberId: '9876543210' }, sessionIdentifier: '9876543210' }));
    expect(d.repo.upsertSession.mock.calls[0]![0].publicIdentifierOverride).toBe('9876543210');
  });

  it('sem ID da sessão ou ID fora do formato: 422 sem gravar; affiliateTag é ignorada', async () => {
    for (const over of [{ sessionIdentifier: undefined }, { sessionIdentifier: 'abc' }]) {
      const d = makeDeps(null);
      await expect(d.useCase.execute(shein(over))).rejects.toMatchObject({ statusCode: 422 });
      expect(d.repo.upsertSession).not.toHaveBeenCalled();
    }
    const tagged = makeDeps(null);
    await tagged.useCase.execute(shein({ affiliateTag: '1234567' }));
    expect(tagged.repo.upsertSession.mock.calls[0]![0]).not.toHaveProperty('publicIdentifierIfEmpty');
  });

  it('ML não recebe override', async () => {
    const d = makeDeps(null);
    await d.useCase.execute(input({ sessionIdentifier: '4320454940' }));
    expect(d.repo.upsertSession.mock.calls[0]![0]).not.toHaveProperty('publicIdentifierOverride');
  });
});
