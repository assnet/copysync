import { describe, expect, it, vi } from 'vitest';
import { RequestSaverExtractionUseCase } from './RequestSaverExtractionUseCase';
import { GetSaverExtractionUseCase } from './GetSaverExtractionUseCase';
import { CancelSaverExtractionUseCase } from './CancelSaverExtractionUseCase';
import { RemoveSaverGroupUseCase } from './RemoveSaverGroupUseCase';
import { ListSaverGroupsUseCase } from './ListSaverGroupsUseCase';
import { actorOf, savedGroup, sessionRef } from './saverUseCaseFakes';
import type { SaverExtraction, SaverGroup } from '../../domain/entities/SaverEntities';
import type {
  EnqueueSaverExtractionInput,
  RequestSaverGroupsInput,
  SaverRequestUsage,
} from '../../domain/contracts/ISaverExtractionQueue';
import type { SaverGroupUpsertInput } from '../../domain/contracts/ISaverGroupRepository';
import { SaverExtractionStatus, SaverExtractionTrigger } from '../../domain/enums/SaverEnums';

const NOW = new Date('2026-11-17T12:00:00Z');

/** Grupos e fila em memória, só com o que os use cases usam. */
function world(snapshot: Record<string, unknown>, opts: { scansUsed?: number; hasProduct?: boolean } = {}) {
  const groups: SaverGroup[] = [];
  const pending = new Set<string>();
  let seq = 0;
  const groupRepo = {
    findByJids: vi.fn(async (t: string, jids: readonly string[]) => groups.filter((g) => g.tenantId === t && jids.includes(g.groupJid))),
    countActive: vi.fn(async (t: string) => groups.filter((g) => g.tenantId === t && !g.removedAt).length),
    upsertMany: vi.fn(async (t: string, sessionId: string, input: readonly SaverGroupUpsertInput[]) =>
      input.map((i) => {
        let g = groups.find((x) => x.tenantId === t && x.groupJid === i.groupJid);
        if (!g) groups.push((g = savedGroup({ id: `g${++seq}`, tenantId: t, sessionId, groupJid: i.groupJid, name: i.name })));
        g.removedAt = null;
        g.name = i.name;
        return g;
      }),
    ),
    findById: vi.fn(async (t: string, id: string) => groups.find((g) => g.tenantId === t && g.id === id) ?? null),
    markRemoved: vi.fn(async (t: string, id: string, at: Date) => {
      const g = groups.find((x) => x.tenantId === t && x.id === id);
      if (g && !g.removedAt) g.removedAt = at;
    }),
    listActive: vi.fn(async (t: string) => groups.filter((g) => g.tenantId === t && !g.removedAt)),
  };
  const extraction = (over: Partial<SaverExtraction> = {}): SaverExtraction => ({
    id: 'e1', tenantId: 't1', sessionId: 's1', requestedByUserId: 'u1', trigger: SaverExtractionTrigger.MANUAL,
    status: SaverExtractionStatus.QUEUED, totalGroups: 0, doneGroups: 0, failedGroups: 0, membersFound: 0,
    newContacts: 0, createdAt: NOW, finishedAt: null, ...over,
  });
  const enqueue = vi.fn(async (input: EnqueueSaverExtractionInput) => {
    const fresh = [...new Set(input.groupIds)].filter((id) => !pending.has(id));
    fresh.forEach((id) => pending.add(id));
    return extraction({ totalGroups: fresh.length, status: fresh.length ? SaverExtractionStatus.QUEUED : SaverExtractionStatus.CANCELLED });
  });
  const queue = {
    enqueue,
    /** Mesma ordem do repositório: uso → guard → grava grupos → enfileira. */
    requestGroups: vi.fn(async (input: RequestSaverGroupsInput, guard: (u: SaverRequestUsage) => void) => {
      const jids = input.groups.map((g) => g.groupJid);
      const active = groups.filter((g) => g.tenantId === input.tenantId && !g.removedAt);
      guard({
        activeCount: active.length,
        activeRequested: active.filter((g) => jids.includes(g.groupJid)).length,
        scansUsed: opts.scansUsed ?? 0,
      });
      const saved = await groupRepo.upsertMany(
        input.tenantId,
        input.sessionId,
        input.groups.map((g) => ({ groupJid: g.groupJid, name: g.name || groups.find((x) => x.groupJid === g.groupJid)?.name || g.groupJid })),
      );
      return enqueue({ ...input, trigger: SaverExtractionTrigger.MANUAL, groupIds: saved.map((g) => g.id) });
    }),
    findExtraction: vi.fn(async (t: string, id: string) => (t === 't1' && id === 'e1' ? extraction({ totalGroups: 2 }) : null)),
    cancelQueued: vi.fn(async () => 2),
    cancelPendingByGroup: vi.fn(async (_t: string, id: string) => (pending.delete(id) ? 1 : 0)),
  };
  const engine = {
    listParticipatingGroups: vi.fn(async () => [
      { groupJid: '111@g.us', name: 'Um' },
      { groupJid: '222', name: 'Dois' },
      { groupJid: '333', name: null },
    ]),
  };
  const request = new RequestSaverExtractionUseCase({
    sessions: { findById: async (t) => (t === 't1' ? sessionRef() : null) },
    entitlements: { readAll: async () => snapshot },
    products: { has: async () => opts.hasProduct ?? true },
    queue,
    engine: () => engine,
    now: () => NOW,
  });
  const remove = new RemoveSaverGroupUseCase({ groups: groupRepo, queue, now: () => NOW });
  return { groups, groupRepo, queue, pending, request, remove };
}

