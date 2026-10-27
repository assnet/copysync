import { useCallback, useEffect, useState } from 'react';
import { sessionService } from '@/services/session.service';
import type { SessionItem } from '@/types/api.types';

/** Sessões do tenant para o seletor do monitoramento. */
export function useMonitoringSessions() {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const data = await sessionService.list();
      setSessions(data.sessions ?? []);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return { sessions, loading, failed, reload: load };
}
