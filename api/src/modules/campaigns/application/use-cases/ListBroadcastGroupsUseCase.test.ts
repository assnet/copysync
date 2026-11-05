import { describe, expect, it } from 'vitest';
import { ListBroadcastGroupsUseCase } from './ListBroadcastGroupsUseCase';
import { FakeEntitlementReader, TENANT } from './offerTestFakes';
import type {
  BroadcastGroupCatalogItem, IBroadcastGroupUsageReader,
} from '../../domain/contracts/IBroadcastGroupUsageReader';

const item = (over: Partial<BroadcastGroupCatalogItem>): BroadcastGroupCatalogItem => ({
  conversationId: 'c1', sessionId: 's1', sessionName: 'Sessão 1', engine: 'baileys', groupJid: '120363000001',
  title: 'Grupo', avatarUrl: null, usedBy: ['generator'], ...over,
});

class FakeCatalog implements IBroadcastGroupUsageReader {
  calls: string[] = [];
  constructor(private readonly byTenant: Record<string, BroadcastGroupCatalogItem[]>) {}
  async listRows() { return []; }
  async listCatalog(tenantId: string) { this.calls.push(tenantId); return this.byTenant[tenantId] ?? []; }
}

describe('ListBroadcastGroupsUseCase', () => {
  it('lista itens com canal, usos, limites e uso por canal', async () => {
    const reader = new FakeCatalog({
      [TENANT]: [
        item({ usedBy: ['generator', 'monitor:s1'] }),
        item({ conversationId: 'c2', groupJid: '120363000002', usedBy: ['monitor:s1'] }),
        item({ conversationId: 'c3', sessionId: 't1', sessionName: 'TG', engine: 'telegram', groupJid: '-1001', avatarUrl: '/a.png' }),
      ],
      other: [item({ conversationId: 'cx', sessionId: 'sx' })],
    });
    const out = await new ListBroadcastGroupsUseCase({
      groupUsage: reader,
      entitlements: new FakeEntitlementReader({ broadcast_groups: 5, telegram_broadcast_groups: 0 }),
    }).execute(TENANT);

    expect(reader.calls).toEqual([TENANT]);
    expect(out.items).toEqual([
      { conversationId: 'c1', sessionId: 's1', sessionName: 'Sessão 1', channel: 'whatsapp', title: 'Grupo', avatarUrl: null, usedBy: ['generator', 'monitor:s1'] },
      { conversationId: 'c2', sessionId: 's1', sessionName: 'Sessão 1', channel: 'whatsapp', title: 'Grupo', avatarUrl: null, usedBy: ['monitor:s1'] },
      { conversationId: 'c3', sessionId: 't1', sessionName: 'TG', channel: 'telegram', title: 'Grupo', avatarUrl: '/a.png', usedBy: ['generator'] },
    ]);
    expect(out.items.some((i) => i.conversationId === 'cx')).toBe(false);
    expect(out.limits).toEqual({ whatsapp: { broadcastGroups: 5 }, telegram: { broadcastGroups: 0 } });
    expect(out.usage).toEqual({ whatsapp: { broadcastGroups: 2 }, telegram: { broadcastGroups: 1 } });
  });

  it('não expõe JID nem engine; plano sem limite devolve null', async () => {
    const out = await new ListBroadcastGroupsUseCase({
      groupUsage: new FakeCatalog({ [TENANT]: [item({})] }),
      entitlements: new FakeEntitlementReader(),
    }).execute(TENANT);
    expect(out.items[0]).not.toHaveProperty('groupJid');
    expect(out.items[0]).not.toHaveProperty('engine');
    expect(out.limits).toEqual({ whatsapp: { broadcastGroups: null }, telegram: { broadcastGroups: null } });
  });

  it('catálogo vazio: uso zero', async () => {
    const out = await new ListBroadcastGroupsUseCase({
      groupUsage: new FakeCatalog({}), entitlements: new FakeEntitlementReader({ broadcast_groups: 5 }),
    }).execute(TENANT);
    expect(out).toEqual({
      items: [],
      limits: { whatsapp: { broadcastGroups: 5 }, telegram: { broadcastGroups: null } },
      usage: { whatsapp: { broadcastGroups: 0 }, telegram: { broadcastGroups: 0 } },
    });
  });
});
