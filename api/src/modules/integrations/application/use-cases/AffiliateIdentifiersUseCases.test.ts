import { describe, expect, it, vi } from 'vitest';
import { GetAffiliateIdentifiersUseCase } from './GetAffiliateIdentifiersUseCase';
import { SetLinkedAffiliateIdentifiersUseCase } from './SetLinkedAffiliateIdentifiersUseCase';
import type { IAffiliateCredentialRepository } from '../../domain/contracts/IAffiliateCredentialRepository';
import type { AffiliateCredentialRecord } from '../../domain/contracts/AffiliateCredentialRecords';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';

const T = 't1';
const NOW = new Date('2026-11-11T12:00:00.000Z');

function record(over: Partial<AffiliateCredentialRecord> = {}): AffiliateCredentialRecord {
  return {
    id: 'c1', tenantId: T, provider: 'MERCADO_LIVRE', publicIdentifier: 'loja', hasSecret: false, hasSession: true,
    sessionSyncedAt: NOW, sessionInvalidAt: null, sessionAccountHash: null, sessionAccountKeyVersion: null,
    status: 'ACTIVE', lastValidatedAt: null, rejectedAt: null, rejectedCode: null,
    accountIdentifiers: ['loja', 'Promo', 'cupom'], linkedIdentifiers: ['Promo', 'cupom'],
    createdAt: NOW, updatedAt: NOW, secret: null, session: null, ...over,
  };
}

function deps(existing: AffiliateCredentialRecord | null, limit: number | null) {
  const repo = {
    listByTenant: vi.fn(),
    findByTenantAndProvider: vi.fn().mockResolvedValue(existing),
    findActiveByTenantAndProvider: vi.fn(),
    upsert: vi.fn(),
    upsertSession: vi.fn(),
    delete: vi.fn(),
    clearSession: vi.fn(),
    markRejected: vi.fn(),
    setStatus: vi.fn(),
    setIdentifiers: vi.fn().mockImplementation(async (_t, _p, primary: string, linked: string[]) =>
      existing && { ...existing, publicIdentifier: primary, linkedIdentifiers: linked }),
  } satisfies IAffiliateCredentialRepository;
  const entitlements = { getNumber: vi.fn().mockResolvedValue(limit), getBoolean: vi.fn() };
  const audit = { create: vi.fn().mockResolvedValue(undefined) } satisfies IAuditLogRepository;
  return { repo, entitlements, audit };
}

const errorOf = (p: Promise<unknown>) => p.catch((e: unknown) => e);

describe('GetAffiliateIdentifiersUseCase', () => {
  it('lista da conta, gravadas e uso efetivo sob o limite (rebaixado: corta sem apagar)', async () => {
    const d = deps(record(), 2);
    const out = await new GetAffiliateIdentifiersUseCase(d.repo, d.entitlements).execute({ tenantId: T, provider: 'MERCADO_LIVRE' });
    expect(out).toEqual({ account: ['loja', 'Promo', 'cupom'], primary: 'loja', linked: ['Promo', 'cupom'], limit: 2, used: 2 });
    expect(d.repo.findByTenantAndProvider).toHaveBeenCalledWith(T, 'MERCADO_LIVRE');
    expect(d.entitlements.getNumber).toHaveBeenCalledWith(T, 'mercado_livre_affiliate_tags');
  });

  it('sem credencial: estado vazio; sem entitlement vale 1', async () => {
    const d = deps(null, null);
    const out = await new GetAffiliateIdentifiersUseCase(d.repo, d.entitlements).execute({ tenantId: T, provider: 'MERCADO_LIVRE' });
    expect(out).toEqual({ account: [], primary: null, linked: [], limit: 1, used: 0 });
  });

  it('provider sem lista da conta → 422', async () => {
    const d = deps(record(), 2);
    const err = await errorOf(new GetAffiliateIdentifiersUseCase(d.repo, d.entitlements).execute({ tenantId: T, provider: 'SHOPEE' }));
    expect(err).toMatchObject({ code: 'AFFILIATE_CREDENTIAL_INVALID', statusCode: 422, meta: { field: 'provider' } });
  });
});

