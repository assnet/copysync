import { describe, expect, it, vi } from 'vitest';
import type { CreateAuditLogInput } from '../../../../shared/audit/IAuditLogRepository';
import type { ISaverConfigRepository } from '../../domain/contracts/ISaverConfigRepository';
import type { ISaverExportGrantRepository } from '../../domain/contracts/ISaverExportGrantRepository';
import type { ISaverTeamReader, SaverTeamMember } from '../../domain/contracts/ISaverTeamReader';
import type { SaverConfig } from '../../domain/entities/SaverEntities';
import { SaverExportFormat } from '../../domain/enums/SaverEnums';
import type { SaverActor } from './saverActor';
import {
  GetSaverConfigUseCase,
  ListSaverExportGrantsUseCase,
  SetSaverExportGrantUseCase,
  UpdateSaverConfigUseCase,
} from './SaverConfigUseCases';

const ADMIN: SaverActor = { tenantId: 't1', userId: 'a1', role: 'ADMIN' };
const OPERATOR: SaverActor = { tenantId: 't1', userId: 'o1', role: 'OPERATOR' };
const at = new Date('2026-11-17T12:00:00Z');

function configRepo(initial: SaverConfig | null = null) {
  let row = initial;
  const r: ISaverConfigRepository = {
    findByTenant: vi.fn(async () => row),
    upsert: vi.fn(async (tenantId: string, update: Partial<SaverConfig>): Promise<SaverConfig> => {
      const next: SaverConfig = {
        tenantId, namePrefix: null, excludeAdminsByDefault: false, defaultFormat: SaverExportFormat.CSV, autoRefresh: false,
        ...row, ...update, updatedAt: at,
      };
      row = next;
      return next;
    }),
  };
  return r;
}
const snapshot = (s: Record<string, unknown>) => ({ readAll: vi.fn(async () => s) });

