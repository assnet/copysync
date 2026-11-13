import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { storefrontRoutes } from './storefront.routes';
import { errorHandler } from '../../../../shared/http/errorHandler';
import { logger } from '../../../../shared/logger/logger';
import { DeleteStorefrontUseCase, type DeleteStorefrontDTO } from '../../application/use-cases/DeleteStorefrontUseCase';
import { GetStorefrontUseCase } from '../../application/use-cases/GetStorefrontUseCase';
import { makeStorefrontDeps, seedPageWithClaim, type StorefrontFakes } from '../../application/use-cases/storefrontTestFakes';
import { ConfirmUserPasswordUseCase } from '../../../auth/application/use-cases/ConfirmUserPasswordUseCase';
import { InMemoryPasswordConfirmationRepository } from '../../../auth/test/inMemoryPasswordConfirmation';
import type { User } from '../../../users/domain/entities/User';

/*
 * POST /storefront/delete de ponta a ponta sem banco: Fastify real, use case real com fakes em
 * memória e a confirmação de senha real (contador em memória). Papel e usuário vêm de headers de teste.
 */
vi.mock('../../../../shared/database/prisma.client', () => ({ prisma: {} }));
vi.mock('../../../../shared/http/hooks/authHook', async () => {
  const { UnauthorizedError } = await import('../../../../shared/errors/internal/AuthErrors');
  return {
    authHook: async (request: { headers: Record<string, unknown>; user?: unknown }) => {
      if (!request.headers.authorization) throw new UnauthorizedError();
      request.user = { userId: request.headers['x-test-user'] ?? 'user-1', isSuperAdmin: request.headers['x-test-role'] === 'SUPER_ADMIN' };
    },
  };
});
vi.mock('../../../../shared/http/hooks/tenantHook', () => ({
  tenantHook: async (request: { headers: Record<string, unknown>; tenantContext?: unknown }) => {
    const role = (request.headers['x-test-role'] as string | undefined) ?? 'ADMIN';
    request.tenantContext = {
      userId: (request.headers['x-test-user'] as string | undefined) ?? 'user-1',
      tenantId: 'tenant-1', role, isSuperAdmin: role === 'SUPER_ADMIN',
    };
  },
}));

const URL = '/api/storefront/delete';
const AUTH = { authorization: 'Bearer x' };
const ADMIN_PASSWORD = 'Senha-do-admin-1';
const ROOT_PASSWORD = 'Senha-do-root-9';
const PASSWORDS: Record<string, string> = { 'user-1': ADMIN_PASSWORD, 'root-1': ROOT_PASSWORD };

let app: FastifyInstance;
let fakes: StorefrontFakes;
let attempts: InMemoryPasswordConfirmationRepository;
let verify: ReturnType<typeof vi.fn>;
let logs: unknown[];
const bodies: string[] = [];