describe('SetLinkedAffiliateIdentifiersUseCase', () => {
  const run = (d: ReturnType<typeof deps>, primary: string, linked: string[], provider: 'MERCADO_LIVRE' | 'SHEIN' = 'MERCADO_LIVRE') =>
    new SetLinkedAffiliateIdentifiersUseCase(d.repo, d.entitlements, d.audit).execute({ tenantId: T, userId: 'u1', provider, primary, linked });

  it('grava com a grafia da conta (sem caixa) e audita sem as etiquetas', async () => {
    const d = deps(record({ linkedIdentifiers: [] }), 10);
    const out = await run(d, ' PROMO ', ['LOJA']);
    expect(d.repo.setIdentifiers).toHaveBeenCalledWith(T, 'MERCADO_LIVRE', 'Promo', ['loja']);
    expect(out).toEqual({ account: ['loja', 'Promo', 'cupom'], primary: 'Promo', linked: ['loja'], limit: 10, used: 2 });
    expect(d.audit.create).toHaveBeenCalledWith({
      tenantId: T, userId: 'u1', action: 'AFFILIATE_CREDENTIAL_UPSERTED', meta: { provider: 'MERCADO_LIVRE', identifiersChanged: true },
    });
    expect(JSON.stringify(d.audit.create.mock.calls)).not.toMatch(/promo|loja/i);
  });

  it('acima do limite → PLAN_LIMIT_REACHED com chave e limite; nada gravado', async () => {
    const d = deps(record(), 2);
    const err = await errorOf(run(d, 'loja', ['Promo', 'cupom']));
    expect(err).toMatchObject({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'mercado_livre_affiliate_tags', limit: 2 } });
    expect(d.repo.setIdentifiers).not.toHaveBeenCalled();
  });

  it('sem entitlement (sem plano) vale 1: só a principal', async () => {
    const d = deps(record(), null);
    expect(await errorOf(run(d, 'loja', ['Promo']))).toMatchObject({ code: 'PLAN_LIMIT_REACHED', meta: { limit: 1 } });
    await expect(run(d, 'cupom', [])).resolves.toMatchObject({ primary: 'cupom', linked: [], used: 1 });
  });

  it('fora da conta → 422 apontando o campo; repetida (sem caixa) → 422', async () => {
    const d = deps(record(), 10);
    expect(await errorOf(run(d, 'outra', []))).toMatchObject({ code: 'AFFILIATE_CREDENTIAL_INVALID', meta: { field: 'primary' } });
    expect(await errorOf(run(d, 'loja', ['terceiro']))).toMatchObject({ code: 'AFFILIATE_CREDENTIAL_INVALID', meta: { field: 'linked' } });
    expect(await errorOf(run(d, 'loja', ['LOJA']))).toMatchObject({ code: 'AFFILIATE_CREDENTIAL_INVALID', meta: { field: 'linked' } });
    expect(d.repo.setIdentifiers).not.toHaveBeenCalled();
  });

  it('erro nunca carrega a etiqueta', async () => {
    const err = (await errorOf(run(deps(record(), 10), 'segredo123', []))) as Error;
    expect(JSON.stringify({ m: err.message, meta: (err as { meta?: unknown }).meta })).not.toContain('segredo123');
  });

  it('credencial inexistente → 404; provider sem lista (Shein) → 422', async () => {
    expect(await errorOf(run(deps(null, 10), 'loja', []))).toMatchObject({ code: 'AFFILIATE_CREDENTIAL_NOT_FOUND', statusCode: 404 });
    const d = deps(record({ provider: 'SHEIN' }), 10);
    expect(await errorOf(run(d, 'loja', [], 'SHEIN'))).toMatchObject({ code: 'AFFILIATE_CREDENTIAL_INVALID', statusCode: 422 });
    expect(d.repo.findByTenantAndProvider).not.toHaveBeenCalled();
  });

  it('sync trocou a lista entre leitura e escrita (CAS) → 422 de "fora da conta", sem auditoria', async () => {
    const d = deps(record(), 10);
    d.repo.setIdentifiers.mockResolvedValueOnce('ACCOUNT_CHANGED');
    expect(await errorOf(run(d, 'LOJA', ['promo']))).toMatchObject({ code: 'AFFILIATE_CREDENTIAL_INVALID', statusCode: 422, meta: { field: 'linked' } });
    // valores do CAS = grafia da conta (o `hasEvery` compara exato)
    expect(d.repo.setIdentifiers).toHaveBeenCalledWith(T, 'MERCADO_LIVRE', 'loja', ['Promo']);
    expect(d.audit.create).not.toHaveBeenCalled();
  });

  it('conta sem lista sincronizada: qualquer etiqueta é recusada', async () => {
    const d = deps(record({ accountIdentifiers: [] }), 10);
    expect(await errorOf(run(d, 'loja', []))).toMatchObject({ code: 'AFFILIATE_CREDENTIAL_INVALID' });
  });
});
