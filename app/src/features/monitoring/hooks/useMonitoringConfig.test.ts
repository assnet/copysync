import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { GroupMonitorConfigResponse } from '@/types/api.types';

const getConfig = vi.fn();
const saveBroadcastGroups = vi.fn();
vi.mock('@/services/monitoring.service', () => ({
  monitoringService: {
    getConfig: (id: string) => getConfig(id),
    saveSettings: vi.fn(),
    saveMonitoredGroups: vi.fn(),
    saveBroadcastGroups: (b: unknown) => saveBroadcastGroups(b),
  },
}));

import { useMonitoringConfig } from './useMonitoringConfig';

const config = (over: Partial<GroupMonitorConfigResponse> = {}): GroupMonitorConfigResponse => ({
  sessionId: 's1',
  settings: {
    enabled: false, windowStartMinute: 0, windowEndMinute: 1440, intervalMinSeconds: 300, intervalMaxSeconds: 600, startDelaySeconds: 0,
    maxOfferAgeMinutes: 240, couponMaxAgeMinutes: 60, mentionAll: false, simulateTyping: false, typingSeconds: 5,
    textMode: 'ORIGINAL', audience: 'STANDARD', enrichLinkOnly: true, captureOutsideWindow: true,
  },
  monitoredGroups: [], broadcastGroups: [],
  limits: { monitoredGroups: null, broadcastGroups: null, mentionAllEnabled: true, crossSessionDispatch: false },
  usage: { monitoredGroups: 0, broadcastGroups: 0 },
  ...over,
});

beforeEach(() => { getConfig.mockReset(); saveBroadcastGroups.mockReset(); });

describe('useMonitoringConfig', () => {
  it('salvar grupos (resposta sem credentialAlerts) mantém o aviso do GET anterior', async () => {
    const alerts = [{ provider: 'SHOPEE' as const, kind: 'MISSING' as const, since: null, code: null }];
    getConfig.mockResolvedValue(config({ credentialAlerts: alerts }));
    saveBroadcastGroups.mockResolvedValue(config({ broadcastGroups: [{ conversationId: 'c', groupJid: 'g', sessionId: 's1', title: null, avatarUrl: null, position: 0 }] }));
    const { result } = renderHook(() => useMonitoringConfig('s1'));
    await waitFor(() => expect(result.current.config?.credentialAlerts).toEqual(alerts));
    await act(async () => { await result.current.saveBroadcastGroups([{ groupJid: 'g' }]); });
    expect(result.current.config?.broadcastGroups).toHaveLength(1);
    expect(result.current.config?.credentialAlerts).toEqual(alerts);
  });
});
