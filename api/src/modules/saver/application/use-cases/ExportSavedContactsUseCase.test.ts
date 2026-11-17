import { describe, expect, it, vi } from 'vitest';
import type { CreateAuditLogInput } from '../../../../shared/audit/IAuditLogRepository';
import type { ISaverGroupRepository } from '../../domain/contracts/ISaverGroupRepository';
import type {
  ISaverMembershipRepository,
  SaverMembershipExportCount,
  SaverMembershipExportRow,
} from '../../domain/contracts/ISaverMembershipRepository';
import type { SaverGroup } from '../../domain/entities/SaverEntities';
import { SaverExportFormat } from '../../domain/enums/SaverEnums';
import type { SaverTenantActor } from '../saverTenantActor';
import { ExportSavedContactsUseCase } from './ExportSavedContactsUseCase';

const ADMIN: SaverTenantActor = { tenantId: 't1', userId: 'a1', role: 'ADMIN' };
const OPERATOR: SaverTenantActor = { tenantId: 't1', userId: 'o1', role: 'OPERATOR' };
const at = new Date('2026-11-17T15:30:00Z');

const group = (id: string): SaverGroup => ({
  id, tenantId: 't1', sessionId: 's1', groupJid: `${id}@g.us`, name: id, memberCount: 0, phoneCount: 0,
  lidOnlyCount: 0, lastScannedAt: null, lastScanStatus: null, createdAt: at, removedAt: null,
});

const row = (i: number, over: Partial<SaverMembershipExportRow> = {}): SaverMembershipExportRow => ({
  contactId: `c${i}`, name: `Vinculo ${i}`, phone: `5511900${String(i).padStart(6, '0')}`, lid: null,
  isAdmin: false, active: true, extractedAt: at, groupName: null, ...over,
});

function setup(opts: {
  rows?: SaverMembershipExportRow[][] | (() => AsyncIterable<SaverMembershipExportRow[]>);
  count?: SaverMembershipExportCount;
  grant?: boolean;
} = {}) {
  const groups: ISaverGroupRepository = {
    listActive: vi.fn(async (tenantId) => (tenantId === 't1' ? [group('g1'), group('g2')] : [group('gX')])),
    findById: vi.fn(), findByJids: vi.fn(), upsertMany: vi.fn(), recordScan: vi.fn(), countActive: vi.fn(), markRemoved: vi.fn(),
  };
  const batches = opts.rows ?? [[row(1), row(2, { phone: null, lid: '999' })]];
  const memberships: ISaverMembershipRepository = {
    listGroupMemberships: vi.fn(), countDistinctContacts: vi.fn(), countContactsWithoutTenantLink: vi.fn(),
    countForExport: vi.fn(async () => opts.count ?? { total: 2, withPhone: 1, lidOnly: 1 }),
    exportBatches: vi.fn((): AsyncIterable<SaverMembershipExportRow[]> => {
      if (typeof batches === 'function') return batches();
      return (async function* () { yield* batches; })();
    }),
  };
  const state = { grant: opts.grant ?? false };
  const grants = { hasGrant: vi.fn(async () => state.grant) };
  const entries: CreateAuditLogInput[] = [];
  const audit = { create: vi.fn(async (e: CreateAuditLogInput) => void entries.push(e)) };
  const uc = new ExportSavedContactsUseCase(groups, memberships, grants, audit, () => at);
  return { uc, memberships, grants, entries, state };
}

async function collect(it: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const l of it) out.push(l);
  return out;
}

