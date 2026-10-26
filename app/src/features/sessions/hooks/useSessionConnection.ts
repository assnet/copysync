import { useCallback, useEffect, useRef, useState } from 'react';
import { sessionService } from '@/services/session.service';
import { resolveMediaUrl } from '@/utils/resolveMediaUrl';
import type { SessionItem, SessionStatus } from '@/types/api.types';
import { sessionStrings as t } from '../strings';
import { QR_TTL_MS, isQrExpired, qrSecondsLeft } from '../utils';

export type ConnectionMode = 'qr' | 'pairing';

const POLL_MS = 2000;
const TICK_MS = 500;
const STOPPED: SessionStatus[] = ['CONNECTED', 'FAILED', 'LOGGED_OUT', 'DISCONNECTED'];
const RECONNECTABLE: SessionStatus[] = ['DISCONNECTED', 'FAILED', 'LOGGED_OUT'];

interface Options {
  sessionId: string | null;
  /** Liga o polling; desligado, o estado é zerado. */
  enabled: boolean;
  onStatusChange?: (sessionId: string, status: SessionStatus) => void;
}

/**
 * Estado da conexão de uma sessão: polling de status + QR (ou código de pareamento),
 * contagem regressiva do QR atual e ações de "gerar novo código" / "conectar com código".
 * Usado pelo assistente de nova sessão e pelo "conectar" do cartão — mesmo comportamento.
 */
export function useSessionConnection({ sessionId, enabled, onStatusChange }: Options) {
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [mode, setMode] = useState<ConnectionMode>('qr');
  const [session, setSession] = useState<SessionItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [qrIssuedAt, setQrIssuedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /** Muda para reiniciar o polling depois de uma ação. */
  const [pollKey, setPollKey] = useState(0);

  const statusRef = useRef<SessionStatus | null>(null);
  const modeRef = useRef<ConnectionMode>('qr');
  const lastQrRef = useRef<string | null>(null);
  const onStatusRef = useRef(onStatusChange);
  useEffect(() => { onStatusRef.current = onStatusChange; }, [onStatusChange]);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  const applyStatus = useCallback((id: string, next: SessionStatus) => {
    if (statusRef.current !== next) onStatusRef.current?.(id, next);
    statusRef.current = next;
    setStatus(next);
  }, []);

  const fetchOnce = useCallback(async (id: string) => {
    const [st, code] = await Promise.all([
      sessionService.getStatus(id),
      modeRef.current === 'qr'
        ? sessionService.getQr(id).then((r) => ({ qr: r.qrCode, pairing: null }))
        : sessionService.getPairingCode(id).then((r) => ({ qr: null, pairing: r.pairingCode })),
    ]);
    applyStatus(id, st.status);
    if (modeRef.current === 'qr') {
      if (code.qr && code.qr !== lastQrRef.current) {
        lastQrRef.current = code.qr;
        setQrIssuedAt(Date.now());
      }
      setQrCode(code.qr);
    } else if (code.pairing) {
      setPairingCode(code.pairing);
    }
    if (st.status === 'CONNECTED') {
      const full = await sessionService.getById(id);
      setSession({ ...full, avatarUrl: resolveMediaUrl(full.avatarUrl) });
    }
    setError(null);
    return st.status;
  }, [applyStatus]);

  // Polling: para quando conecta ou cai; recomeça a cada `pollKey`.
  useEffect(() => {
    if (!enabled || !sessionId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      try {
        const st = await fetchOnce(sessionId);
        if (!alive || STOPPED.includes(st)) return;
      } catch {
        if (!alive) return;
        setError(t.connect.fetchError);
      }
      timer = setTimeout(run, POLL_MS);
    };
    void run();
    return () => { alive = false; clearTimeout(timer); };
  }, [enabled, sessionId, pollKey, fetchOnce]);

  // Relógio da contagem regressiva, só enquanto há QR na tela.
  useEffect(() => {
    if (!enabled || mode !== 'qr' || !qrIssuedAt || status === 'CONNECTED') return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [enabled, mode, qrIssuedAt, status]);

  // Fechou: zera tudo para a próxima abertura.
  useEffect(() => {
    if (enabled) return;
    statusRef.current = null;
    lastQrRef.current = null;
    setStatus(null); setQrCode(null); setPairingCode(null); setSession(null);
    setError(null); setMode('qr'); setQrIssuedAt(null); setBusy(false);
  }, [enabled]);

  /** Garante uma tentativa de conexão viva (a API só aceita conectar a partir de certos estados). */
  const restart = useCallback(async (id: string) => {
    const current = statusRef.current;
    let res;
    if (current === 'PENDING') res = await sessionService.connect(id);
    else if (current && RECONNECTABLE.includes(current)) res = await sessionService.reconnect(id);
    else {
      await sessionService.disconnect(id);
      res = await sessionService.reconnect(id);
    }
    applyStatus(id, res.status);
  }, [applyStatus]);

  const regenerate = useCallback(async () => {
    if (!sessionId) return;
    setBusy(true); setError(null);
    lastQrRef.current = null;
    setQrCode(null); setQrIssuedAt(null); setPairingCode(null);
    try {
      await restart(sessionId);
      if (modeRef.current === 'pairing') {
        const res = await sessionService.startPairing(sessionId);
        if (res.pairingCode) setPairingCode(res.pairingCode);
        applyStatus(sessionId, res.status);
      }
    } catch {
      setError(modeRef.current === 'pairing' ? t.connect.pairingError : t.connect.actionError);
    } finally {
      setBusy(false);
      setPollKey((k) => k + 1);
    }
  }, [sessionId, restart, applyStatus]);

  const switchToPairing = useCallback(async () => {
    if (!sessionId) return;
    modeRef.current = 'pairing';
    setMode('pairing'); setBusy(true); setError(null); setPairingCode(null);
    try {
      const current = statusRef.current;
      if (!current || STOPPED.includes(current) || current === 'PENDING') await restart(sessionId);
      const res = await sessionService.startPairing(sessionId);
      if (res.pairingCode) setPairingCode(res.pairingCode);
      applyStatus(sessionId, res.status);
    } catch {
      setError(t.connect.pairingError);
    } finally {
      setBusy(false);
      setPollKey((k) => k + 1);
    }
  }, [sessionId, restart, applyStatus]);

  const switchToQr = useCallback(() => {
    modeRef.current = 'qr';
    setMode('qr'); setError(null);
    // O socket em modo código não emite QR novo: reinicia para voltar a ter QR.
    void regenerate();
  }, [regenerate]);

  const isConnected = status === 'CONNECTED';
  const isFailed = status === 'FAILED' || status === 'LOGGED_OUT' || status === 'DISCONNECTED' || status === 'PENDING';
  const secondsLeft = qrIssuedAt ? qrSecondsLeft(qrIssuedAt, now) : null;
  const qrExpired = Boolean(qrIssuedAt && isQrExpired(qrIssuedAt, now));

  return {
    status,
    mode,
    qrCode,
    pairingCode,
    session,
    error,
    busy,
    isConnected,
    isFailed,
    secondsLeft,
    qrTtlSeconds: QR_TTL_MS / 1000,
    qrExpired,
    regenerate,
    switchToPairing,
    switchToQr,
  };
}

export type SessionConnection = ReturnType<typeof useSessionConnection>;
