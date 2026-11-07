import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { errorHandler } from '../../../../shared/http/errorHandler';
import { hashInviteToken } from '../../../../shared/utils/generateInviteToken';
import { verifyPassword } from '../../../../shared/utils/hash';
import { User } from '../../../users/domain/entities/User';
import { inviteRoutes } from './invite.routes';

/*
 * Contrato HTTP do convite / primeiro acesso: Fastify de verdade, repositórios em memória.
 * Doc: docs/arquitetura-central-billing.md, seção "Primeiro acesso".
 */
interface InviteRow {
  id: string; tenantId: string; email: string; role: string; tokenHash: string;
  expiresAt: Date; acceptedAt: Date | null; invitedById: string | null;
}
const db = vi.hoisted(() => ({
  users: [] as unknown[],
  links: [] as { userId: string; tenantId: string; role: string }[],
  invites: [] as unknown[],
}));

vi.mock('../../../../shared/database/prisma.client', () => ({ prisma: {} }));
vi.mock('../../../../shared/http/hooks/optionalAuthHook', () => ({ optionalAuthHook: async () => {} }));
vi.mock('../../../../shared/database/UnitOfWork', () => ({
  UnitOfWork: class { runInTransaction<T>(fn: (tx: unknown) => Promise<T>) { return fn({}); } },
}));
vi.mock('../../../../shared/audit/PrismaAuditLogRepository', () => ({
  PrismaAuditLogRepository: class { async create() {} },
}));
vi.mock('../../../tenants/infrastructure/repositories/PrismaTenantRepository', () => ({
  PrismaTenantRepository: class { async findById(id: string) { return { id, name: 'Loja' }; } },
}));
vi.mock('../../../users/infrastructure/repositories/PrismaUserInviteRepository', () => ({
  PrismaUserInviteRepository: class {
    async findByTokenHash(h: string) { return (db.invites as InviteRow[]).find((i) => i.tokenHash === h) ?? null; }
    async markAccepted(id: string) { (db.invites as InviteRow[]).find((i) => i.id === id)!.acceptedAt = new Date(); }
  },
}));
vi.mock('../../../users/infrastructure/repositories/PrismaUserRepository', () => ({
  PrismaUserRepository: class {
    async findByEmail(e: string) { return (db.users as User[]).find((u) => u.email === e) ?? null; }
    async findTenantsForUser(id: string) {
      return db.links.filter((l) => l.userId === id).map((l) => ({ tenantId: l.tenantId, role: l.role }));
    }
    async create(u: User) { db.users.push(u); return u; }
    async update(u: User) { db.users = (db.users as User[]).map((x) => (x.id === u.id ? u : x)); return u; }
    async createUserTenant(l: { userId: string; tenantId: string; role: string }) { db.links.push(l); }
  },
}));

const PASS = 'Senha@Forte123';
const day = 86_400_000;

function user(id: string, email: string, passwordHash: string | null = null): User {
  const now = new Date();
  return new User({ id, email, passwordHash, passwordSetAt: passwordHash ? now : null, mustChangePassword: false,
    name: 'Ana', isSuperAdmin: false, createdAt: now, updatedAt: now });
}
function invite(token: string, over: Partial<InviteRow> = {}): void {
  db.invites.push({ id: `inv-${token}`, tenantId: 't1', email: 'ana@x.com', role: 'ADMIN',
    tokenHash: hashInviteToken(token), expiresAt: new Date(Date.now() + day), acceptedAt: null,
    invitedById: null, ...over });
}
/** Estado após o provisionamento da cobrança: User sem senha + UserTenant ADMIN + convite do sistema. */
function provisioned(token = 'tok'): void {
  db.users.push(user('u1', 'ana@x.com'));
  db.links.push({ userId: 'u1', tenantId: 't1', role: 'ADMIN' });
  invite(token);
}

let app: FastifyInstance;
beforeEach(async () => {
  db.users = []; db.links = []; db.invites = [];
  app = Fastify();
  app.addSchema({ $id: 'ErrorResponse', type: 'object', properties: { success: { type: 'boolean' },
    error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } } });
  app.setErrorHandler(errorHandler as Parameters<typeof app.setErrorHandler>[0]);
  await app.register(inviteRoutes, { prefix: '/auth' });
});
afterEach(async () => { await app.close(); });

const info = (t: string) => app.inject({ method: 'GET', url: `/auth/invites/${t}` });
const accept = (t: string, body: unknown = { password: PASS, confirmPassword: PASS }) =>
  app.inject({ method: 'POST', url: `/auth/invites/${t}/accept`, payload: body as object });

describe('convite / primeiro acesso', () => {
  it('provisionado sem senha: pede senha, não pede login', async () => {
    provisioned();
    const res = await info('tok');
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ requiresPassword: true, requiresLogin: false });
  });

  it('provisionado aceita: grava senha, marca convite, sem UserTenant duplicado nem troca de papel', async () => {
    provisioned();
    db.links[0].role = 'OPERATOR';
    const res = await accept('tok');
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ status: 'ACCEPTED', tenantId: 't1', userId: 'u1', isNewUser: false });
    const u = (db.users as User[])[0];
    expect(u.passwordSetAt).toBeInstanceOf(Date);
    expect(await verifyPassword(PASS, u.passwordHash!)).toBe(true);
    expect(db.links).toEqual([{ userId: 'u1', tenantId: 't1', role: 'OPERATOR' }]);
    expect((db.invites as InviteRow[])[0].acceptedAt).toBeInstanceOf(Date);
    expect((await info('tok')).statusCode).toBe(404);
  });

  it('sem senha e sem senha no corpo: erro, nada gravado', async () => {
    provisioned();
    expect((await accept('tok', {})).statusCode).toBe(404);
    expect((db.users as User[])[0].passwordHash).toBeNull();
  });

  it('usuário com senha: exige login', async () => {
    db.users.push(user('u1', 'ana@x.com', 'hash'));
    invite('tok');
    expect((await info('tok')).json().data).toMatchObject({ requiresPassword: false, requiresLogin: true });
    expect((await accept('tok')).json().data).toMatchObject({ status: 'REQUIRES_LOGIN', hint: 'LOGIN_REQUIRED' });
  });

  it('convite de pessoa para conta sem senha com OUTRO tenant: exige login (proteção mantida)', async () => {
    db.users.push(user('u1', 'ana@x.com'));
    db.links.push({ userId: 'u1', tenantId: 't0', role: 'ADMIN' });
    invite('tok', { invitedById: 'admin-t1' });
    expect((await info('tok')).json().data).toMatchObject({ requiresLogin: true });
    expect((await accept('tok')).json().data).toMatchObject({ status: 'REQUIRES_LOGIN', hint: 'SET_PASSWORD_FIRST' });
    expect((db.users as User[])[0].passwordHash).toBeNull();
  });

  it('token expirado ou já aceito: 404', async () => {
    invite('exp', { expiresAt: new Date(Date.now() - 1) });
    invite('used', { acceptedAt: new Date() });
    for (const t of ['exp', 'used', 'nao-existe']) {
      expect((await info(t)).statusCode).toBe(404);
      expect((await accept(t)).statusCode).toBe(404);
    }
  });
});
