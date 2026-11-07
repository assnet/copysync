import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { errorHandler } from '../../../../shared/http/errorHandler';
import type { ResolvedRedirect } from '../../application/use-cases/ResolveRedirectLinkUseCase';
import { registerPublicLinkRoutes } from '../../../link-rotation/presentation/routes/publicLink.routes';
import { makeDomain } from '../../../link-rotation/application/use-cases/linkRotationTestFakes';
import { publicRedirectRoutes } from './publicRedirect.routes';

vi.mock('../../../../shared/database/prisma.client', () => ({ prisma: {} }));

const URL = '/api/public/redirects';
let app: FastifyInstance;
let next: ResolvedRedirect | null;
let resolver: { execute: ReturnType<typeof vi.fn<(slug: string) => Promise<ResolvedRedirect | null>>> };
let linkResolver: { execute: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  next = { url: 'https://chromewebstore.google.com/detail/x', side: 'A' };
  resolver = { execute: vi.fn(async () => next) };
  linkResolver = { execute: vi.fn(async () => ({ kind: 'not_found' })) };
  app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(rateLimit, { max: 1000, timeWindow: '1 minute', keyGenerator: (r) => r.ip });
  // Hook por Host do Gestor de Links com o domínio-pai da plataforma cadastrado (pior caso).
  registerPublicLinkRoutes(app, {
    domains: { get: async () => [makeDomain({ hostname: 'copysync.app' })] },
    resolver: linkResolver as never,
    probeSecret: null,
  });
  await app.register(publicRedirectRoutes, { prefix: URL, resolver });
  await app.ready();
});

afterEach(async () => { await app.close(); });

const get = (url: string, host = 'api.copysync.app') => app.inject({ method: 'GET', url, headers: { host } });

describe('GET /public/redirects/:slug', () => {
  it('200 { url } no envelope, sem cache e sem indexação', async () => {
    const res = await get(`${URL}/chrome-web-store-v5.235.2`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: { url: 'https://chromewebstore.google.com/detail/x' } });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(resolver.execute).toHaveBeenCalledWith('chrome-web-store-v5.235.2');
  });

  it('inexistente/inativo = 404 sem detalhe', async () => {
    next = null;
    const res = await get(`${URL}/sumiu`);
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatchObject({ code: 'REDIRECT_LINK_NOT_FOUND', message: 'Not found' });
    expect(res.body).not.toContain('sumiu');
  });

  it('slug acima de 100 caracteres = 404 (maxParamLength do Fastify), sem consultar', async () => {
    const res = await get(`${URL}/${'a'.repeat(101)}`);
    expect(res.statusCode).toBe(404);
    expect(resolver.execute).not.toHaveBeenCalled();
  });
});

describe('GET /public/redirects/:slug/go', () => {
  it('302 com Location', async () => {
    const res = await get(`${URL}/loja/go`);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://chromewebstore.google.com/detail/x');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('404 quando não resolve', async () => {
    next = null;
    expect((await get(`${URL}/x/go`)).statusCode).toBe(404);
  });
});

describe('convivência com o hook público por Host (Gestor de Links)', () => {
  it.each(['api.copysync.app', 'app.copysync.app'])('host da plataforma %s passa direto', async (host) => {
    const res = await get(`${URL}/loja`, host);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.url).toBe('https://chromewebstore.google.com/detail/x');
    expect(linkResolver.execute).not.toHaveBeenCalled();
  });

  it('subdomínio de link (não plataforma) não alcança a rota', async () => {
    const res = await get(`${URL}/loja`, 'promo.copysync.app');
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('text/html');
    expect(resolver.execute).not.toHaveBeenCalled();
  });
});
