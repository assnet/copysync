import { describe, it, expect, vi } from 'vitest';
import { LIVE_GROUPS_TIMEOUT_MS } from '../services/loadLiveGroups';
import { GetOfferGeneratorConfigUseCase, SaveOfferGeneratorConfigUseCase } from './OfferGeneratorConfigUseCases';
import { FakeEntitlementReader, InMemoryOfferGeneratorConfigRepository, TENANT } from './offerTestFakes';
import type {
  BroadcastGroupUsageRow, IBroadcastGroupUsageReader, ListBroadcastGroupRowsOptions,
} from '../../domain/contracts/IBroadcastGroupUsageReader';

/** União em memória: destinos salvos do gerador (do repositório fake) ⋃ `monitor` (linhas prontas). */
class FakeGroupUsage implements Pick<IBroadcastGroupUsageReader, 'listRows'> {
  monitor: BroadcastGroupUsageRow[] = [];
  constructor(private readonly configs: InMemoryOfferGeneratorConfigRepository) {}
  async listRows(tenantId: string, options: ListBroadcastGroupRowsOptions = {}) {
    const gen: BroadcastGroupUsageRow[] = options.exceptGenerator ? [] : (this.configs.selected.get(tenantId) ?? []).flatMap((id) => {
      const c = this.configs.conversations.find((x) => x.id === id && x.tenantId === tenantId);
      const s = this.configs.sessions.find((x) => x.id === c?.sessionId);
      return c && s ? [{ conversationId: c.id, sessionId: s.id, groupJid: c.groupJid ?? `conversation:${c.id}`, engine: s.engine ?? 'baileys', use: 'generator' as const }] : [];
    });
    const mon = this.monitor.filter((r) => r.use !== `monitor:${options.exceptMonitorSessionId}`);
    return [...gen, ...mon];
  }
}

const monitorRow = (sessionId: string, groupJid: string, engine = 'baileys'): BroadcastGroupUsageRow =>
  ({ conversationId: `c-${groupJid}`, sessionId, groupJid, engine, use: `monitor:${sessionId}` });

function setup(entitlements: Record<string, unknown> = {}) {
  const configs = new InMemoryOfferGeneratorConfigRepository(
    [
      { id: 's1', tenantId: TENANT, status: 'CONNECTED' },
      { id: 's2', tenantId: TENANT, status: 'CONNECTED' },
      { id: 'sx', tenantId: 'other', status: 'CONNECTED' },
      { id: 't1', tenantId: TENANT, status: 'CONNECTED', engine: 'telegram' },
      { id: 't2', tenantId: TENANT, status: 'CONNECTED', engine: 'telegram' },
    ],
    [
      { id: 'g1', tenantId: TENANT, sessionId: 's1', isGroup: true, title: 'Grupo 1' },
      { id: 'g2', tenantId: TENANT, sessionId: 's1', isGroup: true },
      { id: 'g3', tenantId: TENANT, sessionId: 's2', isGroup: true },
      { id: 'dm', tenantId: TENANT, sessionId: 's1', isGroup: false },
      { id: 'gx', tenantId: 'other', sessionId: 's1', isGroup: true },
      { id: 'tg1', tenantId: TENANT, sessionId: 't1', isGroup: true },
      { id: 'tg2', tenantId: TENANT, sessionId: 't1', isGroup: true },
    ],
  );
  const groupUsage = new FakeGroupUsage(configs);
  const deps = { configs, entitlements: new FakeEntitlementReader(entitlements), groupUsage };
  return { configs, groupUsage, get: new GetOfferGeneratorConfigUseCase(deps), save: new SaveOfferGeneratorConfigUseCase(deps) };
}

const base = { tenantId: TENANT, sessionIds: ['s1'], intervalMinSeconds: 120, intervalMaxSeconds: 300, dispatchOrder: 'SEQUENTIAL' as const };

