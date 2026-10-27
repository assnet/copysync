import { useCallback, useEffect, useRef, useState } from 'react';
import { monitoringService } from '@/services/monitoring.service';
import type { GroupMonitorConfigResponse, GroupMonitorSettings } from '@/types/api.types';

/**
 * Configuração do monitoramento de uma sessão (dado do servidor: recarregado pelo id, nunca
 * persistido). Cada `save*` devolve a configuração nova e já atualiza o estado.
 */
export function useMonitoringConfig(sessionId: string | null) {
  const [config, setConfig] = useState<GroupMonitorConfigResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const current = useRef(sessionId);
  current.current = sessionId;

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setFailed(false);
    try {
      const data = await monitoringService.getConfig(sessionId);
      if (current.current === sessionId) setConfig(data);
    } catch {
      if (current.current === sessionId) setFailed(true);
    } finally {
      if (current.current === sessionId) setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    setConfig(null);
    void load();
  }, [load]);

  // Resposta de uma sessão que já não está selecionada é descartada
  const apply = useCallback((data: GroupMonitorConfigResponse) => {
    if (data.sessionId === current.current) setConfig(data);
    return data;
  }, []);

  const saveSettings = useCallback(
    async (settings: GroupMonitorSettings) => {
      if (!sessionId) throw new Error('Sem sessão');
      return apply(await monitoringService.saveSettings({ ...settings, sessionId }));
    },
    [sessionId, apply],
  );

  const saveMonitoredGroups = useCallback(
    async (groups: { groupJid: string; keywords: string[] }[]) => {
      if (!sessionId) throw new Error('Sem sessão');
      return apply(await monitoringService.saveMonitoredGroups({ sessionId, groups }));
    },
    [sessionId, apply],
  );

  const saveBroadcastGroups = useCallback(
    async (groupJids: string[]) => {
      if (!sessionId) throw new Error('Sem sessão');
      return apply(await monitoringService.saveBroadcastGroups({ sessionId, groupJids }));
    },
    [sessionId, apply],
  );

  return { config, loading, failed, reload: load, saveSettings, saveMonitoredGroups, saveBroadcastGroups };
}
