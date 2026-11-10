import { describe, expect, it, vi } from 'vitest';
import { EntitlementIncomingMediaPolicy } from './EntitlementIncomingMediaPolicy';
import type { IncomingMediaContext } from '../../domain/contracts/IIncomingMediaPolicy';

function make(chat: boolean, monitored: boolean) {
  const gate = { isChatEnabled: vi.fn().mockResolvedValue(chat) };
  const monitors = { findActiveMonitoredGroup: vi.fn().mockResolvedValue(monitored ? { id: 'mg1' } : null) };
  const currentRule = vi.fn().mockResolvedValue(true);
  return { policy: new EntitlementIncomingMediaPolicy(gate, monitors), gate, monitors, currentRule };
}

const group: IncomingMediaContext = { tenantId: 't1', sessionId: 's1', isGroup: true, groupJid: '1203', msgType: 'IMAGE' };

describe('EntitlementIncomingMediaPolicy', () => {
  it('chat ligado: regra atual da engine, sem consultar monitoramento', async () => {
    const { policy, currentRule, monitors } = make(true, false);
    currentRule.mockResolvedValueOnce(false);
    expect(await policy.shouldDownload({ ...group, msgType: 'VIDEO' }, currentRule)).toBe(false);
    expect(currentRule).toHaveBeenCalledTimes(1);
    expect(monitors.findActiveMonitoredGroup).not.toHaveBeenCalled();
  });

  it('chat desligado: imagem de grupo monitorado baixa', async () => {
    const { policy, currentRule, monitors } = make(false, true);
    expect(await policy.shouldDownload(group, currentRule)).toBe(true);
    expect(monitors.findActiveMonitoredGroup).toHaveBeenCalledWith('t1', 's1', '1203');
    expect(currentRule).not.toHaveBeenCalled();
  });

  it('chat desligado: histórico (append) nunca baixa, nem de grupo monitorado; chat ligado segue a regra', async () => {
    const off = make(false, true);
    expect(await off.policy.shouldDownload({ ...group, origin: 'history' }, off.currentRule)).toBe(false);
    expect(off.monitors.findActiveMonitoredGroup).not.toHaveBeenCalled();
    expect(await off.policy.shouldDownload({ ...group, origin: 'live' }, off.currentRule)).toBe(true);
    const on = make(true, false);
    expect(await on.policy.shouldDownload({ ...group, origin: 'history' }, on.currentRule)).toBe(true);
    expect(on.currentRule).toHaveBeenCalledTimes(1);
  });

  it('chat desligado: grupo não monitorado, 1:1, vídeo, prévia e fromMe não baixam', async () => {
    const { policy, currentRule } = make(false, true);
    const notMon = make(false, false);
    expect(await notMon.policy.shouldDownload(group, currentRule)).toBe(false);
    expect(await policy.shouldDownload({ ...group, isGroup: false, groupJid: null }, currentRule)).toBe(false);
    expect(await policy.shouldDownload({ ...group, msgType: 'VIDEO' }, currentRule)).toBe(false);
    expect(await policy.shouldDownload({ ...group, msgType: 'LINK_PREVIEW' }, currentRule)).toBe(false);
    expect(await policy.shouldDownload({ ...group, fromMe: true }, currentRule)).toBe(false);
    expect(currentRule).not.toHaveBeenCalled();
  });

  it('consulta de monitoramento em cache; falha = não baixa', async () => {
    const { policy, currentRule, monitors } = make(false, true);
    await policy.shouldDownload(group, currentRule);
    await policy.shouldDownload(group, currentRule);
    expect(monitors.findActiveMonitoredGroup).toHaveBeenCalledTimes(1);
    const broken = make(false, true);
    broken.monitors.findActiveMonitoredGroup.mockRejectedValue(new Error('db'));
    expect(await broken.policy.shouldDownload(group, currentRule)).toBe(false);
  });
});