const ADMIN = actorOf('ADMIN');
const OPERATOR = actorOf('OPERATOR');
const ROOT = actorOf('SUPER_ADMIN');

describe('RequestSaverExtractionUseCase — SAVER-47 (piloto do super admin)', () => {
  it('super admin sem o produto pede leitura com os limites do SAVER_MAX', async () => {
    const w = world({}, { hasProduct: false, scansUsed: 499 });
    const r = await w.request.execute(ROOT, { sessionId: 's1', groupJids: ['111'] });
    expect(r.totalGroups).toBe(1);
    // teto diário do MAX (500) segue valendo no piloto
    await expect(world({}, { hasProduct: false, scansUsed: 500 }).request.execute(ROOT, { sessionId: 's1', groupJids: ['111'] }))
      .rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'saver_group_scans_per_day', limit: 500 } });
  });

  it('super admin com o produto LITE respeita o LITE', async () => {
    const w = world({ saver_groups: 1, saver_group_scans_per_day: 20 }, { hasProduct: true });
    await expect(w.request.execute(ROOT, { sessionId: 's1', groupJids: ['111', '222'] }))
      .rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'saver_groups', limit: 1 } });
  });

  it('ADMIN sem plano continua com limite 0', async () => {
    const w = world({}, { hasProduct: false });
    await expect(w.request.execute(ADMIN, { sessionId: 's1', groupJids: ['111'] })).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
  });
});

