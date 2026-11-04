import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Status = 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';

const db = vi.hoisted(() => ({
  tenants: new Map<string, { id: string; status: string }>(),
  members: new Map<string, { role: string; tenant: { status: string } }>(),
}));

vi.mock('../../database/prisma.client', () => ({
  prisma: {
    tenant: {
      findUnique: async ({ where }: { where: { id: string } }) => db.tenants.get(where.id) ?? null,
    },
    userTenant: {
      findUnique: async ({
        where,
      }: {
        where: { userId_tenantId: { userId: string; tenantId: string } };
      }) =>
        db.members.get(`${where.userId_tenantId.userId}:${where.userId_tenantId.tenantId}`) ?? null,
    },
  },
}));

import { tenantAnyStatusHook } from './tenantAnyStatusHook';
import { tenantHook } from './tenantHook';

function seed(status: Status): void {
  db.tenants.set('t1', { id: 't1', status });
  db.members.set('u1:t1', { role: 'ADMIN', tenant: { status } });
}

function req(userId: string, isSuperAdmin = false, tenantId: string | null = 't1') {
  return {
    headers: tenantId ? { 'x-tenant-id': tenantId } : {},
    user: { userId, isSuperAdmin },
  } as unknown as FastifyRequest;
}

const reply = {} as FastifyReply;

describe('tenantAnyStatusHook × tenantHook', () => {
  beforeEach(() => {
    db.tenants.clear();
    db.members.clear();
  });

  it.each<Status>(['SUSPENDED', 'CANCELLED'])('%s passa no hook tolerante e falha no tenantHook', async (status) => {
    seed(status);
    const r = req('u1');
    await tenantAnyStatusHook(r, reply);
    expect(r.tenantContext).toEqual({ userId: 'u1', tenantId: 't1', role: 'ADMIN', isSuperAdmin: false });

    await expect(tenantHook(req('u1'), reply)).rejects.toMatchObject({
      code: 'TENANT_SUSPENDED',
      statusCode: 403,
    });
  });

  it('ACTIVE passa nos dois', async () => {
    seed('ACTIVE');
    const a = req('u1');
    const b = req('u1');
    await tenantHook(a, reply);
    await tenantAnyStatusHook(b, reply);
    expect(b.tenantContext).toEqual(a.tenantContext);
  });

  it('não-membro recebe 403 nos dois, mesmo com tenant suspenso', async () => {
    seed('SUSPENDED');
    for (const hook of [tenantHook, tenantAnyStatusHook]) {
      await expect(hook(req('intruso'), reply)).rejects.toMatchObject({
        code: 'FORBIDDEN',
        statusCode: 403,
      });
    }
  });

  it('super-admin: tenant suspenso passa só no hook tolerante; inexistente 403 nos dois', async () => {
    seed('SUSPENDED');
    const r = req('sa', true);
    await tenantAnyStatusHook(r, reply);
    expect(r.tenantContext).toMatchObject({ role: 'SUPER_ADMIN', isSuperAdmin: true });
    await expect(tenantHook(req('sa', true), reply)).rejects.toMatchObject({ code: 'TENANT_SUSPENDED' });

    for (const hook of [tenantHook, tenantAnyStatusHook]) {
      await expect(hook(req('sa', true, 'nope'), reply)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('sem header X-Tenant-Id: 401', async () => {
    await expect(tenantAnyStatusHook(req('u1', false, null), reply)).rejects.toMatchObject({
      statusCode: 401,
    });
  });
});

describe('uso restrito do hook tolerante', () => {
  // Hook tolerante em outra rota abre dado de tenant suspenso: só a rota de assinatura pode usar.
  const ALLOWED = new Set([
    'shared/http/hooks/tenantAnyStatusHook.ts',
    'shared/http/hooks/tenantAnyStatusHook.test.ts',
    'shared/http/hooks/resolveMembership.ts', // só comentário
    'modules/tenants/presentation/routes/subscription.routes.ts',
    'modules/tenants/presentation/routes/subscription.routes.test.ts',
  ]);
  const srcRoot = resolve(__dirname, '../../..');

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules') continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (name.endsWith('.ts')) out.push(full);
    }
    return out;
  }

  it('só subscription.routes.ts importa tenantAnyStatusHook', () => {
    const offenders = walk(srcRoot)
      .map((f) => relative(srcRoot, f).split('\\').join('/'))
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) => readFileSync(join(srcRoot, rel), 'utf8').includes('tenantAnyStatusHook'));
    expect(offenders).toEqual([]);
  });

  it('allowInactive só é passado pelo hook tolerante', () => {
    const offenders = walk(srcRoot)
      .map((f) => relative(srcRoot, f).split('\\').join('/'))
      .filter((rel) => !rel.startsWith('shared/http/hooks/tenantAnyStatusHook') && rel !== 'shared/http/hooks/resolveMembership.ts')
      .filter((rel) => readFileSync(join(srcRoot, rel), 'utf8').includes('allowInactive'));
    expect(offenders).toEqual([]);
  });
});