describe('Offer generator config', () => {
  it('sem configuração: padrões, sem grupos, limite do plano', async () => {
    const s = setup({ broadcast_groups: 5 });
    expect(await s.get.execute(TENANT)).toEqual({
      sessionIds: [], intervalMinSeconds: 120, intervalMaxSeconds: 300, dispatchOrder: 'SEQUENTIAL', groups: [], groupLimit: 5, sessionLimit: null, crossSessionDispatch: false, configured: false,
      limits: { whatsapp: { sessions: null, broadcastGroups: 5 }, telegram: { sessions: null, broadcastGroups: null } },
      usage: { whatsapp: { sessions: 0, broadcastGroups: 0 }, telegram: { sessions: 0, broadcastGroups: 0 } },
    });
  });

  it('salva, deduplica e devolve grupos com título', async () => {
    const s = setup();
    const out = await s.save.execute({ ...base, conversationIds: ['g1', 'g2', 'g1'] });
    expect(out).toMatchObject({ sessionIds: ['s1'], configured: true, groupLimit: null });
    expect(out.groups).toEqual([
      { id: 'g1', title: 'Grupo 1', avatarUrl: null, sessionId: 's1', canPost: null, postBlockedReason: null },
      { id: 'g2', title: 'g2', avatarUrl: null, sessionId: 's1', canPost: null, postBlockedReason: null },
    ]);
  });

  it('anota canPost dos grupos salvos pela lista ao vivo; sessão fora ou engine travada → null', async () => {
    const s = setup({ cross_session_dispatch: true });
    for (const c of s.configs.conversations) c.groupJid = `j-${c.id}`;
    const listParticipating = async (id: string) => {
      if (id === 's1') return [{ groupJid: 'j-g1', name: 'A' }, { groupJid: 'j-g2', name: 'B', canPost: false, postBlockedReason: 'ADMINS_ONLY' as const }];
      if (id === 't1') return new Promise<never>(() => {});
      throw new Error('offline');
    };
    const deps = { configs: s.configs, entitlements: new FakeEntitlementReader({ cross_session_dispatch: true }), groupUsage: s.groupUsage, directory: { listParticipating } };
    await new SaveOfferGeneratorConfigUseCase({ configs: s.configs, entitlements: deps.entitlements, groupUsage: s.groupUsage })
      .execute({ ...base, sessionIds: ['s1', 's2', 't1'], conversationIds: ['g1', 'g2', 'g3', 'tg1'] });
    vi.useFakeTimers();
    const p = new GetOfferGeneratorConfigUseCase(deps).execute(TENANT);
    await vi.advanceTimersByTimeAsync(LIVE_GROUPS_TIMEOUT_MS);
    const out = await p;
    vi.useRealTimers();
    expect(out.groups.map((g) => [g.id, g.canPost, g.postBlockedReason])).toEqual([
      ['g1', true, null], ['g2', false, 'ADMINS_ONLY'], ['g3', null, null], ['tg1', null, null],
    ]);
  });

  it.each([
    ['grupo de outra sessão', 'g3'],
    ['conversa que não é grupo', 'dm'],
    ['grupo de outro tenant', 'gx'],
  ])('%s → NOT_FOUND e nada muda', async (_label, id) => {
    const s = setup();
    await expect(s.save.execute({ ...base, conversationIds: ['g1', id] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(s.configs.saves).toBe(0);
  });

  it('sessão de outro tenant → NOT_FOUND', async () => {
    const s = setup();
    await expect(s.save.execute({ ...base, sessionIds: ['s1', 'sx'], conversationIds: [] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('várias sessões (com cross_session_dispatch): grupos de qualquer uma valem; sem sessão → OFFER_INVALID_INPUT', async () => {
    const s = setup({ cross_session_dispatch: true });
    const out = await s.save.execute({ ...base, sessionIds: ['s2', 's1'], dispatchOrder: 'INTERLEAVED', conversationIds: ['g1', 'g3'] });
    expect(out).toMatchObject({ sessionIds: ['s2', 's1'], dispatchOrder: 'INTERLEAVED' });
    expect(out.groups.map((g) => g.id)).toEqual(['g1', 'g3']);
    await expect(s.save.execute({ ...base, sessionIds: [], conversationIds: [] })).rejects.toMatchObject({ code: 'OFFER_INVALID_INPUT', meta: { field: 'sessionIds' } });
  });

  it('acima de whatsapp_sessions → PLAN_LIMIT_REACHED', async () => {
    const s = setup({ whatsapp_sessions: 1 });
    await expect(s.save.execute({ ...base, sessionIds: ['s1', 's2'], conversationIds: [] })).rejects.toMatchObject({
      code: 'PLAN_LIMIT_REACHED', meta: { key: 'whatsapp_sessions', limit: 1 },
    });
  });

  it('acima de broadcast_groups → PLAN_LIMIT_REACHED', async () => {
    const s = setup({ broadcast_groups: 1 });
    await expect(s.save.execute({ ...base, conversationIds: ['g1', 'g2'] })).rejects.toMatchObject({
      code: 'PLAN_LIMIT_REACHED', statusCode: 403, meta: { key: 'broadcast_groups', limit: 1 },
    });
    expect(s.configs.saves).toBe(0);
  });

  it.each([
    [59, 600, 'intervalMinSeconds'],
    [600, 3601, 'intervalMaxSeconds'],
    [1200, 600, 'intervalMaxSeconds'],
    [90.5, 600, 'intervalMinSeconds'],
  ])('intervalo %s–%s → OFFER_INVALID_INPUT (%s)', async (min, max, field) => {
    const s = setup();
    await expect(
      s.save.execute({ ...base, intervalMinSeconds: min, intervalMaxSeconds: max, conversationIds: [] }),
    ).rejects.toMatchObject({ code: 'OFFER_INVALID_INPUT', meta: { field } });
  });

  it('min = max é válido; lista vazia limpa os grupos', async () => {
    const s = setup();
    s.configs.selected.set(TENANT, ['g1']);
    const out = await s.save.execute({ ...base, intervalMinSeconds: 600, intervalMaxSeconds: 600, conversationIds: [] });
    expect(out.groups).toEqual([]);
  });
});

describe('Offer generator config — sessão cruzada', () => {
  it('2+ sessões sem cross_session_dispatch → PLAN_FEATURE_UNAVAILABLE; com a feature passa', async () => {
    const s = setup();
    await expect(s.save.execute({ ...base, sessionIds: ['s1', 's2'], conversationIds: [] }))
      .rejects.toMatchObject({ code: 'PLAN_FEATURE_UNAVAILABLE', meta: { key: 'cross_session_dispatch' } });
    const ok = setup({ cross_session_dispatch: true });
    await expect(ok.save.execute({ ...base, sessionIds: ['s1', 's2'], conversationIds: [] })).resolves.toMatchObject({ sessionIds: ['s1', 's2'], crossSessionDispatch: true });
  });
});

describe('Offer generator config — limites por canal', () => {
  it('WhatsApp + Telegram juntos sem cross_session_dispatch; uso e limites por canal no GET', async () => {
    const s = setup({ whatsapp_sessions: 1, telegram_sessions: 1, broadcast_groups: 1, telegram_broadcast_groups: 2 });
    const out = await s.save.execute({ ...base, sessionIds: ['s1', 't1'], conversationIds: ['g1', 'tg1', 'tg2'] });
    expect(out.crossSessionDispatch).toBe(false);
    expect(out.limits).toEqual({ whatsapp: { sessions: 1, broadcastGroups: 1 }, telegram: { sessions: 1, broadcastGroups: 2 } });
    expect(out.usage).toEqual({ whatsapp: { sessions: 1, broadcastGroups: 1 }, telegram: { sessions: 1, broadcastGroups: 2 } });
  });

  it('limite de sessões e de grupos por canal; key do erro indica o canal', async () => {
    const s = setup({ telegram_sessions: 0, cross_session_dispatch: true });
    await expect(s.save.execute({ ...base, sessionIds: ['s1', 't1'], conversationIds: [] }))
      .rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'telegram_sessions', limit: 0 } });
    const g = setup({ broadcast_groups: 5, telegram_broadcast_groups: 1 });
    await expect(g.save.execute({ ...base, sessionIds: ['s1', 't1'], conversationIds: ['g1', 'tg1', 'tg2'] }))
      .rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'telegram_broadcast_groups', limit: 1 } });
  });

  it('duas sessões Telegram exigem cross_session_dispatch', async () => {
    const s = setup();
    await expect(s.save.execute({ ...base, sessionIds: ['t1', 't2'], conversationIds: [] }))
      .rejects.toMatchObject({ code: 'PLAN_FEATURE_UNAVAILABLE', meta: { key: 'cross_session_dispatch' } });
  });
});

describe('Offer generator config — limite pela união com o monitoramento (BG-01..03)', () => {
  const lite = { broadcast_groups: 5, telegram_broadcast_groups: 0 };

  it('LITE com 5 grupos no monitoramento e 1 novo no gerador → PLAN_LIMIT_REACHED e nada muda', async () => {
    const s = setup(lite);
    for (const c of s.configs.conversations) c.groupJid = `j-${c.id}`;
    s.groupUsage.monitor = ['m1', 'm2', 'm3', 'm4', 'm5'].map((j) => monitorRow('s1', j));
    await expect(s.save.execute({ ...base, conversationIds: ['g1'] })).rejects.toMatchObject({
      code: 'PLAN_LIMIT_REACHED', meta: { key: 'broadcast_groups', limit: 5 },
    });
    expect(s.configs.saves).toBe(0);
  });

  it('mesmo grupo (sessão + JID) no gerador e no monitoramento conta 1; GET devolve a união', async () => {
    const s = setup(lite);
    for (const c of s.configs.conversations) c.groupJid = `j-${c.id}`;
    s.groupUsage.monitor = [monitorRow('s1', 'j-g1'), monitorRow('s1', 'm2'), monitorRow('s1', 'm3'), monitorRow('s2', 'm4')];
    const out = await s.save.execute({ ...base, conversationIds: ['g1', 'g2'] });
    expect(out.usage.whatsapp.broadcastGroups).toBe(5);
    expect((await s.get.execute(TENANT)).usage).toEqual({
      whatsapp: { sessions: 1, broadcastGroups: 5 }, telegram: { sessions: 0, broadcastGroups: 0 },
    });
  });

  it('mesmo JID em outra sessão é outro grupo; destinos antigos do gerador não contam no save', async () => {
    const s = setup(lite);
    for (const c of s.configs.conversations) c.groupJid = `j-${c.id}`;
    s.configs.selected.set(TENANT, ['g1', 'g2']);
    s.groupUsage.monitor = ['m1', 'm2', 'm3', 'm4'].map((j) => monitorRow('s1', j));
    await expect(s.save.execute({ ...base, conversationIds: ['g1'] })).resolves.toMatchObject({ usage: { whatsapp: { broadcastGroups: 5 } } });
    s.groupUsage.monitor = [...s.groupUsage.monitor, monitorRow('s2', 'j-g1')];
    await expect(s.save.execute({ ...base, conversationIds: ['g1'] })).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
  });

  it('canais separados: monitoramento Telegram não consome o limite do WhatsApp', async () => {
    const s = setup({ broadcast_groups: 1, telegram_broadcast_groups: 10 });
    s.groupUsage.monitor = ['a', 'b', 'c'].map((j) => monitorRow('t1', j, 'telegram'));
    const out = await s.save.execute({ ...base, conversationIds: ['g1'] });
    expect(out.usage).toEqual({ whatsapp: { sessions: 1, broadcastGroups: 1 }, telegram: { sessions: 0, broadcastGroups: 3 } });
  });

  it('canal sem grupo pedido não é checado (D5: só bloqueia o save que adiciona no canal)', async () => {
    const s = setup({ broadcast_groups: 1 });
    s.groupUsage.monitor = [monitorRow('s1', 'm1'), monitorRow('s1', 'm2')];
    await expect(s.save.execute({ ...base, conversationIds: [] })).resolves.toMatchObject({ usage: { whatsapp: { broadcastGroups: 2 } } });
  });
});
