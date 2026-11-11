import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { errorHandler } from '../../../../shared/http/errorHandler';
import { AesGcmSecretCipher } from '../../../../shared/security/AesGcmSecretCipher';
import { SecretCipherFactory } from '../../../../shared/security/SecretCipherFactory';
import { PrismaAuditLogRepository } from '../../../../shared/audit/PrismaAuditLogRepository';
import { AffiliateCredentialRejectedError } from '../../../../shared/errors/internal/OfferErrors';
import { PrismaEntitlementReader } from '../../../tenants/infrastructure/repositories/PrismaEntitlementReader';
import { PrismaAffiliateCredentialRepository } from '../../../integrations/infrastructure/repositories/PrismaAffiliateCredentialRepository';
import type { AffiliateCredentialRecord, UpsertAffiliateSessionRecord } from '../../../integrations/domain/contracts/AffiliateCredentialRecords';
import { MercadoLivreAffiliateClient } from '../../../campaigns/infrastructure/http/MercadoLivreAffiliateClient';
import type { MlAccountTags } from '../../../campaigns/domain/contracts/IMercadoLivreAffiliateClient';
import { PrismaExtensionSessionRepository } from '../../infrastructure/repositories/PrismaExtensionSessionRepository';
import type { ExtensionSession } from '../../domain/entities/ExtensionSession';
import { extensionRoutes } from './extension.routes';

/* Fastify real com os hooks reais da extensão; repositórios e cliente do ML espionados no protótipo. */
vi.mock('../../../../shared/database/prisma.client', () => ({ prisma: {} }));

const INSTALL = 'e3814c80-a096-4fe5-8039-0612dfaeb2af';
const HEADERS = { 'x-client': 'extension', 'x-installation-id': INSTALL, cookie: 'ext_session=raw-token' };
const cipher = new AesGcmSecretCipher(new Map([[1, Buffer.alloc(32, 7)]]), 1);

let app: FastifyInstance;
let calls: UpsertAffiliateSessionRecord[];
let account: MlAccountTags | Error;

function extSession(): ExtensionSession {
  const soon = new Date(Date.now() + 24 * 3600_000);
  return {
    id: 's1', tokenHash: 'h', prevTokenHash: null, prevValidUntil: null, userId: 'u1', installationId: INSTALL,
    mlTenantId: 't1', extVersion: '3.4.0', mlConsentAt: new Date(), sheinConsentAt: null, lastSeenAt: new Date(),
    expiresAt: soon, absoluteExpiresAt: soon, revokedAt: null, createdAt: new Date(), updatedAt: new Date(),
  };
}

function credentialFrom(i: UpsertAffiliateSessionRecord): AffiliateCredentialRecord {
  const now = new Date();
  return {
    id: 'c1', tenantId: i.tenantId, provider: i.provider, publicIdentifier: i.publicIdentifierIfEmpty ?? null,
    hasSecret: false, hasSession: true, sessionSyncedAt: i.syncedAt, sessionInvalidAt: null, sessionAccountHash: null,
    sessionAccountKeyVersion: null, status: 'ACTIVE', lastValidatedAt: null, rejectedAt: i.rejectWith?.at ?? null,
    rejectedCode: i.rejectWith?.code ?? null, createdAt: now, updatedAt: now, secret: null, session: i.session,
  };
}

beforeEach(async () => {
  calls = [];
  account = { tags: ['loja_a', 'loja_b'], active: 'loja_b' };
  vi.spyOn(SecretCipherFactory, 'get').mockReturnValue(cipher);
  vi.spyOn(PrismaAuditLogRepository.prototype, 'create').mockResolvedValue(undefined);
  vi.spyOn(PrismaExtensionSessionRepository.prototype, 'findByTokenHash').mockResolvedValue(extSession());
  vi.spyOn(PrismaEntitlementReader.prototype, 'getBoolean').mockResolvedValue(true);
  vi.spyOn(PrismaAffiliateCredentialRepository.prototype, 'findByTenantAndProvider').mockResolvedValue(null);
  vi.spyOn(PrismaAffiliateCredentialRepository.prototype, 'upsertSession').mockImplementation(async (i) => {
    calls.push(i);
    return credentialFrom(i);
  });
  vi.spyOn(MercadoLivreAffiliateClient.prototype, 'listAccountTags').mockImplementation(async () => {
    if (account instanceof Error) throw account;
    return account;
  });

  app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(extensionRoutes, { prefix: '/api/extension' });
  await app.ready();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

const sync = () =>
  app.inject({
    method: 'PUT', url: '/api/extension/marketplaces/ml/session', headers: HEADERS,
    payload: { cookies: { ssid: 'ssid-abc' }, capturedAt: '2026-11-10T12:00:00.000Z' },
  });

describe('PUT /marketplaces/ml/session — etiquetas da conta', () => {
  it('ativa vira affiliateTag e a lista vai ao repositório; resposta inalterada', async () => {
    const res = await sync();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: { affiliateTag: 'loja_b', sessionRejected: false } });
    expect(calls[0]).toMatchObject({ publicIdentifierIfEmpty: 'loja_b', accountIdentifiers: ['loja_a', 'loja_b'], clearRejection: true });
  });

  it('tags null (leitura falhou) → sessão grava sem tocar na lista', async () => {
    account = { tags: null, active: null };
    const res = await sync();
    expect(res.json()).toEqual({ success: true, data: { affiliateTag: null, sessionRejected: false } });
    expect(calls[0]).not.toHaveProperty('accountIdentifiers');
  });

  it('loja recusa a sessão → REJECTED, sem lista', async () => {
    account = new AffiliateCredentialRejectedError('MERCADO_LIVRE');
    const res = await sync();
    expect(res.json()).toEqual({ success: true, data: { affiliateTag: null, sessionRejected: true } });
    expect(calls[0]).not.toHaveProperty('accountIdentifiers');
    expect(calls[0]!.rejectWith).toBeDefined();
  });

  it('loja fora do ar → sem sessionCheck, sem lista', async () => {
    account = new Error('network');
    const res = await sync();
    expect(res.statusCode).toBe(200);
    expect(calls[0]).not.toHaveProperty('accountIdentifiers');
    expect(calls[0]!.rejectWith).toBeUndefined();
  });
});
