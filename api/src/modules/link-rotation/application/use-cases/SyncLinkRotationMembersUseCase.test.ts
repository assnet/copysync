import { describe, expect, it } from 'vitest';
import type {
  ApplyMemberCountInput,
  ILinkRotationMemberSyncStore,
  MemberSyncDueGroup,
  MemberSyncDueQuery,
} from '../../domain/contracts/ILinkRotationMemberSyncStore';
import type { ILinkRotationJobLease } from '../../domain/contracts/ILinkRotationJobLease';
import { LinkRotationGroupStatus as S } from '../../domain/enums/LinkRotationEnums';
import { SessionNotConnectedError } from '../../../../shared/errors/internal/SessionErrors';
import { SyncLinkRotationMembersUseCase } from './SyncLinkRotationMembersUseCase';
import { LINK_CLICK_RETENTION_LEASE, PurgeExpiredLinkClicksUseCase } from './PurgeExpiredLinkClicksUseCase';

const NOW = new Date('2026-10-29T12:00:00.000Z');
const minAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

interface Row extends MemberSyncDueGroup {
  memberCount: number | null;
  memberCountAt: Date | null;
}

const row = (id: string, over: Partial<Row> = {}): Row => ({
  id, tenantId: 't1', rotationId: 'r1', sessionId: 's1', groupJid: `jid-${id}`, capacity: 100,
  status: S.ACTIVE, clicksSinceSync: 0, memberCount: null, memberCountAt: null, ...over,
});

/** Espelho em memória do critério de vencido do Prisma (o int test cobre o SQL). */
class FakeStore implements ILinkRotationMemberSyncStore {
  writes: string[] = [];
  constructor(public rows: Row[]) {}
  async listDue(q: MemberSyncDueQuery): Promise<MemberSyncDueGroup[]> {
    return this.rows
      .filter((r) => [S.ACTIVE, S.FULL].includes(r.status))
      .filter((r) => !r.memberCountAt || r.memberCountAt < q.staleBefore
        || (r.clicksSinceSync >= q.clickBurst && r.memberCountAt < q.burstBefore))
      .slice(0, q.limit)
      .map((r) => ({ ...r }));
  }
  async applyMemberCount(i: ApplyMemberCountInput): Promise<void> {
    const r = this.rows.find((x) => x.id === i.groupId && x.tenantId === i.tenantId)!;
    Object.assign(r, {
      memberCount: i.memberCount, memberCountAt: i.at,
      clicksSinceSync: Math.max(0, r.clicksSinceSync - i.clicksSeen), status: i.status,
    });
    this.writes.push(i.groupId);
  }
  async markAttempt(tenantId: string, groupId: string, at: Date): Promise<void> {
    this.rows.find((x) => x.id === groupId)!.memberCountAt = at;
    this.writes.push(`attempt:${groupId}`);
  }
}

function engine(members: Record<string, number | Error>) {
  const calls: string[] = [];
  return {
    calls,
    getGroupSummary: async (sessionId: string, jid: string) => {
      calls.push(jid);
      const v = members[jid];
      if (v instanceof Error) throw v;
      return { name: 'g', memberCount: v ?? 0, isSelfAdmin: true };
    },
  };
}

const run = (store: FakeStore, eng: ReturnType<typeof engine>, now = NOW) =>
  new SyncLinkRotationMembersUseCase({ store, engine: eng, now: () => now }).execute();

