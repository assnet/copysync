import { describe, expect, it } from 'vitest';
import { ApplyPlanLimitsToLinkRotationsUseCase } from './ApplyPlanLimitsToLinkRotationsUseCase';
import { LinkRotationGroupStatus as G, LinkRotationStatus as R } from '../../domain/enums/LinkRotationEnums';
import type {
  ILinkRotationPlanEnforcementStore,
  PlanEnforcementGroup,
  PlanEnforcementRotation,
} from '../../domain/contracts/ILinkRotationPlanEnforcementStore';

/** Fake em memória; `tenantOf` garante que nada de outro tenant é tocado. */
function makeStore(rows: (PlanEnforcementRotation & { tenantId: string; sessionId: string })[]) {
  const store: ILinkRotationPlanEnforcementStore = {
    listForPlanLimits: async (t) => rows.filter((r) => r.tenantId === t).map((r) => ({ ...r, groups: r.groups.map((g) => ({ ...g })) })),
    setRotationStatuses: async (t, changes) => {
      for (const c of changes) { const r = rows.find((x) => x.id === c.id && x.tenantId === t); if (r) r.status = c.status; }
    },
    setGroupStatuses: async (t, changes) => {
      for (const c of changes) for (const r of rows.filter((x) => x.tenantId === t)) {
        const g = r.groups.find((x) => x.id === c.id); if (g) g.status = c.status;
      }
    },
    pauseBySession: async (t, s) => {
      let n = 0;
      for (const r of rows) if (r.tenantId === t && r.sessionId === s && r.status !== R.PAUSED) { r.status = R.PAUSED; n++; }
      return n;
    },
  };
  return { store, rows };
}

const grp = (id: string, position: number, over: Partial<PlanEnforcementGroup> = {}): PlanEnforcementGroup => ({
  id, position, status: G.ACTIVE, inviteCode: `c-${id}`, memberCount: 10, capacity: 1000, ...over,
});
const rot = (id: string, day: number, over: Partial<PlanEnforcementRotation & { sessionId: string }> = {}, tenantId = 't1') => ({
  id, tenantId, sessionId: 's1', status: R.ACTIVE, createdAt: new Date(Date.UTC(2026, 9, day)), groups: [] as PlanEnforcementGroup[], ...over,
});
const tenGroups = (prefix: string) => Array.from({ length: 10 }, (_, i) => grp(`${prefix}${i}`, i));

const STARTER = { linkRotations: 1, linkRotationGroups: 3 };
const BUSINESS = { linkRotations: 2, linkRotationGroups: 10 };
const UNLIMITED = { linkRotations: null, linkRotationGroups: null };

