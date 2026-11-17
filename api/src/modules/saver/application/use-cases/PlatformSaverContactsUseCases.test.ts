import { describe, expect, it, vi } from 'vitest';
import type { CreateAuditLogInput, IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import type {
  IPlatformSaverContactRepository,
  PlatformSaverContactFilter,
  PlatformSaverContactKey,
  PlatformSaverContactLink,
  PlatformSaverContactRow,
  PlatformSaverTenant,
} from '../../domain/contracts/IPlatformSaverContactRepository';
import {
  ExportPlatformSaverContactsUseCase,
  GetPlatformSaverContactUseCase,
  ListPlatformSaverContactsUseCase,
  ListPlatformSaverTenantsUseCase,
  PLATFORM_SAVER_PAGE_SIZE,
  PLATFORM_SAVER_TENANT_PAGE_SIZE,
} from './PlatformSaverContactsUseCases';

const SUPER = { userId: 'su', isSuperAdmin: true };
const TENANT_ADMIN = { userId: 'u1', isSuperAdmin: false };

function rowsOf(n: number): PlatformSaverContactRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    phone: `55119${String(i).padStart(8, '0')}`,
    lid: null,
    name: `Pessoa ${i}`,
    firstSeenAt: new Date('2026-11-01T12:00:00Z'),
    lastSeenAt: new Date(Date.UTC(2026, 10, 17, 0, 0, 0) - i * 1000),
    tenantCount: 1,
    groupCount: 2,
    firstExtractedAt: new Date('2026-11-01T12:00:00Z'),
    lastExtractedAt: new Date('2026-11-17T12:00:00Z'),
  }));
}

/** Repositório falso com keyset sobre `all` (lastSeenAt desc, id). */
function repo(all: PlatformSaverContactRow[], links: PlatformSaverContactLink[] = [], tenants: PlatformSaverTenant[] = []) {
  const calls: { filter: PlatformSaverContactFilter; after: PlatformSaverContactKey | null; limit: number }[] = [];
  const r: IPlatformSaverContactRepository = {
    findByKeys: vi.fn(),
    applyGroupRead: vi.fn(),
    findLinks: vi.fn(async () => links),
    listTenants: vi.fn(async (after, limit) => {
      const start = after ? tenants.findIndex((t) => t.id === after.id) + 1 : 0;
      return tenants.slice(start, start + limit);
    }),
    list: vi.fn(async (filter, after, limit) => {
      calls.push({ filter, after, limit });
      const start = after ? all.findIndex((c) => c.id === after.id) + 1 : 0;
      return all.slice(start, start + limit);
    }),
  };
  return { r, calls };
}

function auditRepo() {
  const entries: CreateAuditLogInput[] = [];
  const a: IAuditLogRepository = { create: vi.fn(async (e) => void entries.push(e)) };
  return { a, entries };
}

const noPersonalData = (entries: CreateAuditLogInput[]) => {
  const text = JSON.stringify(entries);
  expect(text).not.toMatch(/Pessoa|55119|ana/);
};

