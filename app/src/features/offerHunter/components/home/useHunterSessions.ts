import { useCallback, useEffect, useState } from 'react';
import { sessionService } from '@/services/session.service';
import type { SessionItem } from '@/types/api.types';

/** Sessões do tenant para o grupo de destino (nome/foto e o seletor). Dado do servidor: só em memória. */
export function useHunterSessions() {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setSessions((await sessionService.list()).sessions);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  return { sessions, loading, failed, reload };
}
