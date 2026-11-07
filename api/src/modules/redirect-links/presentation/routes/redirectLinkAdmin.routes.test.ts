import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { errorHandler } from '../../../../shared/http/errorHandler';
import { PrismaRedirectLinkRepository } from '../../infrastructure/repositories/PrismaRedirectLinkRepository';
import type { RedirectLink } from '../../domain/entities/RedirectLink';
import { redirectLinkAdminRoutes } from './redirectLinkAdmin.routes';

/* Contrato HTTP sem banco: Prisma vazio, auth falsa, repositório espionado no protótipo. */
const auth = vi.hoisted(() => ({ isSuperAdmin: false, role: 'ADMIN' }));
vi.mock('../../../../shared/database/prisma.client', () => ({ prisma: {} }));
vi.mock('../../../../shared/http/hooks/authHook', () => ({
  authHook: async (request: { user?: unknown }) => {
    request.user = { userId: 'user-a', tenantId: 't-1', role: auth.role, isSuperAdmin: auth.isSuperAdmin };
  },
}));

const URL = '/api/admin/redirect-links';
const at = new Date('2026-11-07T12:00:00.000Z');
const row = (over: Partial<RedirectLink> = {}): RedirectLink => ({
  id: 'r1', slug: 'suporte', urlA: 'https://wa.me/55', urlB: null, percentA: 100, isActive: true,
  hitsA: 7, hitsB: 3, note: null, createdAt: at, updatedAt: at, ...over,
});
const repo = PrismaRedirectLinkRepository.prototype;
let app: FastifyInstance;

beforeEach(async () => {
  auth.isSuperAdmin = false;
  app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(redirectLinkAdminRoutes, { prefix: URL });
  await app.ready();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

describe('guard de super-admin', () => {
  it.each([
    ['GET', URL],
    ['POST', URL],
    ['PATCH', `${URL}/r1`],
    ['DELETE', `${URL}/r1`],
  ] as const)('ADMIN de tenant em %s %s = 401 sem tocar o banco', async (method, url) => {
    const spies = [vi.spyOn(repo, 'list'), vi.spyOn(repo, 'create'), vi.spyOn(repo, 'update'), vi.spyOn(repo, 'delete')];
    const res = await app.inject({ method, url, payload: method === 'GET' || method === 'DELETE' ? undefined : { slug: 'x', urlA: 'https://a.com' } });
    // superAdminHook do projeto responde 401 UNAUTHORIZED (mesmo das outras rotas /admin).
    expect(res.statusCode).toBe(401);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});

describe('CRUD (super-admin)', () => {
  beforeEach(() => { auth.isSuperAdmin = true; });

  it('GET lista com hitsTotal', async () => {
    vi.spyOn(repo, 'list').mockResolvedValue([row()]);
    const res = await app.inject({ method: 'GET', url: URL });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.items[0]).toEqual({
      id: 'r1', slug: 'suporte', urlA: 'https://wa.me/55', urlB: null, percentA: 100, isActive: true,
      hitsA: 7, hitsB: 3, hitsTotal: 10, note: null, createdAt: at.toISOString(), updatedAt: at.toISOString(),
    });
  });

  it('POST cria (201) com dados normalizados', async () => {
    vi.spyOn(repo, 'findBySlug').mockResolvedValue(null);
    const create = vi.spyOn(repo, 'create').mockImplementation(async (d) => row({ ...d, id: 'r2', hitsA: 0, hitsB: 0 }));
    const res = await app.inject({ method: 'POST', url: URL, payload: { slug: 'Loja', urlA: 'https://a.com', urlB: 'https://b.com', percentA: 70 } });
    expect(res.statusCode).toBe(201);
    expect(create).toHaveBeenCalledWith({ slug: 'loja', urlA: 'https://a.com/', urlB: 'https://b.com/', percentA: 70, isActive: true, note: null });
  });

  it('POST com destino http = 400 REDIRECT_LINK_INVALID com campo', async () => {
    const res = await app.inject({ method: 'POST', url: URL, payload: { slug: 'x', urlA: 'http://a.com' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'REDIRECT_LINK_INVALID', meta: { field: 'urlA', reason: 'NOT_HTTPS' } });
  });

  it('POST com campo desconhecido ou percentual fora = 400 do schema', async () => {
    expect((await app.inject({ method: 'POST', url: URL, payload: { slug: 'x', urlA: 'https://a.com', percentA: 101 } })).statusCode).toBe(400);
  });

  it('PATCH troca slug; DELETE 204; inexistente 404', async () => {
    vi.spyOn(repo, 'findById').mockImplementation(async (id) => (id === 'r1' ? row() : null));
    vi.spyOn(repo, 'findBySlug').mockResolvedValue(null);
    vi.spyOn(repo, 'update').mockImplementation(async (id, d) => row({ ...d, id }));
    const patch = await app.inject({ method: 'PATCH', url: `${URL}/r1`, payload: { slug: 'suporte-v2' } });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().data.slug).toBe('suporte-v2');
    expect((await app.inject({ method: 'PATCH', url: `${URL}/zz`, payload: { isActive: false } })).statusCode).toBe(404);
    vi.spyOn(repo, 'delete').mockResolvedValue();
    expect((await app.inject({ method: 'DELETE', url: `${URL}/r1` })).statusCode).toBe(204);
  });
});