describe('ExportSavedContactsUseCase', () => {
  it('CSV com nome do vínculo, só-LID com telefone vazio e auditoria sem dado pessoal', async () => {
    const { uc, memberships, entries } = setup();
    const file = await uc.execute({ actor: ADMIN, format: SaverExportFormat.CSV, groupIds: ['g1'], options: { prefix: ' VIP ' } });
    expect(file).toMatchObject({ fileName: 'contatos-2026-11-17.csv', total: 2, skippedWithoutPhone: 0 });
    expect(entries).toHaveLength(1); // antes do primeiro byte
    const lines = await collect(file.lines);
    expect(lines[0]).toMatch(/^﻿Nome,Telefone,LID,Extraído em\r\n$/);
    expect(lines[1]).toBe('VIP Vinculo 1,5511900000001,,17/11/2026 12:30\r\n');
    expect(lines[2]).toBe('VIP Vinculo 2,,999,17/11/2026 12:30\r\n');
    expect(memberships.countForExport).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', groupIds: ['g1'] }));
    expect(entries[0]).toMatchObject({ tenantId: 't1', userId: 'a1', action: 'SAVER_EXPORTED', meta: { format: 'CSV', count: 2 } });
    expect(JSON.stringify(entries)).not.toMatch(/Vinculo|5511900|999|VIP/);
  });

  it('vCard deixa só-LID fora e informa quantos', async () => {
    const { uc } = setup();
    const file = await uc.execute({ actor: ADMIN, format: SaverExportFormat.VCARD, groupIds: 'all' });
    expect(file).toMatchObject({ fileName: 'contatos-2026-11-17.vcf', total: 1, skippedWithoutPhone: 1 });
    const lines = await collect(file.lines);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('TEL;TYPE=CELL:+5511900000001');
  });

  it('grupo de outro tenant ou removido → não encontrado, sem contar nem auditar', async () => {
    const { uc, memberships, entries } = setup();
    await expect(uc.execute({ actor: ADMIN, format: SaverExportFormat.CSV, groupIds: ['g1', 'gX'] })).rejects.toMatchObject({ statusCode: 404 });
    expect(memberships.countForExport).not.toHaveBeenCalled();
    expect(entries).toHaveLength(0);
  });

  it('OPERATOR: sem liberação 403; com liberação exporta; revogada 403 na chamada seguinte', async () => {
    const { uc, state, grants } = setup();
    const cmd = { actor: OPERATOR, format: SaverExportFormat.CSV, groupIds: ['g1'] } as const;
    await expect(uc.execute(cmd)).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    state.grant = true;
    await expect(uc.execute(cmd)).resolves.toMatchObject({ total: 2 });
    state.grant = false;
    await expect(uc.execute(cmd)).rejects.toMatchObject({ statusCode: 403 });
    expect(grants.hasGrant).toHaveBeenCalledWith('t1', 'o1');
  });

  it('vazio → 422 antes do primeiro byte (vCard sem número também)', async () => {
    const empty = setup({ count: { total: 0, withPhone: 0, lidOnly: 0 } });
    await expect(empty.uc.execute({ actor: ADMIN, format: SaverExportFormat.CSV, groupIds: ['g1'] })).rejects.toMatchObject({ statusCode: 422 });
    expect(empty.memberships.exportBatches).not.toHaveBeenCalled();
    const onlyLid = setup({ count: { total: 3, withPhone: 0, lidOnly: 3 } });
    await expect(onlyLid.uc.execute({ actor: ADMIN, format: SaverExportFormat.VCARD, groupIds: ['g1'] })).rejects.toMatchObject({ statusCode: 422, code: 'SAVER_EXPORT_EMPTY' });
    expect(onlyLid.entries).toHaveLength(0);
  });

  it('120 mil linhas por lote, sem montar tudo em memória', async () => {
    let produced = 0;
    let maxAhead = 0;
    let consumedRows = 0;
    const lazyBatches = () => (async function* () {
      for (let b = 0; b < 120; b++) {
        produced++;
        maxAhead = Math.max(maxAhead, produced * 1000 - consumedRows);
        yield Array.from({ length: 1000 }, (_, i) => row(b * 1000 + i));
      }
    })();
    const { uc } = setup({ rows: lazyBatches, count: { total: 120_000, withPhone: 120_000, lidOnly: 0 } });
    const file = await uc.execute({ actor: ADMIN, format: SaverExportFormat.CSV, groupIds: 'all' });
    expect(produced).toBe(0);
    let lines = 0;
    for await (const l of file.lines) {
      lines++;
      if (l.includes(',5511900')) consumedRows++;
    }
    expect(lines).toBe(120_001);
    expect(produced).toBe(120);
    expect(maxAhead).toBeLessThanOrEqual(1000);
  });

  it('formato inválido e prefixo longo → 400', async () => {
    const { uc } = setup();
    await expect(uc.execute({ actor: ADMIN, format: 'XLSX' as SaverExportFormat, groupIds: ['g1'] })).rejects.toMatchObject({ statusCode: 400 });
    await expect(uc.execute({ actor: ADMIN, format: SaverExportFormat.CSV, groupIds: ['g1'], options: { prefix: 'x'.repeat(41) } })).rejects.toMatchObject({ statusCode: 400 });
  });
});
