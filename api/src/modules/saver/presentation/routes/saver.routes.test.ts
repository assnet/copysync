import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { errorHandler } from '../../../../shared/http/errorHandler';
import { withProduct } from '../../../../app/productRoutes';
import type { ProductGateMode } from '../../../../shared/http/hooks/productGate';
import type { ProductKey } from '../../../tenants/domain/services/resolveProductAccess';
import { SaverExportEmptyError } from '../../../../shared/errors/internal/SaverExportErrors';
import { saverRoutes } from './saver.routes';
import { saverAdminRoutes } from './saverAdmin.routes';

/* Contrato HTTP sem banco: auth/tenant falsos, container do Saver trocado por use cases falsos. */
const st = vi.hoisted(() => ({
  isSuperAdmin: false,
  role: 'ADMIN' as 'ADMIN' | 'OPERATOR',
  memberOf: true,
  superAdminOnly: true,
  products: new Set<string>(),
}));

vi.mock('../../../../shared/database/prisma.client', () => ({ prisma: {} }));
vi.mock('../../../../shared/http/hooks/authHook', () => ({
  authHook: async (request: { user?: unknown }) => {
    request.user = { userId: 'user-a', isSuperAdmin: st.isSuperAdmin };
  },
}));
vi.mock('../../../../shared/http/hooks/tenantHook', () => ({
  tenantHook: async (request: { tenantContext?: unknown }) => {
    request.tenantContext = { userId: 'user-a', tenantId: 'tenant-a', role: st.isSuperAdmin ? 'SUPER_ADMIN' : st.role, isSuperAdmin: st.isSuperAdmin };
  },
}));
vi.mock('../../../../shared/http/hooks/resolveMembership', async () => {
  const { ForbiddenError } = await import('../../../../shared/errors/internal/AuthErrors');
  return {
    resolveMembership: async (userId: string, tenantId: string) => {
      if (!st.memberOf) throw new ForbiddenError('no');
      return { userId, tenantId, role: 'ADMIN', isSuperAdmin: false };
    },
  };
});

const fake = vi.hoisted(() => {
  const NOW = new Date('2026-11-17T12:00:00.000Z');
  const usage = { used: 1, limit: 10, remaining: 9 };
  const extraction = {
    id: 'ex1', sessionId: 's1', trigger: 'MANUAL', status: 'QUEUED', totalGroups: 1, doneGroups: 0, failedGroups: 0,
    membersFound: 0, newContacts: 0, createdAt: NOW, finishedAt: null,
  };
  async function* lines(rows: string[]) { for (const r of rows) yield r; }
  const uc = (impl: (...a: unknown[]) => unknown) => ({ execute: vi.fn(async (...a: unknown[]) => impl(...a)) });
  return {
    NOW,
    lines,
    container: {
      getOverview: uc(() => ({
        groups: usage, contacts: usage, groupScansPerDay: usage, autoRefreshEnabled: false,
        permissions: { view: true, extract: true, export: true, configure: true },
        config: { namePrefix: null, excludeAdminsByDefault: false, defaultFormat: 'CSV', autoRefresh: false },
        queueRunning: true,
      })),
      listSessionGroups: uc(() => [{ groupJid: 'g1@g.us', name: 'Grupo', saved: true, savedGroupId: 'sg1', lastScannedAt: NOW, lastScanStatus: 'DONE' }]),
      requestExtraction: uc(() => extraction),
      getExtraction: uc(() => extraction),
      cancelExtraction: uc(() => ({ extraction, cancelledItems: 1 })),
      removeGroup: uc(() => undefined),
      listGroups: uc(() => [{
        id: 'sg1', groupJid: 'g1@g.us', name: 'Grupo', sessionId: 's1', memberCount: 3, phoneCount: 2, lidOnlyCount: 1,
        lastScannedAt: NOW, lastScanStatus: 'DONE', createdAt: NOW,
      }]),
    },
    tenant: {
      exportSavedContacts: uc(() => ({
        format: 'CSV', fileName: 'contatos-2026-11-17.csv', contentType: 'text/csv; charset=utf-8', total: 1, skippedWithoutPhone: 0,
        lines: lines(['﻿Nome,Telefone,LID,Extraído em\r\n', 'Ana,5511999990000,,17/11/2026\r\n']),
      })),
      getConfig: uc(() => ({
        namePrefix: null, excludeAdminsByDefault: false, defaultFormat: 'CSV', autoRefresh: false, autoRefreshAvailable: false, configured: false, updatedAt: null,
      })),
      updateConfig: uc(() => ({
        namePrefix: 'X', excludeAdminsByDefault: true, defaultFormat: 'VCARD', autoRefresh: false, autoRefreshAvailable: false, configured: true, updatedAt: NOW,
      })),
      listExportGrants: uc(() => [{ userId: 'op1', name: 'Op', email: 'op@x.com', canExport: false }]),
      setExportGrant: uc(() => ({ userId: 'op1', canExport: true })),
    },
    platform: {
      listContacts: uc(() => ({
        items: [{ id: 'c1', name: 'Ana', phone: '5511999990000', lid: null, tenantCount: 1, groupCount: 2, firstSeenAt: NOW, lastSeenAt: NOW, firstExtractedAt: NOW, lastExtractedAt: NOW }],
        nextCursor: null,
      })),
      getContact: uc(() => ({
        contactId: 'c1',
        links: [{ tenantId: 'tenant-a', tenantName: 'Loja A', groupId: 'sg1', groupName: 'Grupo', name: 'Ana', isAdmin: false, firstExtractedAt: NOW, lastExtractedAt: NOW, leftAt: null }],
      })),
      listTenants: uc(() => ({ items: [{ id: 'tenant-a', name: 'Loja A' }], nextCursor: 'next' })),
      exportContacts: uc(() => ({ fileName: 'base-de-contatos-2026-11-17.csv', contentType: 'text/csv; charset=utf-8', lines: lines(['h\r\n', 'l\r\n']) })),
    },
  };
});

