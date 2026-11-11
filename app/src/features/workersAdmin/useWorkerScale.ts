import { useCallback, useEffect, useRef, useState } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { adminWorkersService } from '@/services/adminWorkers.service';
import { scaleRequestErrorMessage } from './rules';
import { workersAdminStrings } from './strings';
import type { WorkerScaleEvent, WorkerScaleStateView } from './types';

const s = workersAdminStrings.scale;

export const WORKER_SCALE_DRAFT_KEY = 'workers.scale.draft';
export const WORKER_SCALE_REFRESH_MS = 20_000;

/**
 * Rascunho do diálogo: alvo, motivo e `requestId`. O `requestId` nasce ao abrir e fica no
 * rascunho, então "tentar de novo" (ou recarregar a página no meio) reenvia o mesmo pedido.
 */
export interface WorkerScaleDraft {
  replicas: number | string;
  reason: string;
  requestId: string;
}

export interface WorkerScaleNotice { severity: 'success' | 'info'; text: string }

/** Erros que mudam o estado no servidor: depois deles a tela relê o estado. */
const RELOAD_ON = new Set([
  'SCALE_COOLDOWN_ACTIVE', 'SCALE_TARGET_UNCHANGED', 'SCALER_NOT_CONFIGURED', 'SCALER_MODE_OFF',
  'ADOPTION_DISABLED', 'SCALER_SERVICE_NOT_SCALABLE', 'SCALE_TARGET_OUT_OF_RANGE',
]);

function newRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Aba Escala (WSCALE-14): estado (a cada 20 s, pulado com a aba oculta), histórico por cursor
 * opaco e pedido de réplicas com rascunho persistido na aba.
 */
export function useWorkerScale() {
  const [view, setView] = useState<WorkerScaleStateView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState(false);

  const [events, setEvents] = useState<WorkerScaleEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState(false);

  const [draft, setDraft, clearDraft] = usePersistedState<WorkerScaleDraft | null>(WORKER_SCALE_DRAFT_KEY, null);
  const [sending, setSending] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [notice, setNotice] = useState<WorkerScaleNotice | null>(null);
  const eventsSeq = useRef(0);

  const loadState = useCallback(async (initial: boolean) => {
    if (initial) {
      setLoading(true);
      setLoadError(null);
    }
    try {
      setView(await adminWorkersService.getScale());
      setRefreshError(false);
      setLoadError(null);
    } catch {
      if (initial) setLoadError(s.errors.loadFailed);
      else setRefreshError(true);
    } finally {
      if (initial) setLoading(false);
    }
  }, []);

  /** Página do histórico; sem cursor recomeça do topo (descarta respostas de pedidos antigos). */
  const loadEvents = useCallback(async (cursor: string | null) => {
    const seq = ++eventsSeq.current;
    setEventsLoading(true);
    setEventsError(false);
    try {
      const page = await adminWorkersService.listScaleEvents(cursor);
      if (seq !== eventsSeq.current) return;
      setEvents((prev) => (cursor ? [...prev, ...page.items] : page.items));
      setNextCursor(page.nextCursor);
    } catch {
      if (seq === eventsSeq.current) setEventsError(true);
    } finally {
      if (seq === eventsSeq.current) setEventsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadState(true);
    void loadEvents(null);
    // Um só intervalo, recriado só se `loadState` mudar (nunca muda): nada acumula.
    const id = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void loadState(false);
    }, WORKER_SCALE_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [loadEvents, loadState]);

  const openDialog = useCallback((replicas: number) => {
    setRequestError(null);
    setNotice(null);
    setDraft({ replicas, reason: '', requestId: newRequestId() });
  }, [setDraft]);

  const changeDraft = useCallback((patch: Partial<Pick<WorkerScaleDraft, 'replicas' | 'reason'>>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
    setRequestError(null);
  }, [setDraft]);

  const cancel = useCallback(() => {
    clearDraft();
    setRequestError(null);
  }, [clearDraft]);

  /** `true` quando o pedido foi aceito (novo ou replay). */
  const submit = useCallback(async (): Promise<boolean> => {
    if (!draft) return false;
    setSending(true);
    setRequestError(null);
    try {
      const res = await adminWorkersService.requestScale({
        replicas: Number(draft.replicas),
        reason: draft.reason.trim(),
        requestId: draft.requestId,
      });
      clearDraft();
      setNotice(res.replayed
        ? { severity: 'info', text: s.notices.replayed }
        : { severity: 'success', text: s.notices.success(res.event.fromReplicas, res.event.toReplicas) });
      void loadState(false);
      void loadEvents(null);
      return true;
    } catch (err) {
      setRequestError(scaleRequestErrorMessage(err));
      const code = (err as { code?: string }).code;
      if (code && RELOAD_ON.has(code)) void loadState(false);
      return false;
    } finally {
      setSending(false);
    }
  }, [clearDraft, draft, loadEvents, loadState]);

  return {
    view, loading, loadError, refreshError,
    events, nextCursor, eventsLoading, eventsError,
    draft, sending, requestError, notice,
    reload: () => loadState(true),
    refresh: () => loadState(false),
    loadMore: () => (nextCursor ? loadEvents(nextCursor) : Promise.resolve()),
    reloadEvents: () => loadEvents(null),
    openDialog, changeDraft, cancel, submit,
    clearNotice: () => setNotice(null),
  };
}