describe('ListPlatformSaverContactsUseCase', () => {
  it('ADMIN de tenant → 403, sem tocar a base', async () => {
    const { r } = repo(rowsOf(3));
    const { a } = auditRepo();
    await expect(new ListPlatformSaverContactsUseCase(r, a).execute({ actor: TENANT_ADMIN })).rejects.toMatchObject({ statusCode: 403 });
    expect(r.list).not.toHaveBeenCalled();
    expect(a.create).not.toHaveBeenCalled();
  });

  it('pagina por cursor keyset e audita sem nome, número nem busca', async () => {
    const { r, calls } = repo(rowsOf(PLATFORM_SAVER_PAGE_SIZE + 5));
    const { a, entries } = auditRepo();
    const uc = new ListPlatformSaverContactsUseCase(r, a);
    const p1 = await uc.execute({ actor: SUPER, search: ' ana ' });
    expect(p1.items).toHaveLength(PLATFORM_SAVER_PAGE_SIZE);
    expect(p1.nextCursor).toBeTruthy();
    expect(calls[0]).toMatchObject({ after: null, limit: PLATFORM_SAVER_PAGE_SIZE + 1, filter: { search: 'ana' } });

    const p2 = await uc.execute({ actor: SUPER, search: 'ana', cursor: p1.nextCursor });
    expect(p2.items.map((c) => c.id)).toEqual(['c50', 'c51', 'c52', 'c53', 'c54']);
    expect(p2.nextCursor).toBeNull();
    expect(calls[1]?.after?.id).toBe(`c${PLATFORM_SAVER_PAGE_SIZE - 1}`);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ userId: 'su', action: 'SAVER_PLATFORM_VIEWED', meta: { filters: { hasSearch: true } } });
    noPersonalData(entries);
  });

  it('cursor de outro filtro ou adulterado → 400 (painel recomeça), nunca offset', async () => {
    const { r } = repo(rowsOf(PLATFORM_SAVER_PAGE_SIZE + 1));
    const { a } = auditRepo();
    const uc = new ListPlatformSaverContactsUseCase(r, a);
    const { nextCursor } = await uc.execute({ actor: SUPER, tenantId: 't1' });
    await expect(uc.execute({ actor: SUPER, tenantId: 't2', cursor: nextCursor })).rejects.toMatchObject({
      statusCode: 400,
      code: 'SAVER_CURSOR_INVALID',
    });
    await expect(uc.execute({ actor: SUPER, cursor: 'lixo' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('período invertido → 400', async () => {
    const { r } = repo([]);
    const { a } = auditRepo();
    await expect(
      new ListPlatformSaverContactsUseCase(r, a).execute({ actor: SUPER, from: new Date('2026-11-10'), to: new Date('2026-11-01') }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('GetPlatformSaverContactUseCase', () => {
  const link: PlatformSaverContactLink = {
    tenantId: 't1', tenantName: 'Loja 1', groupId: 'g1', groupName: 'Grupo', name: 'Pessoa 1', isAdmin: false,
    firstExtractedAt: new Date('2026-11-01T12:00:00Z'), lastExtractedAt: new Date('2026-11-17T12:00:00Z'), leftAt: null,
  };

  it('lista tenant, grupo, data e hora e audita só ids', async () => {
    const { r } = repo([], [link]);
    const { a, entries } = auditRepo();
    const out = await new GetPlatformSaverContactUseCase(r, a).execute({ actor: SUPER, contactId: 'c1' });
    expect(out.links[0]).toMatchObject({ tenantId: 't1', tenantName: 'Loja 1', groupId: 'g1', lastExtractedAt: link.lastExtractedAt });
    expect(entries[0]).toMatchObject({ action: 'SAVER_PLATFORM_VIEWED', meta: { kind: 'detail', contactId: 'c1' } });
    noPersonalData(entries);
  });

  it('sem vínculo → 404; não super admin → 403', async () => {
    const { a } = auditRepo();
    await expect(new GetPlatformSaverContactUseCase(repo([]).r, a).execute({ actor: SUPER, contactId: 'x' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(new GetPlatformSaverContactUseCase(repo([], [link]).r, a).execute({ actor: TENANT_ADMIN, contactId: 'c1' })).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('ListPlatformSaverTenantsUseCase', () => {
  const tenants = Array.from({ length: PLATFORM_SAVER_TENANT_PAGE_SIZE + 5 }, (_, i) => ({ id: `t${i}`, name: `Loja ${String(i).padStart(3, '0')}` }));

  it('não super admin → 403, sem tocar a base', async () => {
    const { r } = repo([], [], tenants);
    await expect(new ListPlatformSaverTenantsUseCase(r).execute({ actor: TENANT_ADMIN })).rejects.toMatchObject({ statusCode: 403 });
    expect(r.listTenants).not.toHaveBeenCalled();
  });

  it('pagina por cursor keyset assinado (id e nome), sem auditoria', async () => {
    const { r } = repo([], [], tenants);
    const uc = new ListPlatformSaverTenantsUseCase(r);
    const first = await uc.execute({ actor: SUPER });
    expect(first.items).toHaveLength(PLATFORM_SAVER_TENANT_PAGE_SIZE);
    expect(first.items[0]).toEqual({ id: 't0', name: 'Loja 000' });
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await uc.execute({ actor: SUPER, cursor: first.nextCursor });
    expect(r.listTenants).toHaveBeenLastCalledWith({ name: 'Loja 099', id: 't99' }, PLATFORM_SAVER_TENANT_PAGE_SIZE + 1);
    expect(second.items.map((t) => t.id)).toEqual(['t100', 't101', 't102', 't103', 't104']);
    expect(second.nextCursor).toBeNull();
  });

  it('cursor adulterado ou da lista de contatos → 400', async () => {
    const { r } = repo(rowsOf(PLATFORM_SAVER_PAGE_SIZE + 1), [], tenants);
    const { a } = auditRepo();
    const contactsPage = await new ListPlatformSaverContactsUseCase(r, a).execute({ actor: SUPER });
    const uc = new ListPlatformSaverTenantsUseCase(r);
    await expect(uc.execute({ actor: SUPER, cursor: contactsPage.nextCursor })).rejects.toMatchObject({ statusCode: 400 });
    const first = await uc.execute({ actor: SUPER });
    const forged = `${Buffer.from(JSON.stringify({ n: 'A', i: 'x' })).toString('base64url')}${first.nextCursor!.slice(first.nextCursor!.indexOf('~'))}`;
    await expect(uc.execute({ actor: SUPER, cursor: forged })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('ExportPlatformSaverContactsUseCase', () => {
  it('não super admin → 403 antes do stream', async () => {
    const { a } = auditRepo();
    await expect(new ExportPlatformSaverContactsUseCase(repo([]).r, a).execute({ actor: TENANT_ADMIN })).rejects.toMatchObject({ statusCode: 403 });
  });

  it('CSV em lotes keyset e auditoria com contagem ao fim', async () => {
    const { r, calls } = repo(rowsOf(2500));
    const { a, entries } = auditRepo();
    const file = await new ExportPlatformSaverContactsUseCase(r, a, () => new Date('2026-11-17T10:00:00Z')).execute({ actor: SUPER, search: 'ana' });
    expect(file.fileName).toBe('base-de-contatos-2026-11-17.csv');
    expect(r.list).not.toHaveBeenCalled();
    const lines: string[] = [];
    for await (const l of file.lines) lines.push(l);
    expect(lines).toHaveLength(2501);
    expect(lines[0]).toMatch(/^﻿Nome,Telefone,LID/);
    expect(calls.map((c) => c.limit)).toEqual([1000, 1000, 1000]);
    expect(entries).toEqual([
      expect.objectContaining({ action: 'SAVER_PLATFORM_EXPORTED', meta: expect.objectContaining({ count: 2500, completed: true }) }),
    ]);
    noPersonalData(entries);
  });

  it('stream interrompido também audita', async () => {
    const { r } = repo(rowsOf(10));
    const { entries, a } = auditRepo();
    const file = await new ExportPlatformSaverContactsUseCase(r, a).execute({ actor: SUPER });
    for await (const l of file.lines) if (l.includes('Pessoa 2')) break;
    expect(entries[0]?.meta).toMatchObject({ completed: false, count: 3 });
  });
});