describe('ApplyPlanLimitsToLinkRotationsUseCase', () => {
  it('rebaixo Business→Starter: 2 rotações → 1 ativa (mais antiga) + 1 PAUSED_BY_PLAN; 10 grupos → 3', async () => {
    const { store, rows } = makeStore([rot('new', 5, { groups: tenGroups('n') }), rot('old', 1, { groups: tenGroups('o') })]);
    await new ApplyPlanLimitsToLinkRotationsUseCase(store).execute({ tenantId: 't1', limits: STARTER });
    expect(rows.find((r) => r.id === 'old')!.status).toBe(R.ACTIVE);
    expect(rows.find((r) => r.id === 'new')!.status).toBe(R.PAUSED_BY_PLAN);
    for (const r of rows) {
      expect(r.groups.filter((g) => g.status === G.ACTIVE).map((g) => g.position)).toEqual([0, 1, 2]);
      expect(r.groups.filter((g) => g.status === G.PAUSED_BY_PLAN)).toHaveLength(7);
    }
  });

  it('subida volta: PAUSED_BY_PLAN → ACTIVE e grupos ao status calculado (NEEDS_LINK / FULL / ACTIVE)', async () => {
    const groups = [
      grp('a', 0), grp('b', 1, { status: G.PAUSED_BY_PLAN, inviteCode: null }),
      grp('c', 2, { status: G.PAUSED_BY_PLAN, memberCount: 1000, capacity: 1000 }),
      grp('d', 3, { status: G.PAUSED_BY_PLAN }), grp('e', 4, { status: G.FULL, memberCount: 999, capacity: 50 }),
    ];
    const { store, rows } = makeStore([rot('old', 1, { groups }), rot('new', 5, { status: R.PAUSED_BY_PLAN })]);
    await new ApplyPlanLimitsToLinkRotationsUseCase(store).execute({ tenantId: 't1', limits: BUSINESS });
    expect(rows.map((r) => r.status)).toEqual([R.ACTIVE, R.ACTIVE]);
    expect(rows[0]!.groups.map((g) => g.status)).toEqual([G.ACTIVE, G.NEEDS_LINK, G.FULL, G.ACTIVE, G.FULL]);
  });

  it('pausa manual preservada: PAUSED não muda nem ocupa vaga; grupo PAUSED excedente fica PAUSED', async () => {
    const groups = [grp('a', 0), grp('b', 1, { status: G.PAUSED }), grp('c', 2, { status: G.PAUSED })];
    const { store, rows } = makeStore([
      rot('manual', 1, { status: R.PAUSED, groups }), rot('b', 2), rot('c', 3),
    ]);
    await new ApplyPlanLimitsToLinkRotationsUseCase(store).execute({ tenantId: 't1', limits: { linkRotations: 1, linkRotationGroups: 1 } });
    expect(rows.map((r) => r.status)).toEqual([R.PAUSED, R.ACTIVE, R.PAUSED_BY_PLAN]);
    expect(rows[0]!.groups.map((g) => g.status)).toEqual([G.ACTIVE, G.PAUSED, G.PAUSED]);
  });

  it('ilimitado (null) reativa tudo que estava PAUSED_BY_PLAN', async () => {
    const { store, rows } = makeStore([
      rot('a', 1, { groups: tenGroups('a').map((g, i) => (i >= 3 ? { ...g, status: G.PAUSED_BY_PLAN } : g)) }),
      rot('b', 2, { status: R.PAUSED_BY_PLAN }), rot('c', 3, { status: R.PAUSED_BY_PLAN }),
    ]);
    await new ApplyPlanLimitsToLinkRotationsUseCase(store).execute({ tenantId: 't1', limits: UNLIMITED });
    expect(rows.every((r) => r.status === R.ACTIVE)).toBe(true);
    expect(rows[0]!.groups.every((g) => g.status === G.ACTIVE)).toBe(true);
  });

  it('idempotente: 2ª execução não muda nada', async () => {
    const { store } = makeStore([rot('a', 1, { groups: tenGroups('a') }), rot('b', 2, { groups: tenGroups('b') })]);
    const uc = new ApplyPlanLimitsToLinkRotationsUseCase(store);
    const first = await uc.execute({ tenantId: 't1', limits: STARTER });
    expect(first).toEqual({ rotationsChanged: 1, groupsChanged: 14 });
    expect(await uc.execute({ tenantId: 't1', limits: STARTER })).toEqual({ rotationsChanged: 0, groupsChanged: 0 });
  });

  it('tenant-aware: rotações de outro tenant não mudam', async () => {
    const { store, rows } = makeStore([rot('a', 1), rot('b', 2), rot('x', 3, {}, 't2'), rot('y', 4, {}, 't2')]);
    await new ApplyPlanLimitsToLinkRotationsUseCase(store).execute({ tenantId: 't1', limits: { linkRotations: 0, linkRotationGroups: 0 } });
    expect(rows.map((r) => r.status)).toEqual([R.PAUSED_BY_PLAN, R.PAUSED_BY_PLAN, R.ACTIVE, R.ACTIVE]);
  });

  it('sessão removida: rotações da sessão → PAUSED (inclusive PAUSED_BY_PLAN); outras sessões intactas', async () => {
    const { store, rows } = makeStore([
      rot('a', 1), rot('b', 2, { status: R.PAUSED_BY_PLAN }), rot('c', 3, { sessionId: 's2' }),
    ]);
    expect(await store.pauseBySession('t1', 's1')).toBe(2);
    expect(rows.map((r) => r.status)).toEqual([R.PAUSED, R.PAUSED, R.ACTIVE]);
  });
});
