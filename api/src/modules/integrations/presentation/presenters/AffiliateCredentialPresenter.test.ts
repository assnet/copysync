import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { AffiliateCredentialPresenter } from './AffiliateCredentialPresenter';
import {
  affiliateCredentialItemSchema,
  affiliateCredentialListResponse,
} from '../schemas/affiliateCredential.schema';
import type { AffiliateCredential } from '../../domain/entities/AffiliateCredential';

const NOW = new Date('2026-10-22T12:00:00.000Z');

function credential(overrides?: Partial<AffiliateCredential>): AffiliateCredential {
  return {
    id: 'c1', tenantId: 't1', provider: 'SHOPEE', publicIdentifier: '18301234567',
    hasSecret: true, hasSession: false, sessionSyncedAt: null,
    sessionInvalidAt: null, sessionAccountHash: null, sessionAccountKeyVersion: null,
    status: 'ACTIVE', lastValidatedAt: null, rejectedAt: null, rejectedCode: null, createdAt: NOW, updatedAt: NOW, ...overrides,
  };
}

describe('AffiliateCredentialPresenter', () => {
  it('saída mascarada, sem campo secreto nem de sessão', () => {
    const item = AffiliateCredentialPresenter.toItem(credential());

    expect(item.publicIdentifierMasked).toBe('••••4567');
    expect(Object.keys(item).filter((k) => /^(secret|session)(?!SyncedAt)/.test(k))).toEqual([]);
    expect(item).not.toHaveProperty('tenantId');
  });

  it('linha só com sessão: ID público e máscara null', () => {
    const item = AffiliateCredentialPresenter.toItem(credential({
      provider: 'MERCADO_LIVRE', publicIdentifier: null, hasSecret: false, hasSession: true, sessionSyncedAt: NOW,
    }));
    expect(item).toMatchObject({ publicIdentifier: null, publicIdentifierMasked: null, hasSession: true, sessionSyncedAt: NOW.toISOString() });
  });

  it('GET serializa publicIdentifier null pelo schema de resposta, sem descartar campos', async () => {
    const app = Fastify();
    app.addSchema(affiliateCredentialItemSchema);
    const leaky = { ...credential({ publicIdentifier: null }), secretCiphertext: 'x' };
    app.get('/', { schema: { response: { 200: affiliateCredentialListResponse } } }, async () => ({
      success: true,
      data: { items: [{ ...AffiliateCredentialPresenter.toItem(leaky), secretCiphertext: 'vazou' }] },
    }));

    const res = await app.inject({ method: 'GET', url: '/' });
    const body = res.json();
    expect(body.data.items[0]).toMatchObject({ publicIdentifier: null, publicIdentifierMasked: null, hasSecret: true });
    expect(res.body).not.toContain('vazou');
    await app.close();
  });
});