describe('SyncLinkRotationMembersUseCase', () => {
  it('lê só vencidos: nulo, > 15 min, ou ≥ 25 cliques com leitura > 2 min', async () => {
    const store = new FakeStore([
      row('nunca'),
      row('velho', { memberCountAt: minAgo(16) }),
      row('fresco', { memberCountAt: minAgo(5) }),
      row('rajada', { memberCountAt: minAgo(3), clicksSinceSync: 25 }),
      row('pausado', { status: S.PAUSED }),
      row('semlink', { status: S.NEEDS_LINK }),
    ]);
    const eng = engine({});
    await run(store, eng);
    expect(eng.calls.sort()).toEqual(['jid-nunca', 'jid-rajada', 'jid-velho']);
  });

  it('teto: rajada de cliques não lê antes de 2 min, e grupo lido não volta no tick seguinte', async () => {
    const store = new FakeStore([row('a', { memberCountAt: minAgo(1), clicksSinceSync: 80 })]);
    const eng = engine({ 'jid-a': 10 });
    await run(store, eng);
    expect(eng.calls).toEqual([]);
    await run(store, eng, new Date(NOW.getTime() + 2 * 60_000));
    expect(eng.calls).toEqual(['jid-a']);
    await run(store, eng, new Date(NOW.getTime() + 3 * 60_000));
    expect(eng.calls).toHaveLength(1);
  });

  it('grava contagem, horário e zera clicksSinceSync; FULL ↔ ACTIVE pelo teto', async () => {
    const store = new FakeStore([
      row('enche', { clicksSinceSync: 30 }),
      row('esvazia', { status: S.FULL, memberCountAt: minAgo(20) }),
      row('igual', { capacity: 50 }),
    ]);
    await run(store, engine({ 'jid-enche': 100, 'jid-esvazia': 99, 'jid-igual': 50 }));
    const by = Object.fromEntries(store.rows.map((r) => [r.id, r]));
    expect(by['enche']).toMatchObject({ status: S.FULL, memberCount: 100, memberCountAt: NOW, clicksSinceSync: 0 });
    expect(by['esvazia']).toMatchObject({ status: S.ACTIVE, memberCount: 99 });
    expect(by['igual']!.status).toBe(S.FULL);
  });

  it('sessão desconectada: pula o grupo e o resto da sessão sem gravar; outra sessão segue', async () => {
    const store = new FakeStore([
      row('a'), row('b'), row('c', { sessionId: 's2' }),
    ]);
    const eng = engine({ 'jid-a': new SessionNotConnectedError('s1'), 'jid-c': 5 });
    const result = await run(store, eng);
    expect(eng.calls).toEqual(['jid-a', 'jid-c']);
    expect(store.writes).toEqual(['c']);
    expect(store.rows[0]!.memberCountAt).toBeNull();
    expect(result).toMatchObject({ synced: 1, skipped: 2, failed: 0 });
  });

  it('erro em um grupo não derruba os outros e marca a tentativa (teto de 15 min)', async () => {
    const store = new FakeStore([row('a'), row('b')]);
    const result = await run(store, engine({ 'jid-a': new Error('boom'), 'jid-b': 7 }));
    expect(store.writes).toEqual(['attempt:a', 'b']);
    expect(store.rows[0]!.memberCountAt).toEqual(NOW);
    expect(store.rows[0]!.memberCount).toBeNull();
    expect(result).toMatchObject({ synced: 1, failed: 1 });
  });

  it('lote limitado e agrupado por sessão', async () => {
    const store = new FakeStore([
      row('a', { sessionId: 's1' }), row('b', { sessionId: 's2' }), row('c', { sessionId: 's1' }),
      row('d', { sessionId: 's3' }),
    ]);
    const eng = engine({});
    await new SyncLinkRotationMembersUseCase({ store, engine: eng, now: () => NOW, batchSize: 3 }).execute();
    expect(eng.calls).toEqual(['jid-a', 'jid-c', 'jid-b']);
  });
});

class FakeLease implements ILinkRotationJobLease {
  leases = new Map<string, { owner: string; until: Date }>();
  async tryAcquire(name: string, owner: string, until: Date, now: Date): Promise<boolean> {
    const cur = this.leases.get(name);
    if (cur && cur.until >= now) return false;
    this.leases.set(name, { owner, until });
    return true;
  }
  async release(name: string, owner: string): Promise<void> {
    if (this.leases.get(name)?.owner === owner) this.leases.delete(name);
  }
}

describe('PurgeExpiredLinkClicksUseCase', () => {
  it('apaga cliques > 90 dias no máximo 1×/hora, mesmo entre processos', async () => {
    const lease = new FakeLease();
    const cutoffs: Date[] = [];
    const clicks = { deleteOlderThan: async (c: Date) => (cutoffs.push(c), 3) };
    let now = NOW;
    const a = new PurgeExpiredLinkClicksUseCase({ clicks, lease, now: () => now });
    const b = new PurgeExpiredLinkClicksUseCase({ clicks, lease, now: () => now });

    expect(await a.execute()).toEqual({ processed: 3 });
    expect(cutoffs[0]).toEqual(new Date(NOW.getTime() - 90 * 86_400_000));
    now = new Date(NOW.getTime() + 30 * 60_000);
    expect(await a.execute()).toEqual({ processed: 0 });
    expect(await b.execute()).toEqual({ processed: 0 });
    now = new Date(NOW.getTime() + 61 * 60_000);
    expect(await b.execute()).toEqual({ processed: 3 });
    expect(cutoffs).toHaveLength(2);
    expect(lease.leases.has(LINK_CLICK_RETENTION_LEASE)).toBe(true);
  });
});
