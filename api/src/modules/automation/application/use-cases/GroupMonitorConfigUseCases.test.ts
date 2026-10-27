import { describe, expect, it } from 'vitest';
import {
  GetGroupMonitorConfigUseCase, SaveBroadcastGroupsUseCase, SaveGroupMonitorSettingsUseCase, SaveMonitoredGroupsUseCase,
} from './GroupMonitorConfigUseCases';
import { DEFAULT_MONITOR_SETTINGS } from '../../domain/services/monitorSettings';
import { FakeDirectory, FakeEntitlements, InMemoryGroupMonitorRepository, SESSION, TENANT } from './monitorTestFakes';

function setup(entitlements: Record<string, unknown> = {}) {
  const monitors = new InMemoryGroupMonitorRepository();
  const directory = new FakeDirectory();
  const deps = { monitors, directory, entitlements: new FakeEntitlements(entitlements) };
  return {
    monitors, directory,
    get: new GetGroupMonitorConfigUseCase(deps),
    settings: new SaveGroupMonitorSettingsUseCase(deps),
    monitored: new SaveMonitoredGroupsUseCase(deps),
    broadcast: new SaveBroadcastGroupsUseCase(deps),
  };
}
const base = { tenantId: TENANT, sessionId: SESSION };

describe('GroupMonitorConfigUseCases', () => {
  it('sessão sem configuração devolve padrões e limites do plano', async () => {
    const s = setup({ monitored_groups: 2, broadcast_groups: 10 });
    const out = await s.get.execute(base);
    expect(out.settings).toEqual(DEFAULT_MONITOR_SETTINGS);
    expect(out.limits).toEqual({ monitoredGroups: 2, broadcastGroups: 10, mentionAllEnabled: true });
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
    await s.broadcast.execute({ ...base, groupJids: ['meu'] });
    await expect(s.monitored.execute({ tenantId: TENANT, sessionId: 'session-2', groups: [{ groupJid: 'meu', keywords: [] }] }))
      .rejects.toMatchObject({ code: 'GROUP_MONITOR_GROUP_CONFLICT' });
  });

  it('grupos de disparo mantêm a ordem; repetido é 422', async () => {
    const s = setup();
    const out = await s.broadcast.execute({ ...base, groupJids: ['b', 'a'] });
    expect(out.broadcastGroups.map((g) => [g.groupJid, g.position])).toEqual([['b', 0], ['a', 1]]);
    await expect(s.broadcast.execute({ ...base, groupJids: ['a', 'a'] })).rejects.toMatchObject({ code: 'GROUP_MONITOR_INVALID_INPUT' });
  });
});
