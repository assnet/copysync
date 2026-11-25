import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import sharp from 'sharp';
import type { OfferWatermark } from '../../domain/entities/OfferWatermark';
import type { OfferWatermarkPatch } from '../../domain/contracts/IOfferWatermarkRepository';
import type { BeginConsumeResult } from '../../../media/domain/contracts/IUploadSessionStore';

/*
 * Contrato HTTP com Fastify de verdade e use cases reais (processador sharp de verdade); só banco, storage,
 * upload, audiência e plano são falsos. Usuário pelo header: `x-role`, `x-super`; plano e flag pelo estado.
 */
const s = vi.hoisted(() => ({
  plan: true as boolean | null,
  superAdminOnly: false,
  record: null as unknown,
  files: new Map<string, Buffer>(),
  uploads: new Map<string, Buffer>(),
  seq: 0,
}));

vi.mock('../../../../shared/database/prisma.client', () => ({ prisma: {} }));
vi.mock('../../../../shared/http/hooks/authHook', async () => {
  const { UnauthorizedError } = await import('../../../../shared/errors/internal/AuthErrors');
  return {
    authHook: async (request: { headers: Record<string, unknown>; user?: unknown }) => {
      if (!request.headers.authorization) throw new UnauthorizedError();
      request.user = { userId: 'user-a', isSuperAdmin: request.headers['x-super'] === '1' };
    },
  };
});
vi.mock('../../../../shared/http/hooks/tenantHook', () => ({
  tenantHook: async (request: { headers: Record<string, unknown>; tenantContext?: unknown }) => {
    request.tenantContext = {
      userId: 'user-a', tenantId: 'tenant-a', role: (request.headers['x-role'] as string) ?? 'ADMIN', isSuperAdmin: request.headers['x-super'] === '1',
    };
  },
}));
vi.mock('../../../../shared/http/hooks/resolveMembership', async () => {
  const { ForbiddenError } = await import('../../../../shared/errors/internal/AuthErrors');
  return {
    resolveMembership: async (userId: string, tenantId: string) => {
      if (tenantId !== 'tenant-a') throw new ForbiddenError();
      return { userId, tenantId, role: 'ADMIN', isSuperAdmin: false };
    },
  };
});
vi.mock('../../infrastructure/offersContainer', async () => {
  const { FeatureAudienceGate } = await import('../../../tenants/application/services/FeatureAudienceGate');
  const { SharpOfferWatermarkLogoProcessor } = await import('../../infrastructure/adapters/SharpOfferWatermarkLogoProcessor');
  const { GetOfferWatermarkUseCase } = await import('../../application/use-cases/GetOfferWatermarkUseCase');
  const { UpdateOfferWatermarkSettingsUseCase } = await import('../../application/use-cases/UpdateOfferWatermarkSettingsUseCase');
  const { SetOfferWatermarkImageUseCase } = await import('../../application/use-cases/SetOfferWatermarkImageUseCase');
  const { RemoveOfferWatermarkImageUseCase } = await import('../../application/use-cases/RemoveOfferWatermarkImageUseCase');
  const T0 = new Date('2026-11-25T12:00:00.000Z');
  const entitlements = { getBoolean: async () => s.plan };
  const deps = {
    entitlements,
    watermarks: {
      findByTenant: async () => s.record as OfferWatermark | null,
      save: async (_t: string, patch: OfferWatermarkPatch) => {
        const prev = (s.record as OfferWatermark | null) ?? {
          id: 'w1', tenantId: 'tenant-a', kind: 'IMAGE', imageKey: null, text: null, enabled: false,
          position: 'BOTTOM_RIGHT', size: 'MEDIUM', opacity: 80, createdAt: T0, updatedAt: T0,
        };
        s.record = { ...prev, ...patch };
        return s.record as OfferWatermark;
      },
    },
    logos: {
      read: async (k: string) => s.files.get(k) ?? null,
      save: async (png: Buffer) => {
        const key = `offer-watermark-00000000-0000-4000-8000-${String(++s.seq).padStart(12, '0')}.png`;
        s.files.set(key, png);
        return key;
      },
      remove: async (k: string) => s.files.delete(k),
      publicUrl: (k: string) => `/api/storage/media/${k}`,
    },
    processor: new SharpOfferWatermarkLogoProcessor(),
    uploads: {
      beginConsume: async (id: string) =>
        (s.uploads.has(id) ? { outcome: 'started', record: { sizeBytes: s.uploads.get(id)!.length } } : { outcome: 'not_found' }) as BeginConsumeResult,
      releaseConsume: async () => null,
      discard: async (id: string) => { s.uploads.delete(id); },
      binPath: (id: string) => id,
    },
    readFile: async (id: string) => s.uploads.get(id)!,
  };
  const gate = new FeatureAudienceGate({ superAdminOnly: async () => s.superAdminOnly });
  return {
    offersContainer: {
      entitlements: () => entitlements,
      offerWatermarkAudience: () => gate,
      getOfferWatermark: () => new GetOfferWatermarkUseCase(deps),
      updateOfferWatermarkSettings: () => new UpdateOfferWatermarkSettingsUseCase(deps),
      setOfferWatermarkImage: () => new SetOfferWatermarkImageUseCase(deps),
      removeOfferWatermarkImage: () => new RemoveOfferWatermarkImageUseCase(deps),
    },
  };
});

