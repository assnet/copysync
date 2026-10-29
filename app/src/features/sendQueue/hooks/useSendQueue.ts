import { useCallback, useEffect, useRef, useState } from 'react';
import { sendQueueService } from '@/services/sendQueue.service';
import type { SendQueueResponse } from '@/types/api.types';

/** Com algo saindo ou na fila: atualiza rápido. Fila vazia: devagar. */
export const SEND_QUEUE_ACTIVE_POLL_MS = 5_000;
export const SEND_QUEUE_IDLE_POLL_MS = 20_000;

export function hasActivity(data: SendQueueResponse | null): boolean {
  return Boolean(data?.sessions.some((s) => s.running || s.waiting.length > 0));
}

/**
 * Fila de envio lida do servidor (nada guardado na aba): toda aba e todo navegador veem o mesmo.
 * Polling encadeado com `setTimeout` (sem sobreposição); pausa com a aba oculta e atualiza ao voltar.
 */
export function useSendQueue(sessionId?: string) {
  const [data, setData] = useState<SendQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Geração: troca de sessão ou desmontagem invalida respostas e timers da geração anterior
  const generation = useRef(0);
  const inFlight = useRef<number | null>(null);
  const pending = useRef<Promise<void> | null>(null);

  const load = useCallback(async () => {
    const gen = generation.current;
    if (inFlight.current === gen) return;
    inFlight.current = gen;
    clearTimeout(timer.current);
    let next: SendQueueResponse | null = null;
    let release!: () => void;
    pending.current = new Promise<void>((r) => { release = r; });
    try {
      next = await sendQueueService.get(sessionId);
      if (gen === generation.current) { setData(next); setFailed(false); }
    } catch {
      if (gen === generation.current) setFailed(true);
    } finally {
      if (inFlight.current === gen) inFlight.current = null;
      pending.current = null;
      release();
      if (gen === generation.current) {
        setLoading(false);
        if (!document.hidden) {
          const delay = hasActivity(next) ? SEND_QUEUE_ACTIVE_POLL_MS : SEND_QUEUE_IDLE_POLL_MS;
          timer.current = setTimeout(() => void load(), delay);
        }
      }
    }
  }, [sessionId]);

  useEffect(() => {
    generation.current++;
    inFlight.current = null;
    setData(null);
    setLoading(true);
    void load();
    const onVisible = () => {
      if (document.hidden) clearTimeout(timer.current);
      else void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      generation.current++;
      clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  /** Pedido explícito (botão, após pausar/retomar): espera o poll em voo e busca de novo, nunca vira no-op. */
  const refresh = useCallback(async () => {
    if (pending.current) await pending.current;
    await load();
  }, [load]);

  return { data, loading, failed, refresh };
}