vi.mock('../../infrastructure/saverContainer', () => ({
  saverContainer: fake.container,
  saverTenantUseCases: fake.tenant,
  saverPlatformUseCases: fake.platform,
  saverAudience: { reader: () => ({ superAdminOnly: async () => st.superAdminOnly }) },
}));

/** Toda rota `/saver/*` com gate (método, path, corpo). */
const GATED: [string, string, object?][] = [
  ['GET', '/overview'],
  ['GET', '/sessions/s1/groups'],
  ['POST', '/extractions', { sessionId: 's1', groupJids: ['g1@g.us'] }],
  ['GET', '/extractions/ex1'],
  ['POST', '/extractions/ex1/cancel'],
  ['GET', '/groups'],
  ['DELETE', '/groups/sg1'],
  ['GET', '/permissions'],
  ['PUT', '/permissions/op1', { export: true }],
  ['POST', '/exports', { format: 'CSV', groupIds: 'all' }],
  ['GET', '/config'],
  ['PUT', '/config', { namePrefix: 'X' }],
];

let app: FastifyInstance;
const reader = {
  has: vi.fn(async (_t: string, p: ProductKey) => st.products.has(p)),
  list: vi.fn(async () => [...st.products] as ProductKey[]),
  invalidate: vi.fn(),
};
const jsonBodies: unknown[] = [];

async function build(mode: ProductGateMode = 'enforce'): Promise<void> {
  app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(withProduct('SAVER', saverRoutes, { reader, mode }), { prefix: '/api/saver' });
  await app.register(saverAdminRoutes, { prefix: '/api/admin/saver' });
  await app.ready();
}

async function call(method: string, url: string, payload?: object, headers: Record<string, string> = { 'x-tenant-id': 'tenant-a' }) {
  const res = await app.inject({ method: method as 'GET', url, payload, headers });
  if (url.startsWith('/api/saver') && String(res.headers['content-type'] ?? '').includes('application/json')) jsonBodies.push(res.json());
  return res;
}

beforeEach(async () => {
  st.isSuperAdmin = false;
  st.role = 'ADMIN';
  st.memberOf = true;
  st.superAdminOnly = false;
  st.products = new Set(['SAVER']);
  await build();
});
afterEach(async () => { await app.close(); });

describe('gate de produto em /saver/*', () => {
  it.each(['off', 'log', 'enforce'] as const)('sem produto → 403 PRODUCT_UNAVAILABLE em toda rota (modo %s)', async (mode) => {
    await app.close();
    await build(mode);
    st.products = new Set();
    for (const [m, p, body] of GATED) {
      const res = await call(m, `/api/saver${p}`, body);
      expect(res.statusCode, `${m} ${p}`).toBe(403);
      expect(res.json().error?.code ?? res.json().code, `${m} ${p}`).toBe('PRODUCT_UNAVAILABLE');
    }
  });

  it('plano Afiliados MAX sem Saver → 403', async () => {
    st.products = new Set(['AFFILIATES']);
    for (const [m, p, body] of GATED) expect((await call(m, `/api/saver${p}`, body)).statusCode, `${m} ${p}`).toBe(403);
  });
});

