import { useCallback, useEffect, useState } from 'react';
import { offerService } from '@/services/offer.service';
import { sessionService } from '@/services/session.service';
import type { OfferConfigResponse, SaveOfferConfigRequest, SessionItem } from '@/types/api.types';
import { toOfferError } from '../utils/offerErrors';

/**
 * Configuração do gerador (sessão, grupos, intervalo) e as sessões do tenant.
 * As sessões servem ao assistente (só as conectadas) e à barra de resumo (nome e status).
 */
export function useOfferConfig() {
  const [data, setData] = useState<OfferConfigResponse | null>(null);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [sessionsFailed, setSessionsFailed] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const loadSessions = useCallback(async () => {
    setSessionsFailed(false);
    setSessionsLoading(true);
    try {
      setSessions((await sessionService.list()).sessions);
    } catch {
      setSessionsFailed(true);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    offerService.getConfig()
      .then((res) => { if (!cancelled) setData(res); })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    void loadSessions();
    return () => { cancelled = true; };
  }, [attempt, loadSessions]);

  /** Rejeita com `OfferErrorView` para o assistente mostrar a mensagem no passo atual. */
  const save = useCallback(async (body: SaveOfferConfigRequest) => {
    try {
      const res = await offerService.saveConfig(body);
      setData(res);
      return res;
    } catch (err) {
      throw toOfferError(err);
    }
  }, []);

  const config = data?.config ?? null;
  const groups = data?.groups ?? [];
  // Sessões escolhidas na ordem de envio; as que sumiram (apagadas) contam em `missingSessions`
  const selectedSessions = (config?.sessionIds ?? []).flatMap((id) => sessions.find((s) => s.id === id) ?? []);
  const missingSessions = sessionsLoading ? 0 : (config?.sessionIds.length ?? 0) - selectedSessions.length;
  const offlineSessions = selectedSessions.filter((s) => s.status !== 'CONNECTED');

  return {
    config,
    groups,
    groupLimit: data?.groupLimit ?? null,
    sessionLimit: data?.sessionLimit ?? null,
    crossSessionDispatch: data?.crossSessionDispatch ?? false,
    configured: (config?.sessionIds.length ?? 0) > 0 && groups.length > 0,
    selectedSessions,
    missingSessions,
    offlineSessions,
    sessions,
    sessionsFailed,
    sessionsLoading,
    reloadSessions: loadSessions,
    loading,
    failed,
    retry: () => setAttempt((n) => n + 1),
    save,
  };
}

export type OfferConfigState = ReturnType<typeof useOfferConfig>;