describe('RequestSaverExtractionUseCase', () => {
  it('salva grupos (JID sem @g.us, nome do engine) e enfileira MANUAL', async () => {
    const w = world({ saver_groups: 5, saver_group_scans_per_day: 10 });
    const r = await w.request.execute(OPERATOR, { sessionId: 's1', groupJids: ['111@g.us', '333', '111'] });
    expect(w.queue.requestGroups).toHaveBeenCalledWith(
      expect.objectContaining({
        groups: [{ groupJid: '111', name: 'Um' }, { groupJid: '333', name: null }],
        scansSince: new Date(NOW.getTime() - 24 * 3_600_000),
      }),
      expect.any(Function),
    );
    expect(w.groupRepo.upsertMany).toHaveBeenCalledWith('t1', 's1', [
      { groupJid: '111', name: 'Um' },
      { groupJid: '333', name: '333' },
    ]);
    expect(w.queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 't1', sessionId: 's1', requestedByUserId: 'u1', trigger: 'MANUAL', groupIds: ['g1', 'g2'], now: NOW,
    }));
    expect(r.totalGroups).toBe(2);
  });

  it('limite de grupos barra antes de gravar', async () => {
    const w = world({ saver_groups: 1, saver_group_scans_per_day: null });
    await expect(w.request.execute(ADMIN, { sessionId: 's1', groupJids: ['111', '222'] }))
      .rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'saver_groups', limit: 1 } });
    expect(w.groupRepo.upsertMany).not.toHaveBeenCalled();
    expect(w.queue.enqueue).not.toHaveBeenCalled();
  });

  it('chave ausente = 0: nenhum grupo cabe', async () => {
    const w = world({});
    await expect(w.request.execute(ADMIN, { sessionId: 's1', groupJids: ['111'] })).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
  });

  it('limite diário barra antes de gravar', async () => {
    const w = world({ saver_groups: null, saver_group_scans_per_day: 3 }, { scansUsed: 2 });
    await expect(w.request.execute(ADMIN, { sessionId: 's1', groupJids: ['111', '222'] }))
      .rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'saver_group_scans_per_day', limit: 3 } });
    expect(w.groupRepo.upsertMany).not.toHaveBeenCalled();
    expect(w.queue.enqueue).not.toHaveBeenCalled();
  });

  it('grupo já salvo não conta de novo no limite de grupos; pendente não duplica', async () => {
    const w = world({ saver_groups: 1, saver_group_scans_per_day: null });
    await w.request.execute(ADMIN, { sessionId: 's1', groupJids: ['111'] });
    const again = await w.request.execute(ADMIN, { sessionId: 's1', groupJids: ['111'] });
    expect(again.totalGroups).toBe(0);
    expect(w.pending.size).toBe(1);
  });

  it('grupo fora da sessão, lista vazia ou > 50 → VALIDATION_ERROR', async () => {
    const w = world({ saver_groups: null, saver_group_scans_per_day: null });
    await expect(w.request.execute(ADMIN, { sessionId: 's1', groupJids: ['999'] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(w.request.execute(ADMIN, { sessionId: 's1', groupJids: [] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const many = Array.from({ length: 51 }, (_, i) => String(i));
    await expect(w.request.execute(ADMIN, { sessionId: 's1', groupJids: many })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('sessão de outro tenant → SESSION_NOT_FOUND', async () => {
    const w = world({ saver_groups: null, saver_group_scans_per_day: null });
    await expect(w.request.execute(actorOf('ADMIN', 't2'), { sessionId: 's1', groupJids: ['111'] }))
      .rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
  });
});

describe('RemoveSaverGroupUseCase', () => {
  it('OPERATOR não remove', async () => {
    const w = world({ saver_groups: 1, saver_group_scans_per_day: null });
    await w.request.execute(ADMIN, { sessionId: 's1', groupJids: ['111'] });
    await expect(w.remove.execute(OPERATOR, { groupId: 'g1' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(w.groupRepo.markRemoved).not.toHaveBeenCalled();
  });

  it('marca removedAt, cancela pendentes, libera o limite e extrair de novo reativa', async () => {
    const w = world({ saver_groups: 1, saver_group_scans_per_day: null });
    await w.request.execute(ADMIN, { sessionId: 's1', groupJids: ['111'] });
    await w.remove.execute(ADMIN, { groupId: 'g1' });
    expect(w.queue.cancelPendingByGroup).toHaveBeenCalledWith('t1', 'g1', NOW);
    expect(w.groups[0]).toMatchObject({ id: 'g1', removedAt: NOW });
    expect(w.groups).toHaveLength(1);
    // Vaga liberada: outro grupo cabe…
    await w.request.execute(ADMIN, { sessionId: 's1', groupJids: ['222'] });
    await w.remove.execute(ADMIN, { groupId: 'g2' });
    // …e o removido volta (mesma linha, reativada).
    await w.request.execute(ADMIN, { sessionId: 's1', groupJids: ['111'] });
    expect(w.groups.find((g) => g.id === 'g1')?.removedAt).toBeNull();
  });

  it('grupo removido ou de outro tenant → NOT_FOUND', async () => {
    const w = world({ saver_groups: 1, saver_group_scans_per_day: null });
    await w.request.execute(ADMIN, { sessionId: 's1', groupJids: ['111'] });
    await expect(w.remove.execute(actorOf('ADMIN', 't2'), { groupId: 'g1' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await w.remove.execute(ADMIN, { groupId: 'g1' });
    await expect(w.remove.execute(ADMIN, { groupId: 'g1' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('Get/Cancel extração e lista de grupos', () => {
  it('progresso e cancelamento do tenant; outro tenant → NOT_FOUND', async () => {
    const w = world({});
    const get = new GetSaverExtractionUseCase({ queue: w.queue });
    const cancel = new CancelSaverExtractionUseCase({ queue: w.queue, now: () => NOW });
    expect((await get.execute(OPERATOR, { extractionId: 'e1' })).totalGroups).toBe(2);
    await expect(get.execute(actorOf('ADMIN', 't2'), { extractionId: 'e1' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const r = await cancel.execute(OPERATOR, { extractionId: 'e1' });
    expect(r.cancelledItems).toBe(2);
    expect(w.queue.cancelQueued).toHaveBeenCalledWith('t1', 'e1', NOW);
    await expect(cancel.execute(actorOf('ADMIN', 't2'), { extractionId: 'e1' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lista de grupos devolve só contagens (sem contato)', async () => {
    const w = world({});
    w.groups.push(savedGroup({ memberCount: 10, phoneCount: 7, lidOnlyCount: 3 }), savedGroup({ id: 'gx', removedAt: NOW }));
    const list = await new ListSaverGroupsUseCase({ groups: w.groupRepo }).execute(OPERATOR);
    expect(list).toHaveLength(1);
    expect(Object.keys(list[0]!).sort()).toEqual([
      'createdAt', 'groupJid', 'id', 'lastScanStatus', 'lastScannedAt', 'lidOnlyCount', 'memberCount', 'name', 'phoneCount', 'sessionId',
    ]);
    expect(list[0]).toMatchObject({ memberCount: 10, phoneCount: 7, lidOnlyCount: 3 });
  });
});