describe('audiência "Só super admin"', () => {
  beforeEach(() => { st.superAdminOnly = true; });

  it('tenant com plano Saver → 403 SAVER_UNAVAILABLE; /access falso', async () => {
    for (const [m, p, body] of GATED) {
      const res = await call(m, `/api/saver${p}`, body);
      expect(res.statusCode, `${m} ${p}`).toBe(403);
      expect(JSON.stringify(res.json())).toContain('SAVER_UNAVAILABLE');
    }
    expect((await call('GET', '/api/saver/access')).json().data).toEqual({ visible: false });
  });

  it('super admin (mesmo sem produto) → 200; /access verdadeiro', async () => {
    st.isSuperAdmin = true;
    st.products = new Set();
    expect((await call('GET', '/api/saver/overview')).statusCode).toBe(200);
    expect((await call('GET', '/api/saver/access')).json().data).toEqual({ visible: true });
  });
});

describe('audiência aberta', () => {
  it('tenant com plano Saver → 2xx em toda rota', async () => {
    for (const [m, p, body] of GATED) expect((await call(m, `/api/saver${p}`, body)).statusCode, `${m} ${p}`).toBeLessThan(300);
  });

  it('/access: membro válido = true; sem header ou membro inválido = false (sem 403)', async () => {
    expect((await call('GET', '/api/saver/access')).json().data).toEqual({ visible: true });
    expect((await call('GET', '/api/saver/access', undefined, {})).json().data).toEqual({ visible: false });
    st.memberOf = false;
    const res = await call('GET', '/api/saver/access');
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ visible: false });
  });

  it('/access não depende do produto (o cadeado vem do acesso por produto)', async () => {
    st.products = new Set();
    expect((await call('GET', '/api/saver/access')).json().data).toEqual({ visible: true });
    expect(reader.has).not.toHaveBeenCalledWith(expect.anything(), 'SAVER', expect.anything());
  });

  it('ator vem do contexto do tenant (papel do vínculo)', async () => {
    st.role = 'OPERATOR';
    await call('GET', '/api/saver/overview');
    expect(fake.container.getOverview.execute).toHaveBeenLastCalledWith({ tenantId: 'tenant-a', userId: 'user-a', role: 'OPERATOR' });
  });

  it('corpo fora do schema → 400 (lista de grupos vazia, acima de 50)', async () => {
    expect((await call('POST', '/api/saver/extractions', { sessionId: 's1', groupJids: [] })).statusCode).toBe(400);
    const many = Array.from({ length: 51 }, (_, i) => `g${i}@g.us`);
    expect((await call('POST', '/api/saver/extractions', { sessionId: 's1', groupJids: many })).statusCode).toBe(400);
    expect((await call('POST', '/api/saver/exports', { format: 'PDF', groupIds: 'all' })).statusCode).toBe(400);
  });
});