import { offerWatermarkRoutes } from './offerWatermark.routes';
import { errorHandler } from '../../../../shared/http/errorHandler';

const PREFIX = '/api/offer-watermark';
const AUTH = { authorization: 'Bearer x', 'x-tenant-id': 'tenant-a' };
const OPERATOR = { ...AUTH, 'x-role': 'OPERATOR' };
const SUPER = { ...AUTH, 'x-super': '1' };

const rgba = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 10, g: 120, b: 200, alpha: 0.6 } } });
const rgb = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 120, b: 200 } } });

let uploadSeq = 0;
function upload(buf: Buffer): string {
  const id = `22222222-2222-4222-8222-${String(++uploadSeq).padStart(12, '0')}`;
  s.uploads.set(id, buf);
  return id;
}

let app: FastifyInstance;

beforeEach(async () => {
  s.plan = true;
  s.superAdminOnly = false;
  s.record = null;
  s.files.clear();
  s.uploads.clear();
  app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(offerWatermarkRoutes, { prefix: PREFIX });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

const putImage = (buf: Buffer, headers: Record<string, string> = AUTH) =>
  app.inject({ method: 'PUT', url: `${PREFIX}/image`, headers, payload: { uploadId: upload(buf) } });

describe('PUT /offer-watermark/image', () => {
  it('PNG grande: grava PNG ≤ 512 px e responde a URL, sem chave de storage', async () => {
    const res = await putImage(await rgba(1600, 800).png().toBuffer());
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.imageUrl).toMatch(/^\/api\/storage\/media\/offer-watermark-.+\.png$/);
    expect(data).not.toHaveProperty('imageKey');
    expect(res.body).not.toContain('imageKey');
    const [stored] = [...s.files.values()];
    const meta = await sharp(stored).metadata();
    expect(meta).toMatchObject({ format: 'png', hasAlpha: true, width: 512, height: 256 });
  });

  it.each([
    ['JPEG sem alfa', () => rgb(300, 300).jpeg().toBuffer(), 415, 'UNSUPPORTED_MEDIA_TYPE'],
    ['mime falso (texto enviado como .png)', async () => Buffer.from('não sou png'), 415, 'UNSUPPORTED_MEDIA_TYPE'],
    ['> 1 MiB', async () => Buffer.alloc(1024 * 1024 + 1, 1), 413, 'MEDIA_TOO_LARGE'],
    ['< 100×100', () => rgba(80, 80).png().toBuffer(), 422, 'MEDIA_PROCESSING_FAILED'],
  ])('%s → %i %s, nada gravado', async (_n, make, status, code) => {
    const res = await putImage(await make());
    expect(res.statusCode).toBe(status);
    expect(res.json().error).toMatchObject({ code });
    expect(s.files.size).toBe(0);
  });

  it('trocar o logo apaga o anterior do storage', async () => {
    await putImage(await rgba(300, 300).png().toBuffer());
    const [first] = [...s.files.keys()];
    const res = await putImage(await rgba(200, 200).webp().toBuffer());
    expect(res.statusCode).toBe(200);
    expect(s.files.has(first)).toBe(false);
    expect(s.files.size).toBe(1);
  });

  it('operador não grava (403 FORBIDDEN)', async () => {
    const res = await putImage(await rgba(300, 300).png().toBuffer(), OPERATOR);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
    expect(s.files.size).toBe(0);
  });

  it('body sem uploadId válido → 400', async () => {
    const res = await app.inject({ method: 'PUT', url: `${PREFIX}/image`, headers: AUTH, payload: { uploadId: 'x' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('DELETE /offer-watermark/image', () => {
  it('remove: apaga do storage e zera o logo', async () => {
    await putImage(await rgba(300, 300).png().toBuffer());
    const res = await app.inject({ method: 'DELETE', url: `${PREFIX}/image`, headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.imageUrl).toBeNull();
    expect(s.files.size).toBe(0);
  });

  it('operador → 403', async () => {
    const res = await app.inject({ method: 'DELETE', url: `${PREFIX}/image`, headers: OPERATOR });
    expect(res.statusCode).toBe(403);
  });
});

describe('PUT /offer-watermark', () => {
  it('salva ajustes e devolve a marca', async () => {
    const res = await app.inject({ method: 'PUT', url: PREFIX, headers: AUTH, payload: { enabled: true, kind: 'TEXT', text: 'Loja da Ana', position: 'CENTER', size: 'LARGE', opacity: 55 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ enabled: true, kind: 'TEXT', text: 'Loja da Ana', position: 'CENTER', size: 'LARGE', opacity: 55, canEdit: true });
  });

  it.each([
    [{ text: 'x'.repeat(33) }, 'text'],
    [{ text: 'linha\noutra' }, 'text'],
    [{ opacity: 5 }, 'opacity'],
    [{ opacity: 150 }, 'opacity'],
  ])('%o → 422 com field %s', async (payload, field) => {
    const res = await app.inject({ method: 'PUT', url: PREFIX, headers: AUTH, payload });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: 'OFFER_WATERMARK_INVALID_INPUT', meta: { field } });
  });

  it('operador → 403 FORBIDDEN', async () => {
    const res = await app.inject({ method: 'PUT', url: PREFIX, headers: OPERATOR, payload: { enabled: true } });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /offer-watermark', () => {
  it('operador lê (canEdit false)', async () => {
    const res = await app.inject({ method: 'GET', url: PREFIX, headers: OPERATOR });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ enabled: false, kind: 'IMAGE', imageUrl: null, canEdit: false, updatedAt: null });
  });

  it('sem auth → 401', async () => {
    expect((await app.inject({ method: 'GET', url: PREFIX })).statusCode).toBe(401);
  });
});

describe('audiência e plano', () => {
  const routes = [
    ['GET', ''], ['PUT', ''], ['PUT', '/image'], ['DELETE', '/image'],
  ] as const;

  it.each(routes)('flag "Só super admin" ligada + usuário comum: %s %s → 404 NOT_FOUND', async (method, path) => {
    s.superAdminOnly = true;
    const payload = path === '/image' && method === 'PUT' ? { uploadId: upload(Buffer.from('x')) } : method === 'PUT' ? {} : undefined;
    const res = await app.inject({ method, url: `${PREFIX}${path}`, headers: AUTH, payload });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('flag ligada: super admin passa', async () => {
    s.superAdminOnly = true;
    expect((await app.inject({ method: 'GET', url: PREFIX, headers: SUPER })).statusCode).toBe(200);
  });

  it.each(routes)('flag desligada + plano sem a chave (PRO): %s %s → 403 PLAN_FEATURE_UNAVAILABLE', async (method, path) => {
    s.plan = false;
    const payload = path === '/image' && method === 'PUT' ? { uploadId: upload(Buffer.from('x')) } : method === 'PUT' ? {} : undefined;
    const res = await app.inject({ method, url: `${PREFIX}${path}`, headers: AUTH, payload });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatchObject({ code: 'PLAN_FEATURE_UNAVAILABLE', meta: { key: 'offer_watermark_enabled' } });
  });
});

describe('GET /offer-watermark/access (nunca 403)', () => {
  const access = (headers: Record<string, string>) => app.inject({ method: 'GET', url: `${PREFIX}/access`, headers });

  it.each([
    ['flag desligada + plano', () => {}, AUTH, true],
    ['flag desligada + sem plano (PRO): visível, a página mostra o selo', () => { s.plan = false; }, AUTH, true],
    ['flag ligada + usuário comum', () => { s.superAdminOnly = true; }, AUTH, false],
    ['flag ligada + super admin com plano', () => { s.superAdminOnly = true; }, SUPER, true],
    ['flag ligada + super admin sem plano', () => { s.superAdminOnly = true; s.plan = false; }, SUPER, true],
    ['sem X-Tenant-Id (plano não entra)', () => {}, { authorization: 'Bearer x' }, true],
  ] as const)('%s → visible %s', async (_n, arrange, headers, visible) => {
    arrange();
    const res = await access(headers as Record<string, string>);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ visible });
  });

  it('PRO com flag desligada: /access visível e GET / 403 PLAN_FEATURE_UNAVAILABLE (selo na página)', async () => {
    s.plan = false;
    expect((await access(AUTH)).json().data).toEqual({ visible: true });
    const res = await app.inject({ method: 'GET', url: PREFIX, headers: AUTH });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('PLAN_FEATURE_UNAVAILABLE');
  });
});
