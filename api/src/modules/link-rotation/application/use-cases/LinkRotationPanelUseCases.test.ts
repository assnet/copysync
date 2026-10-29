import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';
import type { ILinkRotationGroupDirectory } from '../../domain/contracts/ILinkRotationGroupDirectory';
import { GetLinkRotationStatsUseCase } from './GetLinkRotationStatsUseCase';
import { ListLinkRotationGroupCandidatesUseCase } from './ListLinkRotationGroupCandidatesUseCase';
import { SelectLinkRotationGroupsUseCase } from './SelectLinkRotationGroupsUseCase';
import { makeDeps, NOW, OTHER_TENANT, SESSION, TENANT } from './linkRotationTestFakes';

let deps: ReturnType<typeof makeDeps>;
beforeEach(() => { deps = makeDeps(); });

function directory(groups: Awaited<ReturnType<ILinkRotationGroupDirectory['listSessionGroups']>>['groups'], partial = false) {
  return {
    listSessionGroups: vi.fn(async () => ({ groups, partial })),
    ensureConversation: vi.fn(async (_t: string, _s: string, jid: string) => `conv-new-${jid}`),
  };
}

describe('GetLinkRotationStatsUseCase', () => {
  it('total, 7 dias e por grupo (grupo sem clique = 0)', async () => {
    const r = deps.rotations.seed({ clickCount: 9 });
    const g1 = deps.rotations.seedGroup(r.id, { clickCount: 7, memberCount: 200, capacity: 500 });
    const g2 = deps.rotations.seedGroup(r.id, { clickCount: 2 });
    deps.groups.add(g1.conversationId);
    const clicks = {
      countLast7Days: vi.fn(async () => 4),
      countLast7DaysByGroup: vi.fn(async () => new Map([[g1.id, 4]])),
    };

    const out = await new GetLinkRotationStatsUseCase({ ...deps, clicks }).execute(TENANT, r.id);

    expect(clicks.countLast7Days).toHaveBeenCalledWith(TENANT, r.id, NOW);
    expect(out).toMatchObject({ rotationId: r.id, clickCount: 9, clicksLast7Days: 4 });
    expect(out.groups).toEqual([
      expect.objectContaining({ id: g1.id, groupName: `Grupo ${g1.conversationId}`, clicksLast7Days: 4, memberCount: 200, capacity: 500 }),
      expect.objectContaining({ id: g2.id, groupName: null, clicksLast7Days: 0, clickCount: 2 }),
    ]);
  });

  it('rotação de outro tenant → LINK_ROTATION_NOT_FOUND', async () => {
    const r = deps.rotations.seed({ tenantId: OTHER_TENANT });
    const clicks = { countLast7Days: vi.fn(), countLast7DaysByGroup: vi.fn() };
    await expect(new GetLinkRotationStatsUseCase({ ...deps, clicks }).execute(TENANT, r.id))
      .rejects.toMatchObject({ code: 'LINK_ROTATION_NOT_FOUND' });
    expect(clicks.countLast7Days).not.toHaveBeenCalled();
  });
});

describe('ListLinkRotationGroupCandidatesUseCase', () => {
  it('marca selecionados e inclui o selecionado que sumiu da sessão', async () => {
    const r = deps.rotations.seed();
    const kept = deps.rotations.seedGroup(r.id, { groupJid: 'A' });
    const gone = deps.rotations.seedGroup(r.id, { groupJid: 'Z' });
    deps.groups.add(gone.conversationId, { name: 'Antigo' });
    const dir = directory([
      { groupJid: 'A', title: 'Alfa', avatarUrl: null, conversationId: null },
      { groupJid: 'B', title: 'Beta', avatarUrl: null, conversationId: 'conv-b' },
    ], true);

    const out = await new ListLinkRotationGroupCandidatesUseCase({ ...deps, directory: dir }).execute({ tenantId: TENANT, rotationId: r.id });

    expect(dir.listSessionGroups).toHaveBeenCalledWith(TENANT, SESSION, undefined);
    expect(out.partial).toBe(true);
    expect(out.groups).toEqual([
      expect.objectContaining({ groupJid: 'A', selected: true, rotationGroupId: kept.id, conversationId: kept.conversationId }),
      expect.objectContaining({ groupJid: 'B', selected: false, rotationGroupId: null, status: null }),
      expect.objectContaining({ groupJid: 'Z', selected: true, title: 'Antigo', conversationId: gone.conversationId }),
    ]);
  });

  it('com busca não acrescenta selecionado fora do resultado', async () => {
    const r = deps.rotations.seed();
    deps.rotations.seedGroup(r.id, { groupJid: 'Z' });
    const out = await new ListLinkRotationGroupCandidatesUseCase({ ...deps, directory: directory([]) })
      .execute({ tenantId: TENANT, rotationId: r.id, search: 'vip' });
    expect(out.groups).toEqual([]);
  });

  it('rotação de outro tenant → 404 sem listar', async () => {
    const r = deps.rotations.seed({ tenantId: OTHER_TENANT });
    const dir = directory([]);
    await expect(new ListLinkRotationGroupCandidatesUseCase({ ...deps, directory: dir }).execute({ tenantId: TENANT, rotationId: r.id }))
      .rejects.toMatchObject({ code: 'LINK_ROTATION_NOT_FOUND' });
    expect(dir.listSessionGroups).not.toHaveBeenCalled();
  });
});

describe('SelectLinkRotationGroupsUseCase', () => {
  it('garante a conversa de quem vem só com groupJid e repassa ao salvamento', async () => {
    const r = deps.rotations.seed();
    const dir = directory([]);
    const save = { execute: vi.fn(async () => []) };

    await new SelectLinkRotationGroupsUseCase({ ...deps, directory: dir, save }).execute({
      tenantId: TENANT, rotationId: r.id, groups: [{ conversationId: 'conv-1', weight: 3 }, { groupJid: 'J', capacity: 500 }],
    });

    expect(dir.ensureConversation).toHaveBeenCalledWith(TENANT, SESSION, 'J');
    expect(save.execute).toHaveBeenCalledWith({
      tenantId: TENANT, rotationId: r.id,
      groups: [{ conversationId: 'conv-1', weight: 3 }, { conversationId: 'conv-new-J', capacity: 500 }],
    });
  });

  it('acima do limite → PLAN_LIMIT_REACHED antes de criar conversa', async () => {
    const r = deps.rotations.seed();
    deps.entitlements.numbers[ENTITLEMENT_KEYS.LINK_ROTATION_GROUPS] = 1;
    const dir = directory([]);
    const save = { execute: vi.fn() };
    await expect(new SelectLinkRotationGroupsUseCase({ ...deps, directory: dir, save }).execute({
      tenantId: TENANT, rotationId: r.id, groups: [{ groupJid: 'A' }, { groupJid: 'B' }],
    })).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'link_rotation_groups', limit: 1 } });
    expect(dir.ensureConversation).not.toHaveBeenCalled();
    expect(save.execute).not.toHaveBeenCalled();
  });

  it('item sem conversationId nem groupJid → LINK_GROUP_INVALID', async () => {
    const r = deps.rotations.seed();
    await expect(new SelectLinkRotationGroupsUseCase({ ...deps, directory: directory([]), save: { execute: vi.fn() } })
      .execute({ tenantId: TENANT, rotationId: r.id, groups: [{ weight: 2 }] }))
      .rejects.toMatchObject({ code: 'LINK_GROUP_INVALID' });
  });
});