beforeEach(async () => {
  const made = makeStorefrontDeps();
  fakes = made.fakes;
  seedPageWithClaim(fakes, { avatarUrl: 'https://media.example/storefront-1.webp' });
  fakes.offers.seed();
  attempts = new InMemoryPasswordConfirmationRepository();
  verify = vi.fn(async (plain: string, hash: string | null) => hash !== null && plain === hash);
  const confirmPassword = new ConfirmUserPasswordUseCase({
    users: { findById: async (id) => (PASSWORDS[id] ? ({ id, passwordHash: PASSWORDS[id] } as User) : null) },
    attempts,
    verifyPassword: verify as never,
  });
  const real = new DeleteStorefrontUseCase({ ...made.deps, confirmPassword });
  const original = DeleteStorefrontUseCase.prototype.execute;
  vi.spyOn(DeleteStorefrontUseCase.prototype, 'execute').mockImplementation((input: DeleteStorefrontDTO) => original.call(real, input));
  logs = [];
  for (const level of ['info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(logger, level).mockImplementation(((...args: unknown[]) => { logs.push(args); }) as never);
  }
  bodies.length = 0;

  app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(rateLimit, { max: 1000, timeWindow: '1 minute', keyGenerator: (r) => r.ip });
  await app.register(storefrontRoutes, { prefix: '/api/storefront' });
  await app.ready();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

async function post(payload: unknown, headers: Record<string, string> = {}) {
  const res = await app.inject({ method: 'POST', url: URL, headers: { ...AUTH, ...headers }, payload: payload as object });
  bodies.push(res.body);
  return res;
}

describe('POST /storefront/delete', () => {
  it('sem auth responde 401 UNAUTHORIZED', async () => {
    const res = await app.inject({ method: 'POST', url: URL, payload: { password: ADMIN_PASSWORD } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('admin com a senha certa: 204 sem corpo; página, claim e imagem somem', async () => {
    const res = await post({ password: ADMIN_PASSWORD });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(fakes.storefronts.pages).toHaveLength(0);
    expect(fakes.slugs.storefronts).toHaveLength(0);
    expect(fakes.media.removed).toEqual(['https://media.example/storefront-1.webp']);
    expect(fakes.audit.entries).toMatchObject([{ action: 'STOREFRONT_DELETED', userId: 'user-1', meta: { offers: 1, bySuperAdmin: false } }]);
  });

  it('super admin: 204 com a própria senha (a do admin do tenant não serve)', async () => {
    const root = { 'x-test-role': 'SUPER_ADMIN', 'x-test-user': 'root-1' };
    expect((await post({ password: ADMIN_PASSWORD }, root)).statusCode).toBe(401);
    expect(fakes.storefronts.pages).toHaveLength(1);
    expect((await post({ password: ROOT_PASSWORD }, root)).statusCode).toBe(204);
    expect(fakes.audit.entries).toMatchObject([{ userId: 'root-1', meta: { bySuperAdmin: true } }]);
  });

  it('operador: 403 FORBIDDEN sem conferir senha', async () => {
    const res = await post({ password: ADMIN_PASSWORD }, { 'x-test-role': 'OPERATOR' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
    expect(verify).not.toHaveBeenCalled();
    expect(fakes.storefronts.pages).toHaveLength(1);
  });

  it('senha errada: 401 com error.code INVALID_CREDENTIALS no envelope padrão e nada é apagado', async () => {
    const res = await post({ password: 'errada' });
    expect(res.statusCode).toBe(401);
    // O painel distingue este 401 do de token vencido (UNAUTHORIZED/TOKEN_*) só pelo código.
    expect(res.json()).toEqual({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
    expect(fakes.storefronts.pages).toHaveLength(1);
  });

  it('cada POST conta exatamente 1 tentativa (o cliente não precisa nem deve repetir o pedido)', async () => {
    await post({ password: 'errada' });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(attempts.rows).toMatchObject([{ userId: 'user-1', success: false }]);
    await post({ password: 'errada' });
    expect(attempts.rows.filter((r) => !r.success)).toHaveLength(2);
    // a senha certa na sequência passa de primeira e não vira falha
    expect((await post({ password: ADMIN_PASSWORD })).statusCode).toBe(204);
    expect(verify).toHaveBeenCalledTimes(3);
    expect(attempts.rows.filter((r) => !r.success)).toHaveLength(2);
  });

  it('5 senhas erradas → a 6ª tentativa é 429 PASSWORD_CONFIRMATION_LOCKED, mesmo com a senha certa', async () => {
    for (let i = 0; i < 5; i++) expect((await post({ password: `errada-${i}` })).statusCode).toBe(401);
    const res = await post({ password: ADMIN_PASSWORD });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('PASSWORD_CONFIRMATION_LOCKED');
    expect(res.json().error.meta.retryAfterSeconds).toBeGreaterThan(0);
    expect(res.json().error.meta.retryAfterSeconds).toBeLessThanOrEqual(900);
    expect(verify).toHaveBeenCalledTimes(5);
    expect(fakes.storefronts.pages).toHaveLength(1);
  });

  it('sem página: 404 STOREFRONT_NOT_FOUND', async () => {
    fakes.storefronts.pages = [];
    const res = await post({ password: ADMIN_PASSWORD });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('STOREFRONT_NOT_FOUND');
  });

  it.each([
    ['campo extra', { password: ADMIN_PASSWORD, confirm: true }],
    ['sem senha', {}],
    ['senha vazia', { password: '' }],
    ['senha com mais de 200 caracteres', { password: 'x'.repeat(201) }],
    ['senha não texto', { password: 123456 }],
  ])('corpo inválido (%s) → 400 sem chegar ao use case', async (_name, payload) => {
    const res = await post(payload);
    expect(res.statusCode).toBe(400);
    expect(DeleteStorefrontUseCase.prototype.execute).not.toHaveBeenCalled();
  });

  it('nenhuma resposta, log ou auditoria carrega a senha', async () => {
    await post({ password: 'errada-secreta' });
    await post({ password: ADMIN_PASSWORD, extra: 1 });
    await post({ password: ADMIN_PASSWORD }, { 'x-test-role': 'OPERATOR' });
    await post({ password: ADMIN_PASSWORD });
    const everything = JSON.stringify({ bodies, logs, audit: fakes.audit.entries, attempts: attempts.rows });
    expect(everything).not.toContain(ADMIN_PASSWORD);
    expect(everything).not.toContain('errada-secreta');
  });
});

describe('GET /storefront — canDelete', () => {
  const empty = { storefront: null, publicUrl: null, offers: { drafts: [], published: [] }, categories: [], subtitleSuggestions: [], domains: [] };
  it.each([['ADMIN', true], ['SUPER_ADMIN', true], ['OPERATOR', false]])('%s → canDelete %s', async (role, expected) => {
    vi.spyOn(GetStorefrontUseCase.prototype, 'execute').mockResolvedValue(empty);
    const res = await app.inject({ method: 'GET', url: '/api/storefront', headers: { ...AUTH, 'x-test-role': role } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.canDelete).toBe(expected);
  });
});
