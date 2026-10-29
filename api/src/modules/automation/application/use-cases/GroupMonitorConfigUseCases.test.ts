import { describe, expect, it } from 'vitest';
import {
  GetGroupMonitorConfigUseCase, SaveBroadcastGroupsUseCase, SaveGroupMonitorSettingsUseCase, SaveMonitoredGroupsUseCase,
} from './GroupMonitorConfigUseCases';
import { DEFAULT_MONITOR_SETTINGS } from '../../domain/services/monitorSettings';
import { FakeCredentialStates, FakeDirectory, FakeEntitlements, InMemoryCapturedOfferRepository, InMemoryGroupMonitorRepository, SESSION, TENANT } from './monitorTestFakes';

function setup(entitlements: Record<string, unknown> = {}) {
  const monitors = new InMemoryGroupMonitorRepository();
  const directory = new FakeDirectory();
  const credentialStates = new FakeCredentialStates();
  const captured = new InMemoryCapturedOfferRepository();
  const deps = { monitors, directory, entitlements: new FakeEntitlements(entitlements), credentialStates, captured, now: () => NOW };
  return {
    monitors, directory, credentialStates, captured,
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
    expect(out.limits).toEqual({ monitoredGroups: 2, broadcastGroups: 10, mentionAllEnabled: true, crossSessionDispatch: false });
  });

  it('sessão de outro tenant: 404', async () => {
    const s = setup();
    await expect(s.get.execute({ tenantId: 'outro', sessionId: SESSION })).rejects.toMatchObject({ code: 'NOT_FOUND' });
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

  it('grupos monitorados: garante conversa, liga download de mídia e normaliza palavras-chave', async () => {
    const s = setup();
    const out = await s.monitored.execute({ ...base, groups: [{ groupJid: 'a', keywords: [' Fone ', 'fone'] }] });
    expect(s.directory.mediaEnabled).toEqual(['conv-a']);
    expect(out.monitoredGroups).toEqual([expect.objectContaining({ conversationId: 'conv-a', groupJid: 'a', keywords: ['Fone'] })]);
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

  it('mesmo grupo como destino de dois monitoramentos → 422', async () => {
    const s = setup({ cross_session_dispatch: true });
    await s.broadcast.execute({ tenantId: TENANT, sessionId: 'session-2', groups: [{ groupJid: 'shared' }] });
    await expect(s.broadcast.execute({ ...base, groups: [{ groupJid: 'shared', sessionId: 'session-2' }] }))
      .rejects.toMatchObject({ code: 'GROUP_MONITOR_INVALID_INPUT' });
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
