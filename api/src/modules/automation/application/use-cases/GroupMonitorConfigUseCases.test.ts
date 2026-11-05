import { describe, expect, it } from 'vitest';
import {
  GetGroupMonitorConfigUseCase, SaveBroadcastGroupsUseCase, SaveGroupMonitorSettingsUseCase, SaveMonitoredGroupsUseCase,
} from './GroupMonitorConfigUseCases';
import { DEFAULT_MONITOR_SETTINGS } from '../../domain/services/monitorSettings';
import { FakeBroadcastGroupUsage, FakeCredentialStates, FakeDirectory, FakeEntitlements, InMemoryCapturedOfferRepository, InMemoryGroupMonitorRepository, SESSION, TENANT } from './monitorTestFakes';

function setup(entitlements: Record<string, unknown> = {}) {
  const monitors = new InMemoryGroupMonitorRepository();
  const directory = new FakeDirectory();
  const credentialStates = new FakeCredentialStates();
  const captured = new InMemoryCapturedOfferRepository();
  const broadcastUsage = new FakeBroadcastGroupUsage(monitors);
  const deps = { monitors, directory, entitlements: new FakeEntitlements(entitlements), credentialStates, captured, broadcastUsage, now: () => NOW };
  return {
    monitors, directory, credentialStates, captured, broadcastUsage,
    get: new GetGroupMonitorConfigUseCase(deps),
    settings: new SaveGroupMonitorSettingsUseCase(deps),
    monitored: new SaveMonitoredGroupsUseCase(deps),
    broadcast: new SaveBroadcastGroupsUseCase(deps),
  };
}
const base = { tenantId: TENANT, sessionId: SESSION };
const NOW = new Date('2026-10-28T12:00:00.000Z');