describe('exportação do tenant', () => {
  it('arquivo por stream com Content-Disposition, Content-Type e sem cache', async () => {
    const res = await call('POST', '/api/saver/exports', { format: 'CSV', groupIds: ['sg1'], options: { onlyWithPhone: true } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="contatos-2026-11-17.csv"; filename*=UTF-8''contatos-2026-11-17.csv`);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toContain('Ana,5511999990000');
    expect(fake.tenant.exportSavedContacts.execute).toHaveBeenLastCalledWith({
      actor: { tenantId: 'tenant-a', userId: 'user-a', role: 'ADMIN' }, format: 'CSV', groupIds: ['sg1'], options: { onlyWithPhone: true },
    });
  });

  it('vazio → 422 antes do primeiro byte (JSON, sem arquivo)', async () => {
    fake.tenant.exportSavedContacts.execute.mockRejectedValueOnce(new SaverExportEmptyError('CSV'));
    const res = await call('POST', '/api/saver/exports', { format: 'CSV', groupIds: 'all' });
    expect(res.statusCode).toBe(422);
    expect(res.headers['content-disposition']).toBeUndefined();
  });

  it('handlers de arquivo usam `return reply` (AGENTS §14)', () => {
    for (const file of ['saver.routes.ts', 'saverAdmin.routes.ts']) {
      const src = readFileSync(path.join(__dirname, file), 'utf8');
      const calls = src.match(/^.*sendSaverFile\(reply.*$/gm) ?? [];
      expect(calls.length, file).toBeGreaterThan(0);
      for (const line of calls) expect(line.trim().startsWith('return sendSaverFile('), line).toBe(true);
    }
    const http = readFileSync(path.join(__dirname, 'saverHttp.ts'), 'utf8');
    expect(http).toMatch(/return reply\s*\n\s*\.status\(200\)/);
  });
});

describe('privacidade das respostas JSON de /saver/*', () => {
  it('nenhuma resposta JSON tem campo phone/lid', async () => {
    jsonBodies.length = 0;
    for (const [m, p, body] of GATED) await call(m, `/api/saver${p}`, body);
    await call('GET', '/api/saver/access');
    expect(jsonBodies.length).toBeGreaterThanOrEqual(GATED.length - 2); // DELETE (204) e exportação (arquivo) não são JSON
    const offending: string[] = [];
    const walk = (v: unknown, at: string): void => {
      if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${at}[${i}]`));
      if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          if (k === 'phone' || k === 'lid') offending.push(`${at}.${k}`);
          walk(x, `${at}.${k}`);
        }
      }
    };
    jsonBodies.forEach((b, i) => walk(b, `#${i}`));
    expect(offending).toEqual([]);
  });

  it('DTO com phone/lid a mais não vaza (presenter escolhe campo a campo)', async () => {
    const [group] = (await fake.container.listGroups.execute()) as object[];
    fake.container.listGroups.execute.mockResolvedValueOnce([{ ...group, phone: '5511999990000', lid: '123@lid' }]);
    jsonBodies.length = 0;
    const res = await call('GET', '/api/saver/groups');
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0]).toMatchObject({ id: 'sg1', phoneCount: 2 });
    expect(res.json().data[0]).not.toHaveProperty('phone');
    expect(res.json().data[0]).not.toHaveProperty('lid');
  });
});

describe('/admin/saver/* (base da plataforma)', () => {
  it('fora do gate: ADMIN de tenant → 403; super admin sem produto → 200', async () => {
    st.products = new Set();
    for (const [m, p, body] of [['GET', '/contacts'], ['GET', '/contacts/c1'], ['GET', '/tenants'], ['POST', '/exports', {}]] as [string, string, object?][]) {
      const res = await call(m, `/api/admin/saver${p}`, body);
      expect(res.statusCode, `${m} ${p}`).toBe(403);
    }
    st.isSuperAdmin = true;
    st.superAdminOnly = true;
    const list = await call('GET', '/api/admin/saver/contacts?search=ana&from=2026-11-01');
    expect(list.statusCode).toBe(200);
    expect(list.json().data.items[0]).toMatchObject({ id: 'c1', phone: '5511999990000', lastSeenAt: fake.NOW.toISOString() });
    expect(fake.platform.listContacts.execute).toHaveBeenLastCalledWith(expect.objectContaining({
      actor: { userId: 'user-a', isSuperAdmin: true }, search: 'ana', from: new Date('2026-11-01'), to: null, cursor: null,
    }));
    expect((await call('GET', '/api/admin/saver/contacts/c1')).json().data.links[0]).toMatchObject({ tenantName: 'Loja A', groupName: 'Grupo', leftAt: null });
    expect(reader.has).not.toHaveBeenCalled();
  });

  it('exportação da base: CSV por stream com Content-Disposition', async () => {
    st.isSuperAdmin = true;
    const res = await call('POST', '/api/admin/saver/exports', { tenantId: 'tenant-a' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('base-de-contatos-2026-11-17.csv');
    expect(res.body).toBe('h\r\nl\r\n');
  });

  it('contas do filtro: id e nome por cursor; `limit` descartado', async () => {
    st.isSuperAdmin = true;
    const res = await call('GET', '/api/admin/saver/tenants?cursor=abc&limit=500');
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ items: [{ id: 'tenant-a', name: 'Loja A' }], nextCursor: 'next' });
    expect(fake.platform.listTenants.execute).toHaveBeenLastCalledWith({ actor: { userId: 'user-a', isSuperAdmin: true }, cursor: 'abc' });
  });

  it('`limit` no query não chega ao use case (só cursor)', async () => {
    st.isSuperAdmin = true;
    // removeAdditional do Fastify descarta a chave; o use case nunca recebe limit.
    await call('GET', '/api/admin/saver/contacts?limit=10000');
    expect(fake.platform.listContacts.execute).toHaveBeenLastCalledWith(expect.not.objectContaining({ limit: expect.anything() }));
  });
});
