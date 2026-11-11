import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaAffiliateCredentialRepository } from './PrismaAffiliateCredentialRepository';
import { PrismaTenantUsageReader } from '../../../tenants/infrastructure/repositories/PrismaTenantUsageReader';

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

describe('PrismaAffiliateCredentialRepository — etiquetas da conta (ML)', () => {
  const ML = 'MERCADO_LIVRE' as const;
  const setLinked = (linked: string[]) =>
    prisma.affiliateCredential.update({ where: { tenantId_provider: { tenantId, provider: ML } }, data: { linkedIdentifiers: linked } });

  it('lista na criação; sem lista ou [] não toca nas colunas', async () => {
    await repo.delete(tenantId, ML);
    const created = await repo.upsertSession({ tenantId, provider: ML, session: blob(1), syncedAt: AT, publicIdentifierIfEmpty: 'tag_a', accountIdentifiers: ['tag_a', 'tag_b'] });
    expect(created).toMatchObject({ publicIdentifier: 'tag_a', accountIdentifiers: ['tag_a', 'tag_b'], linkedIdentifiers: [] });
    await setLinked(['tag_b']);
    expect(await repo.upsertSession({ tenantId, provider: ML, session: blob(2), syncedAt: AT })).toMatchObject({ accountIdentifiers: ['tag_a', 'tag_b'], linkedIdentifiers: ['tag_b'] });
    expect(await repo.upsertSession({ tenantId, provider: ML, session: blob(3), syncedAt: AT, accountIdentifiers: [] })).toMatchObject({ accountIdentifiers: ['tag_a', 'tag_b'], linkedIdentifiers: ['tag_b'] });
  });

  it('lista nova substitui e poda vinculadas fora dela (sem caixa), mantendo a ordem; principal não muda', async () => {
    await setLinked(['tag_c', 'TAG_B', 'tag_d', 'tag_e']);
    const r = await repo.upsertSession({ tenantId, provider: ML, session: blob(4), syncedAt: AT, publicIdentifierIfEmpty: 'tag_x', accountIdentifiers: ['tag_b', 'tag_e', 'Tag_C'] });
    expect(r).toMatchObject({ publicIdentifier: 'tag_a', accountIdentifiers: ['tag_b', 'tag_e', 'Tag_C'], linkedIdentifiers: ['tag_c', 'TAG_B', 'tag_e'] });
    // troca de conta: nenhuma vinculada é da conta nova
    expect(await repo.upsertSession({ tenantId, provider: ML, session: blob(5), syncedAt: AT, accountIdentifiers: ['outra'] })).toMatchObject({ accountIdentifiers: ['outra'], linkedIdentifiers: [] });
  });

  it('clearSession zera as duas listas', async () => {
    await repo.upsertSession({ tenantId, provider: ML, session: blob(6), syncedAt: AT, accountIdentifiers: ['tag_a', 'tag_b'] });
    await setLinked(['tag_b']);
    expect(await repo.clearSession(tenantId, ML)).toBe(true);
    expect(await repo.findByTenantAndProvider(tenantId, ML)).toMatchObject({ hasSession: false, accountIdentifiers: [], linkedIdentifiers: [], publicIdentifier: 'tag_a' });
  });

  it('setIdentifiers grava principal e vinculadas sem tocar em sessão, recusa nem lista da conta', async () => {
    await repo.upsertSession({ tenantId, provider: ML, session: blob(7), syncedAt: AT, accountIdentifiers: ['tag_a', 'tag_b', 'tag_c'] });
    await repo.markRejected(tenantId, ML, 'SESSION_REJECTED', AT);
    const r = await repo.setIdentifiers(tenantId, ML, 'tag_c', ['tag_a', 'tag_b']);
    expect(r).toMatchObject({
      publicIdentifier: 'tag_c', linkedIdentifiers: ['tag_a', 'tag_b'], accountIdentifiers: ['tag_a', 'tag_b', 'tag_c'],
      hasSession: true, rejectedCode: 'SESSION_REJECTED',
    });
    expect((await repo.findByTenantAndProvider(tenantId, ML))?.session).not.toBeNull();
  });

  it('setIdentifiers é escopado por tenant: outro tenant ou linha inexistente → null', async () => {
    const other = await prisma.tenant.create({ data: { name: 'int2', slug: `int-cred2-${Date.now()}` } });
    try {
      expect(await repo.setIdentifiers(other.id, ML, 'tag_x', [])).toBeNull();
      expect((await repo.findByTenantAndProvider(tenantId, ML))?.publicIdentifier).toBe('tag_c');
    } finally {
      await prisma.tenant.delete({ where: { id: other.id } });
    }
  });

  it('uso na Assinatura: conjunto efetivo sob o limite (ausente = 1; com 2 = principal + 1)', async () => {
    const reader = new PrismaTenantUsageReader(prisma);
    expect((await reader.read(tenantId)).mercadoLivreAffiliateTags).toBe(1);
    await prisma.tenantEntitlement.create({ data: { tenantId, key: 'mercado_livre_affiliate_tags', value: 2 } });
    expect((await reader.read(tenantId)).mercadoLivreAffiliateTags).toBe(2);
    await repo.delete(tenantId, ML);
    expect((await reader.read(tenantId)).mercadoLivreAffiliateTags).toBe(0);
  });
});
