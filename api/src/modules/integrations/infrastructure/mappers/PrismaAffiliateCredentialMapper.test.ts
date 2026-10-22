import { describe, it, expect } from 'vitest';
import type { AffiliateCredential as PrismaAffiliateCredential } from '@prisma/client';
import { PrismaAffiliateCredentialMapper } from './PrismaAffiliateCredentialMapper';

const NOW = new Date('2026-10-22T12:00:00.000Z');

function row(overrides?: Partial<PrismaAffiliateCredential>): PrismaAffiliateCredential {
  return {
    id: 'c1', tenantId: 't1', provider: 'SHOPEE', publicIdentifier: '18301234567',
    secretCiphertext: Buffer.from('aa'), secretIv: Buffer.from('bb'), secretTag: Buffer.from('cc'),
    keyVersion: 1, status: 'ACTIVE',
    sessionCiphertext: null, sessionIv: null, sessionTag: null, sessionKeyVersion: null,
    sessionSyncedAt: null, lastValidatedAt: null, createdAt: NOW, updatedAt: NOW,
    ...overrides,
  };
}

describe('PrismaAffiliateCredentialMapper', () => {
  it('visão de domínio não carrega bytes cifrados, só as flags', () => {
    const d = PrismaAffiliateCredentialMapper.toDomain(row());

    expect(d).toMatchObject({ hasSecret: true, hasSession: false, publicIdentifier: '18301234567' });
    expect(Object.keys(d).some((k) => k.startsWith('secret') || k.startsWith('session') && k !== 'sessionSyncedAt')).toBe(false);
  });

  it('linha só com sessão (criada pela extensão): sem ID público, sem secret, com sessão', () => {
    const r = PrismaAffiliateCredentialMapper.toRecord(row({
      provider: 'MERCADO_LIVRE', publicIdentifier: null,
      secretCiphertext: null, secretIv: null, secretTag: null,
      sessionCiphertext: Buffer.from('s'), sessionIv: Buffer.from('i'), sessionTag: Buffer.from('t'),
      sessionKeyVersion: 1, sessionSyncedAt: NOW,
    }));

    expect(r).toMatchObject({ publicIdentifier: null, hasSecret: false, hasSession: true, secret: null });
    expect(r.session?.keyVersion).toBe(1);
  });

  it('blob incompleto conta como ausente', () => {
    expect(PrismaAffiliateCredentialMapper.toDomain(row({ secretTag: null })).hasSecret).toBe(false);
  });
});