describe('GetSaverConfigUseCase / UpdateSaverConfigUseCase', () => {
  it('tenant sem linha devolve os padrões', async () => {
    const out = await new GetSaverConfigUseCase(configRepo(), snapshot({})).execute(ADMIN);
    expect(out).toEqual({
      namePrefix: null, excludeAdminsByDefault: false, defaultFormat: 'CSV', autoRefresh: false,
      autoRefreshAvailable: false, configured: false, updatedAt: null,
    });
  });

  it('OPERATOR → 403 ao salvar, sem gravar', async () => {
    const repo = configRepo();
    await expect(new UpdateSaverConfigUseCase(repo, snapshot({})).execute({ actor: OPERATOR, namePrefix: 'x' })).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('autoRefresh sem entitlement → PLAN_FEATURE_UNAVAILABLE; com entitlement salva', async () => {
    const repo = configRepo();
    await expect(new UpdateSaverConfigUseCase(repo, snapshot({})).execute({ actor: ADMIN, autoRefresh: true })).rejects.toMatchObject({
      code: 'PLAN_FEATURE_UNAVAILABLE', meta: { key: 'saver_auto_refresh_enabled' },
    });
    expect(repo.upsert).not.toHaveBeenCalled();
    const out = await new UpdateSaverConfigUseCase(repo, snapshot({ saver_auto_refresh_enabled: true })).execute({
      actor: ADMIN, autoRefresh: true, namePrefix: '  Cliente ', defaultFormat: SaverExportFormat.VCARD,
    });
    expect(out).toMatchObject({ autoRefresh: true, namePrefix: 'Cliente', defaultFormat: 'VCARD', configured: true, autoRefreshAvailable: true });
  });

  it('desligar autoRefresh sem entitlement é permitido; formato inválido → 400', async () => {
    const repo = configRepo();
    await expect(new UpdateSaverConfigUseCase(repo, snapshot({})).execute({ actor: ADMIN, autoRefresh: false })).resolves.toMatchObject({ autoRefresh: false });
    await expect(new UpdateSaverConfigUseCase(repo, snapshot({})).execute({ actor: ADMIN, defaultFormat: 'PDF' as SaverExportFormat })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('ListSaverExportGrantsUseCase / SetSaverExportGrantUseCase', () => {
  const members: Record<string, SaverTeamMember[]> = {
    t1: [
      { userId: 'a1', role: 'ADMIN', name: 'Ana', email: 'ana@x.com' },
      { userId: 'o1', role: 'OPERATOR', name: 'Otto', email: 'otto@x.com' },
      { userId: 'o2', role: 'OPERATOR', name: 'Olga', email: 'olga@x.com' },
    ],
    t2: [{ userId: 'z9', role: 'OPERATOR', name: 'Zeca', email: 'z@x.com' }],
  };
  const team: ISaverTeamReader = {
    listMembers: vi.fn(async (t) => members[t] ?? []),
    findMember: vi.fn(async (t, u) => (members[t] ?? []).find((m) => m.userId === u) ?? null),
  };

  function setup() {
    const rows: { tenantId: string; userId: string }[] = [];
    const grants: ISaverExportGrantRepository = {
      hasGrant: vi.fn(async (t, u) => rows.some((r) => r.tenantId === t && r.userId === u)),
      listByTenant: vi.fn(async (t) => rows.filter((r) => r.tenantId === t).map((r, i) => ({ id: `g${i}`, ...r, grantedByUserId: null, createdAt: at }))),
      grant: vi.fn(async (t, u) => { if (!rows.some((r) => r.tenantId === t && r.userId === u)) rows.push({ tenantId: t, userId: u }); }),
      revoke: vi.fn(async (t, u) => { const i = rows.findIndex((r) => r.tenantId === t && r.userId === u); if (i >= 0) rows.splice(i, 1); }),
    };
    const entries: CreateAuditLogInput[] = [];
    const audit = { create: vi.fn(async (e: CreateAuditLogInput) => void entries.push(e)) };
    return { rows, grants, entries, set: new SetSaverExportGrantUseCase(team, grants, audit), list: new ListSaverExportGrantsUseCase(team, grants) };
  }

  it('lista só operadores com o estado', async () => {
    const { set, list } = setup();
    await set.execute({ actor: ADMIN, targetUserId: 'o2', canExport: true });
    expect(await list.execute(ADMIN)).toEqual([
      { userId: 'o1', name: 'Otto', email: 'otto@x.com', canExport: false },
      { userId: 'o2', name: 'Olga', email: 'olga@x.com', canExport: true },
    ]);
  });

  it('OPERATOR chamando → 403 (listar e liberar)', async () => {
    const { set, list, rows } = setup();
    await expect(set.execute({ actor: OPERATOR, targetUserId: 'o2', canExport: true })).rejects.toMatchObject({ statusCode: 403 });
    await expect(list.execute(OPERATOR)).rejects.toMatchObject({ statusCode: 403 });
    expect(rows).toHaveLength(0);
  });

  it('alvo de outro tenant → não encontrado; alvo ADMIN → recusado', async () => {
    const { set, rows } = setup();
    await expect(set.execute({ actor: ADMIN, targetUserId: 'z9', canExport: true })).rejects.toMatchObject({ statusCode: 404 });
    await expect(set.execute({ actor: ADMIN, targetUserId: 'a1', canExport: true })).rejects.toMatchObject({ statusCode: 400 });
    expect(rows).toHaveLength(0);
  });

  it('ligar duas vezes = 1 linha; auditoria só com ids', async () => {
    const { set, rows, entries } = setup();
    await set.execute({ actor: ADMIN, targetUserId: 'o1', canExport: true });
    await set.execute({ actor: ADMIN, targetUserId: 'o1', canExport: true });
    expect(rows).toHaveLength(1);
    await set.execute({ actor: ADMIN, targetUserId: 'o1', canExport: false });
    expect(rows).toHaveLength(0);
    expect(entries).toEqual([
      { tenantId: 't1', userId: 'a1', action: 'SAVER_PERMISSION_CHANGED', meta: { targetUserId: 'o1', permission: 'export', enabled: true } },
      { tenantId: 't1', userId: 'a1', action: 'SAVER_PERMISSION_CHANGED', meta: { targetUserId: 'o1', permission: 'export', enabled: false } },
    ]);
    expect(JSON.stringify(entries)).not.toMatch(/Otto|otto@/);
  });
});
