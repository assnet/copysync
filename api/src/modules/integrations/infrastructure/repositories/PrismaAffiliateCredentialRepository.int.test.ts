import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaAffiliateCredentialRepository } from './PrismaAffiliateCredentialRepository';

const repo = new PrismaAffiliateCredentialRepository();
const blob = (n: number) => ({ ciphertext: Buffer.from(`c${n}`), iv: Buffer.from('iv'), tag: Buffer.from('tg'), keyVersion: 1 });
const AT = new Date('2026-10-28T10:00:00.000Z');
let tenantId = '';

beforeAll(async () => {
  const t = await prisma.tenant.create({ data: { name: 'int', slug: `int-cred-${Date.now()}` } });
  tenantId = t.id;
});
afterAll(async () => {
  await prisma.affiliateCredential.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('PrismaAffiliateCredentialRepository — rejeição', () => {
  it('markRejected sem linha é no-op; com linha grava e é idempotente', async () => {
    await expect(repo.markRejected(tenantId, 'SHOPEE', 'X', AT)).resolves.toBeUndefined();
    expect(await repo.findByTenantAndProvider(tenantId, 'SHOPEE')).toBeNull();

    const created = await repo.upsert({ tenantId, provider: 'SHOPEE', publicIdentifier: '1234567', secret: blob(1) });
    expect(created).toMatchObject({ rejectedAt: null, rejectedCode: null });
    await repo.markRejected(tenantId, 'SHOPEE', 'AFFILIATE_CREDENTIAL_REJECTED', AT);
    await repo.markRejected(tenantId, 'SHOPEE', 'AFFILIATE_CREDENTIAL_REJECTED', AT);
    expect(await repo.findByTenantAndProvider(tenantId, 'SHOPEE')).toMatchObject({ rejectedAt: AT, rejectedCode: 'AFFILIATE_CREDENTIAL_REJECTED' });
  });

  it('setStatus mantém a rejeição; upsert só limpa com clearRejection true', async () => {
    expect(await repo.setStatus(tenantId, 'SHOPEE', 'INACTIVE')).toMatchObject({ status: 'INACTIVE', rejectedAt: AT });
    expect(await repo.upsert({ tenantId, provider: 'SHOPEE', publicIdentifier: '1234567', clearRejection: false })).toMatchObject({ rejectedAt: AT });
    expect(await repo.upsert({ tenantId, provider: 'SHOPEE', publicIdentifier: '1234567' })).toMatchObject({ rejectedAt: AT });
    expect(await repo.upsert({ tenantId, provider: 'SHOPEE', publicIdentifier: '7654321', secret: blob(2), clearRejection: true })).toMatchObject({ rejectedAt: null, rejectedCode: null, publicIdentifier: '7654321' });
  });

  it('upsertSession (ML): clearRejection false mantém, true limpa; clearSession zera', async () => {
    await repo.upsertSession({ tenantId, provider: 'MERCADO_LIVRE', session: blob(1), syncedAt: AT });
    await repo.markRejected(tenantId, 'MERCADO_LIVRE', 'AFFILIATE_CREDENTIAL_REJECTED', AT);
    expect(await repo.upsertSession({ tenantId, provider: 'MERCADO_LIVRE', session: blob(1), syncedAt: AT, clearRejection: false })).toMatchObject({ rejectedAt: AT });
    expect(await repo.upsertSession({ tenantId, provider: 'MERCADO_LIVRE', session: blob(2), syncedAt: AT, clearRejection: true })).toMatchObject({ rejectedAt: null, rejectedCode: null });
    await repo.markRejected(tenantId, 'MERCADO_LIVRE', 'AFFILIATE_CREDENTIAL_REJECTED', AT);
    expect(await repo.clearSession(tenantId, 'MERCADO_LIVRE')).toBe(true);
    expect(await repo.findByTenantAndProvider(tenantId, 'MERCADO_LIVRE')).toMatchObject({ hasSession: false, rejectedAt: null, rejectedCode: null });
  });
});

describe('PrismaAffiliateCredentialRepository — ID que segue a sessão (Shein)', () => {
  it('override grava no create e substitui no update; sem override o ID fica', async () => {
    const created = await repo.upsertSession({ tenantId, provider: 'SHEIN', session: blob(1), syncedAt: AT, publicIdentifierOverride: '4320454940' });
    expect(created).toMatchObject({ publicIdentifier: '4320454940', hasSession: true });
    const switched = await repo.upsertSession({ tenantId, provider: 'SHEIN', session: blob(2), syncedAt: AT, publicIdentifierOverride: '9876543210' });
    expect(switched.publicIdentifier).toBe('9876543210');
    const kept = await repo.upsertSession({ tenantId, provider: 'SHEIN', session: blob(3), syncedAt: AT });
    expect(kept.publicIdentifier).toBe('9876543210');
    expect(await repo.delete(tenantId, 'SHEIN')).toBe(true);
    expect(await repo.findByTenantAndProvider(tenantId, 'SHEIN')).toBeNull();
  });

  it('ML: publicIdentifierIfEmpty continua só preenchendo ID vazio', async () => {
    await repo.delete(tenantId, 'MERCADO_LIVRE');
    expect((await repo.upsertSession({ tenantId, provider: 'MERCADO_LIVRE', session: blob(1), syncedAt: AT, publicIdentifierIfEmpty: 'tag_a' })).publicIdentifier).toBe('tag_a');
    expect((await repo.upsertSession({ tenantId, provider: 'MERCADO_LIVRE', session: blob(2), syncedAt: AT, publicIdentifierIfEmpty: 'tag_b' })).publicIdentifier).toBe('tag_a');
  });
});
