import { useCallback, useEffect, useRef, useState } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { isServiceUnavailable } from '@/services/apiClient';
import { adminWorkersService } from '@/services/adminWorkers.service';
import { UNCERTAIN_SCALE_EVENT_ERRORS, isUncertainScaleError, scaleEventErrorMessage, scaleRequestErrorMessage } from './rules';
import { workersAdminStrings } from './strings';
import type { WorkerScaleEvent, WorkerScaleStateView } from './types';

const s = workersAdminStrings.scale;

export const WORKER_SCALE_DRAFT_KEY = 'workers.scale.draft';
export const WORKER_SCALE_REFRESH_MS = 20_000;

/**
 * Rascunho do diálogo: alvo, motivo e `requestId`. O `requestId` nasce ao abrir e fica no
 * rascunho, então recarregar a página no meio (ou perder a resposta) reenvia o mesmo pedido.
 * A API recusa o mesmo `requestId` com outro corpo (`REQUEST_ID_REUSED`) e um `requestId` que
 * falhou não serve de novo: mudar alvo/motivo ou receber resposta de erro gera um novo.
 */
export interface WorkerScaleDraft {
  replicas: number | string;
  reason: string;
  requestId: string;
}

export interface WorkerScaleNotice { severity: 'success' | 'info' | 'warning'; text: string }

/** Erros que mudam o estado no servidor: depois deles a tela relê o estado. */
const RELOAD_ON = new Set([
  'SCALE_COOLDOWN_ACTIVE', 'SCALE_TARGET_UNCHANGED', 'SCALER_NOT_CONFIGURED', 'SCALER_MODE_OFF',
  'ADOPTION_DISABLED', 'SCALER_SERVICE_NOT_SCALABLE', 'SCALE_TARGET_OUT_OF_RANGE',
]);

function newRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Aba Escala (WSCALE-14): estado (a cada 20 s, pulado com a aba oculta e relido ao voltar),
 * histórico por cursor opaco e pedido de réplicas com rascunho persistido na aba.
 */