describe('GroupMonitorConfigUseCases', () => {
  it('sessão sem configuração devolve padrões e limites do plano', async () => {
    const s = setup({ monitored_groups: 2, broadcast_groups: 10 });
    const out = await s.get.execute(base);
    expect(out.settings).toEqual(DEFAULT_MONITOR_SETTINGS);
    expect(out.limits).toEqual({
      monitoredGroups: 2, broadcastGroups: 10, mentionAllEnabled: true, crossSessionDispatch: false,
      whatsapp: { monitoredGroups: 2, broadcastGroups: 10 }, telegram: { monitoredGroups: null, broadcastGroups: null },
    });
    expect(out.channel).toBe('whatsapp');
  });

  it('sessão de outro tenant: 404', async () => {
    const s = setup();
    await expect(s.get.execute({ tenantId: 'outro', sessionId: SESSION })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('início 1440 (24:00 → 06:00) grava 0: mesmo dia na regra e no claim', async () => {
    const s = setup();
    const out = await s.settings.execute({ ...base, settings: { ...DEFAULT_MONITOR_SETTINGS, windowStartMinute: 1440, windowEndMinute: 360 } });
    expect(out.settings).toMatchObject({ windowStartMinute: 0, windowEndMinute: 360 });
  });

  it('salva configuração válida; inválida vira 422 com o campo; marcar todos respeita o plano', async () => {
    const s = setup({ mention_all_enabled: false });
    const ok = await s.settings.execute({ ...base, settings: { ...DEFAULT_MONITOR_SETTINGS, enabled: true, windowStartMinute: 1320, windowEndMinute: 360 } });
    expect(ok.settings).toMatchObject({ enabled: true, windowStartMinute: 1320, windowEndMinute: 360 });
    await expect(s.settings.execute({ ...base, settings: { ...DEFAULT_MONITOR_SETTINGS, couponMaxAgeMinutes: 999 } }))
      .rejects.toMatchObject({ code: 'GROUP_MONITOR_INVALID_INPUT', meta: { field: 'couponMaxAgeMinutes' } });
    await expect(s.settings.execute({ ...base, settings: { ...DEFAULT_MONITOR_SETTINGS, mentionAll: true } }))
      .rejects.toMatchObject({ code: 'PLAN_FEATURE_UNAVAILABLE' });
  });

  it('captureOutsideWindow ausente (cliente antigo) mantém o valor salvo; sem config salva vale o padrão', async () => {
    const s = setup();
    const { captureOutsideWindow: _omit, ...without } = DEFAULT_MONITOR_SETTINGS;
    expect((await s.settings.execute({ ...base, settings: without })).settings.captureOutsideWindow).toBe(true);
    await s.settings.execute({ ...base, settings: { ...DEFAULT_MONITOR_SETTINGS, captureOutsideWindow: false } });
    expect((await s.settings.execute({ ...base, settings: without })).settings.captureOutsideWindow).toBe(false);
  });

  it('imageMode ausente (cliente antigo) mantém o valor salvo; desconhecido vira 422', async () => {
    const s = setup();
    const { imageMode: _omit, ...without } = DEFAULT_MONITOR_SETTINGS;
    expect((await s.settings.execute({ ...base, settings: without })).settings.imageMode).toBe('MEDIA');
    await s.settings.execute({ ...base, settings: { ...DEFAULT_MONITOR_SETTINGS, imageMode: 'LINK_PREVIEW' } });
    expect((await s.settings.execute({ ...base, settings: without })).settings.imageMode).toBe('LINK_PREVIEW');
    await expect(s.settings.execute({ ...base, settings: { ...DEFAULT_MONITOR_SETTINGS, imageMode: 'X' as never } }))
      .rejects.toMatchObject({ code: 'GROUP_MONITOR_INVALID_INPUT', meta: { field: 'imageMode' } });
  });

  it('grupos monitorados: garante conversa, liga download de mídia e normaliza palavras-chave', async () => {
    const s = setup();
    const out = await s.monitored.execute({ ...base, groups: [{ groupJid: 'a', keywords: [' Fone ', 'fone'] }] });
    expect(s.directory.mediaEnabled).toEqual(['conv-a']);
    expect(out.monitoredGroups).toEqual([expect.objectContaining({ conversationId: 'conv-a', groupJid: 'a', keywords: ['Fone'] })]);
  });

  it('canal só de leitura: monitorado aceito (monitor); como destino, GROUP_NOT_POSTABLE (send)', async () => {
    const s = setup();
    s.directory.readOnly.add('-100555');
    await s.monitored.execute({ ...base, groups: [{ groupJid: '-100555', keywords: [] }] });
    expect(s.directory.purposes).toEqual(['monitor:-100555']);
    const t = setup();
    t.directory.readOnly.add('-100777');
    await expect(t.broadcast.execute({ ...base, groups: [{ groupJid: '-100777' }] })).rejects.toMatchObject({ code: 'GROUP_NOT_POSTABLE' });
    expect(t.directory.purposes).toEqual(['send:-100777']);
  });

  it('limite do plano soma as outras sessões do tenant', async () => {
    const s = setup({ monitored_groups: 2 });
    await s.monitored.execute({ tenantId: TENANT, sessionId: 'session-2', groups: [{ groupJid: 'x', keywords: [] }] });
    await expect(s.monitored.execute({ ...base, groups: [{ groupJid: 'a', keywords: [] }, { groupJid: 'b', keywords: [] }] }))
      .rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
    await expect(s.monitored.execute({ ...base, groups: [{ groupJid: 'a', keywords: [] }] })).resolves.toBeTruthy();
  });

  it('mesmo grupo não pode ser monitorado e de disparo no tenant (laço)', async () => {
    const s = setup();
    await s.broadcast.execute({ ...base, groups: [{ groupJid: 'meu' }] });
    await expect(s.monitored.execute({ tenantId: TENANT, sessionId: 'session-2', groups: [{ groupJid: 'meu', keywords: [] }] }))
      .rejects.toMatchObject({ code: 'GROUP_MONITOR_GROUP_CONFLICT' });
  });

  it('grupos de disparo mantêm a ordem; repetido é 422', async () => {
    const s = setup();
    const out = await s.broadcast.execute({ ...base, groups: [{ groupJid: 'b' }, { groupJid: 'a' }] });
    expect(out.broadcastGroups.map((g) => [g.groupJid, g.position, g.sessionId])).toEqual([['b', 0, SESSION], ['a', 1, SESSION]]);
    await expect(s.broadcast.execute({ ...base, groups: [{ groupJid: 'a' }, { groupJid: 'a' }] })).rejects.toMatchObject({ code: 'GROUP_MONITOR_INVALID_INPUT' });
  });
});

describe('GroupMonitorConfigUseCases — sessão cruzada', () => {
  it('grupo de outra sessão exige cross_session_dispatch; sem a feature → PLAN_FEATURE_UNAVAILABLE', async () => {
    const s = setup();
    await expect(s.broadcast.execute({ ...base, groups: [{ groupJid: 'x', sessionId: 'session-2' }] }))
      .rejects.toMatchObject({ code: 'PLAN_FEATURE_UNAVAILABLE', meta: { key: 'cross_session_dispatch' } });
    expect((await s.get.execute(base)).limits.crossSessionDispatch).toBe(false);
  });

  it('com a feature: grupo de outra sessão do tenant é aceito, conversa criada na sessão certa', async () => {
    const s = setup({ cross_session_dispatch: true });
    const out = await s.broadcast.execute({ ...base, groups: [{ groupJid: 'x', sessionId: 'session-2' }, { groupJid: 'y' }] });
    expect(out.broadcastGroups.map((g) => [g.groupJid, g.sessionId, g.conversationId])).toEqual([['x', 'session-2', 'conv-x'], ['y', SESSION, 'conv-y']]);
    expect(out.limits.crossSessionDispatch).toBe(true);
  });

  it('sessão de destino inexistente no tenant → 404', async () => {
    const s = setup({ cross_session_dispatch: true });
    await expect(s.broadcast.execute({ ...base, groups: [{ groupJid: 'x', sessionId: 'ghost' }] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('limite de grupos de disparo conta por monitoramento, não pela sessão dona do grupo', async () => {
    const s = setup({ cross_session_dispatch: true, broadcast_groups: 2 });
    await s.broadcast.execute({ tenantId: TENANT, sessionId: 'session-2', groups: [{ groupJid: 'a' }] });
    await expect(s.broadcast.execute({ ...base, groups: [{ groupJid: 'b', sessionId: 'session-2' }, { groupJid: 'c' }] }))
      .rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
    await expect(s.broadcast.execute({ ...base, groups: [{ groupJid: 'b', sessionId: 'session-2' }] })).resolves.toBeTruthy();
  });

  it('limites por canal são independentes; a key do erro indica o canal', async () => {
    const s = setup({ monitored_groups: 1, telegram_monitored_groups: 1, broadcast_groups: 1, telegram_broadcast_groups: 0 });
    s.monitors.sessions.add(`${TENANT}:tg-1`);
    s.monitors.engines['tg-1'] = 'telegram';
    await s.monitored.execute({ ...base, groups: [{ groupJid: 'wa', keywords: [] }] });
    // WhatsApp cheio não impede o Telegram
    const tg = await s.monitored.execute({ tenantId: TENANT, sessionId: 'tg-1', groups: [{ groupJid: '-100', keywords: [] }] });
    expect(tg.channel).toBe('telegram');
    expect(tg.usage).toEqual({
      monitoredGroups: 1, broadcastGroups: 0,
      whatsapp: { monitoredGroups: 1, broadcastGroups: 0 }, telegram: { monitoredGroups: 1, broadcastGroups: 0 },
    });
    await expect(s.monitored.execute({ tenantId: TENANT, sessionId: 'tg-1', groups: [{ groupJid: '-100', keywords: [] }, { groupJid: '-200', keywords: [] }] }))
      .rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'telegram_monitored_groups', limit: 1 } });
    // Disparo no Telegram (canal diferente: sem cross_session) bate no limite do Telegram
    await expect(s.broadcast.execute({ ...base, groups: [{ groupJid: '-300', sessionId: 'tg-1' }] }))
      .rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'telegram_broadcast_groups', limit: 0 } });
  });

  it('grupos de sessão apagada não ocupam a cota do canal', async () => {
    const s = setup({ monitored_groups: 1 });
    await s.monitored.execute({ tenantId: TENANT, sessionId: 'session-2', groups: [{ groupJid: 'antigo', keywords: [] }] });
    await expect(s.monitored.execute({ ...base, groups: [{ groupJid: 'wa', keywords: [] }] }))
      .rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
    s.monitors.deleted.add('session-2');
    const out = await s.monitored.execute({ ...base, groups: [{ groupJid: 'wa', keywords: [] }] });
    expect(out.usage.whatsapp.monitoredGroups).toBe(1);
  });

  it('cross_session_dispatch só para 2+ sessões do mesmo canal', async () => {
    const s = setup();
    s.monitors.sessions.add(`${TENANT}:tg-1`).add(`${TENANT}:tg-2`);
    Object.assign(s.monitors.engines, { 'tg-1': 'telegram', 'tg-2': 'telegram' });
    // WhatsApp → Telegram: canais diferentes, permitido
    const out = await s.broadcast.execute({ ...base, groups: [{ groupJid: 'y' }, { groupJid: '-1', sessionId: 'tg-1' }] });
    expect(out.broadcastGroups.map((g) => g.sessionId)).toEqual([SESSION, 'tg-1']);
    // Duas sessões Telegram como destino: exige a feature
    await expect(s.broadcast.execute({ ...base, groups: [{ groupJid: '-1', sessionId: 'tg-1' }, { groupJid: '-2', sessionId: 'tg-2' }] }))
      .rejects.toMatchObject({ code: 'PLAN_FEATURE_UNAVAILABLE', meta: { key: 'cross_session_dispatch' } });
  });

  it('mesmo grupo como destino de dois monitoramentos → 409 com a sessão do outro monitoramento; GET lista o grupo tomado', async () => {
    const s = setup({ cross_session_dispatch: true });
    await s.broadcast.execute({ tenantId: TENANT, sessionId: 'session-2', groups: [{ groupJid: 'shared' }] });
    await expect(s.broadcast.execute({ ...base, groups: [{ groupJid: 'shared', sessionId: 'session-2' }] }))
      .rejects.toMatchObject({ code: 'GROUP_MONITOR_BROADCAST_TAKEN', meta: { groupJid: 'shared', sessionId: 'session-2', monitorSessionId: 'session-2' } });
    const out = await s.get.execute(base);
    expect(out.takenBroadcastGroups).toEqual([{ groupJid: 'shared', sessionId: 'session-2', monitorSessionId: 'session-2' }]);
  });

  it('mesmo grupo (JID) por duas sessões na mesma lista → 422 GROUP_MONITOR_DUPLICATE_GROUP', async () => {
    const s = setup({ cross_session_dispatch: true });
    await expect(s.broadcast.execute({ ...base, groups: [{ groupJid: 'g', sessionId: 'session-2' }, { groupJid: 'g' }] }))
      .rejects.toMatchObject({ code: 'GROUP_MONITOR_DUPLICATE_GROUP', meta: { groupJid: 'g' } });
  });
});

describe('GroupMonitorConfig — canPost dos grupos de disparo', () => {
  it('anota pela lista ao vivo; sessão fora → null; leitura não quebra', async () => {
    const s = setup();
    await s.broadcast.execute({ ...base, groups: [{ groupJid: 'g1' }, { groupJid: 'g2' }, { groupJid: 'g3' }] });
    expect((await s.get.execute(base)).broadcastGroups.every((g) => g.canPost === null && g.postBlockedReason === null)).toBe(true);
    s.directory.live.set(SESSION, [
      { groupJid: 'g1', name: 'A' },
      { groupJid: 'g2', name: 'B', canPost: false, postBlockedReason: 'CHANNEL_READONLY' },
    ]);
    const out = await s.get.execute(base);
    expect(out.broadcastGroups.map((g) => [g.groupJid, g.canPost, g.postBlockedReason])).toEqual([
      ['g1', true, null], ['g2', false, 'CHANNEL_READONLY'], ['g3', null, null],
    ]);
  });
});

describe('GetGroupMonitorConfigUseCase — credentialAlerts', () => {
  const REJ = new Date('2026-10-27T09:00:00.000Z');
  async function missingCapture(s: ReturnType<typeof setup>, marketplace: 'SHOPEE' | 'AMAZON' | 'MERCADO_LIVRE', daysAgo = 1) {
    const capturedAt = new Date(NOW.getTime() - daysAgo * 24 * 3600_000);
    await s.captured.createPending({ tenantId: TENANT, sessionId: SESSION, configId: 'cfg', monitoredGroupId: 'mg', sourceExternalMessageId: `m-${marketplace}-${daysAgo}`, sourceText: 'x', sourceMediaUrl: null, imageUnavailable: false, capturedAt });
    const [c] = await s.captured.claimPending(1);
    await s.captured.markSkipped(c!.id, c!.claimToken!, 'CREDENTIAL_MISSING', { marketplace });
  }

  it('ML recusada + Shopee sem credencial com captura recente → 2 alertas; Amazon ok sem captura → nada', async () => {
    const s = setup();
    s.credentialStates.states = [
      { provider: 'MERCADO_LIVRE', usable: true, rejectedAt: REJ, rejectedCode: 'AFFILIATE_CREDENTIAL_REJECTED' },
      { provider: 'AMAZON', usable: true, rejectedAt: null, rejectedCode: null },
    ];
    await missingCapture(s, 'SHOPEE');
    const out = await s.get.execute(base);
    expect(out.credentialAlerts).toEqual([
      { provider: 'SHOPEE', kind: 'MISSING', since: null, code: null },
      { provider: 'MERCADO_LIVRE', kind: 'REJECTED', since: REJ.toISOString(), code: 'AFFILIATE_CREDENTIAL_REJECTED' },
    ]);
  });

  it('sem capturas: só REJECTED; captura antiga (8 dias) não conta', async () => {
    const s = setup();
    s.credentialStates.states = [{ provider: 'SHOPEE', usable: true, rejectedAt: REJ, rejectedCode: 'X' }];
    await missingCapture(s, 'AMAZON', 8);
    expect((await s.get.execute(base)).credentialAlerts).toEqual([{ provider: 'SHOPEE', kind: 'REJECTED', since: REJ.toISOString(), code: 'X' }]);
  });

  it('INACTIVE ou Shopee sem secret (não utilizável) com captura recente → MISSING; utilizável → nada', async () => {
    const s = setup();
    s.credentialStates.states = [{ provider: 'SHOPEE', usable: false, rejectedAt: null, rejectedCode: null }, { provider: 'AMAZON', usable: true, rejectedAt: null, rejectedCode: null }];
    await missingCapture(s, 'SHOPEE');
    await missingCapture(s, 'AMAZON');
    expect((await s.get.execute(base)).credentialAlerts).toEqual([{ provider: 'SHOPEE', kind: 'MISSING', since: null, code: null }]);
  });

  it('recusada e com captura MISSING recente: um alerta só, REJECTED; Save* não devolve credentialAlerts', async () => {
    const s = setup();
    s.credentialStates.states = [{ provider: 'SHOPEE', usable: false, rejectedAt: REJ, rejectedCode: 'X' }];
    await missingCapture(s, 'SHOPEE');
    expect((await s.get.execute(base)).credentialAlerts).toEqual([{ provider: 'SHOPEE', kind: 'REJECTED', since: REJ.toISOString(), code: 'X' }]);
    const saved = await s.broadcast.execute({ ...base, groups: [{ groupJid: 'g' }] });
    expect(saved.credentialAlerts).toBeUndefined();
  });
});

describe('GroupMonitorConfig — limite de disparo pela união com o gerador', () => {
  const gen = (s: ReturnType<typeof setup>, ...jids: string[]) =>
    s.broadcastUsage.generator.push(...jids.map((groupJid) => ({ tenantId: TENANT, sessionId: SESSION, groupJid })));

  it('LITE com 5 no gerador e 1 novo no monitoramento → PLAN_LIMIT_REACHED; nada salvo', async () => {
    const s = setup({ broadcast_groups: 5 });
    gen(s, 'g1', 'g2', 'g3', 'g4', 'g5');
    await expect(s.broadcast.execute({ ...base, groups: [{ groupJid: 'novo' }] }))
      .rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'broadcast_groups', limit: 5 } });
    expect(s.monitors.broadcast).toEqual([]);
  });

  it('mesmo grupo no gerador e no monitoramento conta 1; usage do GET = união', async () => {
    const s = setup({ broadcast_groups: 5 });
    gen(s, 'g1', 'g2', 'g3', 'g4', 'g5');
    const out = await s.broadcast.execute({ ...base, groups: [{ groupJid: 'g1' }, { groupJid: 'g2' }] });
    expect(out.usage.whatsapp.broadcastGroups).toBe(5);
    expect(out.usage.broadcastGroups).toBe(5);
    expect((await s.get.execute(base)).usage.whatsapp.broadcastGroups).toBe(5);
  });

  it('lista atual do próprio monitoramento é substituída, não somada; outro tenant não conta', async () => {
    const s = setup({ broadcast_groups: 2 });
    s.broadcastUsage.generator.push({ tenantId: 'outro', sessionId: SESSION, groupJid: 'x1' }, { tenantId: 'outro', sessionId: SESSION, groupJid: 'x2' });
    gen(s, 'g1');
    await s.broadcast.execute({ ...base, groups: [{ groupJid: 'a' }] });
    const out = await s.broadcast.execute({ ...base, groups: [{ groupJid: 'b' }] });
    expect(out.usage.whatsapp.broadcastGroups).toBe(2);
  });

  it('canais separados: gerador cheio no WhatsApp não trava Telegram', async () => {
    const s = setup({ broadcast_groups: 1, telegram_broadcast_groups: 1 });
    s.monitors.sessions.add(`${TENANT}:tg-1`);
    s.monitors.engines['tg-1'] = 'telegram';
    gen(s, 'g1');
    const out = await s.broadcast.execute({ tenantId: TENANT, sessionId: 'tg-1', groups: [{ groupJid: '-100' }] });
    expect(out.usage.whatsapp.broadcastGroups).toBe(1);
    expect(out.usage.telegram.broadcastGroups).toBe(1);
  });

  it('conflito com monitorado e grupo tomado seguem iguais com o gerador somado', async () => {
    const s = setup({ cross_session_dispatch: true, broadcast_groups: 10 });
    gen(s, 'g1');
    await s.monitored.execute({ tenantId: TENANT, sessionId: 'session-2', groups: [{ groupJid: 'mon', keywords: [] }] });
    await expect(s.broadcast.execute({ ...base, groups: [{ groupJid: 'mon' }] })).rejects.toMatchObject({ code: 'GROUP_MONITOR_GROUP_CONFLICT' });
    await s.broadcast.execute({ tenantId: TENANT, sessionId: 'session-2', groups: [{ groupJid: 'shared' }] });
    await expect(s.broadcast.execute({ ...base, groups: [{ groupJid: 'shared', sessionId: 'session-2' }] }))
      .rejects.toMatchObject({ code: 'GROUP_MONITOR_BROADCAST_TAKEN' });
  });
});