export function useWorkerScale() {
  const [view, setView] = useState<WorkerScaleStateView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 1ª leitura falhou por API fora do ar (deploy); só limpa ao concluir uma leitura. */
  const [loadUnavailable, setLoadUnavailable] = useState(false);
  const [refreshError, setRefreshError] = useState(false);

  const [events, setEvents] = useState<WorkerScaleEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState(false);

  const [draft, setDraft, clearDraft] = usePersistedState<WorkerScaleDraft | null>(WORKER_SCALE_DRAFT_KEY, null);
  /** `requestId` do rascunho que veio da recarga: enquanto for o mesmo, o botão diz "Reenviar". */
  const [restoredRequestId] = useState<string | null>(() => draft?.requestId ?? null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [notice, setNotice] = useState<WorkerScaleNotice | null>(null);
  const eventsSeq = useRef(0);
  const stateSeq = useRef(0);
  const sendingRef = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  /** O rascunho restaurado reabre sozinho só na 1ª leitura com o escalador pronto; depois, só pelo aviso. */
  const autoOpenChecked = useRef(false);

  const loadState = useCallback(async (initial: boolean) => {
    const seq = ++stateSeq.current;
    if (initial) {
      setLoading(true);
      setLoadError(null);
    }
    try {
      const next = await adminWorkersService.getScale();
      if (seq !== stateSeq.current) return;
      setView(next);
      setRefreshError(false);
      setLoadError(null);
      setLoadUnavailable(false);
      // Só a leitura `ready` consome a reabertura automática: escalador fora no boot adia para a 1ª pronta.
      if (!autoOpenChecked.current && next.scaler.status === 'ready') {
        autoOpenChecked.current = true;
        if (draftRef.current) setDialogOpen(true);
      }
    } catch (err) {
      if (seq !== stateSeq.current) return;
      if (initial) {
        setLoadError(s.errors.loadFailed);
        setLoadUnavailable(isServiceUnavailable(err));
      }
      else setRefreshError(true);
    } finally {
      // Qualquer leitura vigente encerra o carregamento (a 1ª pode ter sido superada por outra).
      if (seq === stateSeq.current) setLoading(false);
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
    // Aba volta a ficar visível: lê na hora (o intervalo segue o mesmo, sem duplicar).
    const onVisible = () => {
      if (!document.hidden) void loadState(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadEvents, loadState]);

  /** Evento novo no estado (job automático ou outro admin): relê a 1ª página do histórico. */
  const lastEventId = view ? (view.lastEvent?.id ?? null) : undefined;
  const seenLastEventId = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (lastEventId === undefined) return;
    const seen = seenLastEventId.current;
    seenLastEventId.current = lastEventId;
    if (seen !== undefined && seen !== lastEventId) void loadEvents(null);
  }, [lastEventId, loadEvents]);

  const renewRequestId = useCallback(() => {
    setDraft((prev) => (prev ? { ...prev, requestId: newRequestId() } : prev));
  }, [setDraft]);

  /**
   * Abre o diálogo. Sem `replicas` (Revisar, Escolher alvo) reabre o rascunho como está. Com o alvo
   * clicado (Subir/Reduzir 1): igual ao do rascunho reabre o mesmo pedido (mesmo `requestId`);
   * diferente troca o alvo num pedido novo (`requestId` novo) e mantém o motivo já digitado.
   */
  const openDialog = useCallback((replicas?: number) => {
    setRequestError(null);
    setNotice(null);
    const current = draftRef.current;
    if (current && (replicas === undefined || String(current.replicas) === String(replicas))) {
      setDialogOpen(true);
      return;
    }
    if (replicas === undefined) return;
    setDraft({ replicas, reason: current?.reason ?? '', requestId: newRequestId() });
    setDialogOpen(true);
  }, [setDraft]);

  const changeDraft = useCallback((patch: Partial<Pick<WorkerScaleDraft, 'replicas' | 'reason'>>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      const changed = String(next.replicas) !== String(prev.replicas) || next.reason !== prev.reason;
      // Corpo novo exige `requestId` novo; durante o envio em voo o pedido fica como foi.
      return changed && !sendingRef.current ? { ...next, requestId: newRequestId() } : next;
    });
    setRequestError(null);
  }, [setDraft]);

  const cancel = useCallback(() => {
    clearDraft();
    setDialogOpen(false);
    setRequestError(null);
  }, [clearDraft]);

  /**
   * Falha incerta (o provedor pode ter aplicado): fecha o diálogo e descarta o rascunho (nada de
   * reabrir nem reenviar sozinho), avisa na aba e relê estado e histórico para mostrar o intervalo.
   */
  const settleUncertain = useCallback((text: string) => {
    clearDraft();
    setDialogOpen(false);
    setRequestError(null);
    setNotice({ severity: 'warning', text });
    void loadState(false);
    void loadEvents(null);
  }, [clearDraft, loadEvents, loadState]);

  /** `true` quando o pedido foi aceito (novo ou replay de um pedido `succeeded`). */
  const submit = useCallback(async (): Promise<boolean> => {
    if (!draft || sendingRef.current) return false;
    sendingRef.current = true;
    setSending(true);
    setRequestError(null);
    try {
      const res = await adminWorkersService.requestScale({
        replicas: Number(draft.replicas),
        reason: draft.reason.trim(),
        requestId: draft.requestId,
      });
      const { outcome } = res.event;
      if (res.replayed && outcome === 'requested') {
        // Replay sem resultado confirmado (em andamento ou interrompido): não é sucesso; o rascunho fica.
        setRequestError(s.requestErrors.pendingReplay);
        void loadState(false);
        void loadEvents(null);
        return false;
      }
      if (outcome === 'failed' && res.event.error && UNCERTAIN_SCALE_EVENT_ERRORS.includes(res.event.error)) {
        settleUncertain(res.replayed ? s.requestErrors.failedReplay(s.requestErrors.uncertain) : s.requestErrors.uncertain);
        return false;
      }
      if (outcome !== 'succeeded' && outcome !== 'requested') {
        // Falhou (agora ou no replay): o `requestId` não serve mais; diálogo e rascunho ficam.
        const detail = scaleEventErrorMessage(res.event.error);
        setRequestError(res.replayed ? s.requestErrors.failedReplay(detail) : detail);
        renewRequestId();
        void loadState(false);
        void loadEvents(null);
        return false;
      }
      clearDraft();
      setDialogOpen(false);
      setNotice(res.replayed
        ? { severity: 'info', text: s.notices.replayed }
        : { severity: 'success', text: s.notices.success(res.event.fromReplicas, res.event.toReplicas) });
      void loadState(false);
      void loadEvents(null);
      return true;
    } catch (err) {
      if (isUncertainScaleError(err)) {
        settleUncertain(s.requestErrors.uncertain);
        return false;
      }
      setRequestError(scaleRequestErrorMessage(err));
      const code = (err as { code?: string }).code;
      // Resposta com código = o servidor decidiu (recusa, falha no provedor, id reusado): o
      // próximo envio é um pedido novo. Sem resposta (rede), mantém o id para o replay.
      if (code) renewRequestId();
      if (code && RELOAD_ON.has(code)) void loadState(false);
      return false;
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [clearDraft, draft, loadEvents, loadState, renewRequestId, settleUncertain]);

  return {
    view, loading, loadError, loadUnavailable, refreshError,
    events, nextCursor, eventsLoading, eventsError,
    draft, dialogOpen, sending, requestError, notice,
    /** Rascunho veio da recarga e ainda é o mesmo pedido: a ação do diálogo é "Reenviar". */
    resend: draft !== null && draft.requestId === restoredRequestId,
    reload: () => loadState(true),
    refresh: () => loadState(false),
    loadMore: () => (nextCursor ? loadEvents(nextCursor) : Promise.resolve()),
    reloadEvents: () => loadEvents(null),
    openDialog, changeDraft, cancel, submit,
    clearNotice: () => setNotice(null),
  };
}
