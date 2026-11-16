import { useCallback, useRef, useState } from 'react';
import { offerHunterService } from '@/services/offerHunter.service';
import type { HuntRankingSendAllResult } from '../types';
import { huntErrorCode } from './useHuntResource';

export type RankingSendOutcome = { ok: true } | { ok: false; code: string | null };
export type RankingSendAllOutcome = { ok: true; result: HuntRankingSendAllResult } | { ok: false; code: string | null };

/**
 * Envio de itens do ranking de uma execução (um a um, ou todos para super admin). Um envio por vez:
 * a trava em ref barra o clique duplo antes do re-render desabilitar o botão. Nunca rejeita.
 */
export function useRankingSend(huntId: string, runId: string) {
  const [busyProductId, setBusyProductId] = useState<string | null>(null);
  const [sendingAll, setSendingAll] = useState(false);
  const lock = useRef(false);

  const sendOne = useCallback(async (productId: string): Promise<RankingSendOutcome> => {
    if (lock.current) return { ok: false, code: null };
    lock.current = true;
    setBusyProductId(productId);
    try {
      await offerHunterService.sendRankingItem(huntId, runId, productId);
      return { ok: true };
    } catch (err) {
      return { ok: false, code: huntErrorCode(err) };
    } finally {
      lock.current = false;
      setBusyProductId(null);
    }
  }, [huntId, runId]);

  const sendAll = useCallback(async (): Promise<RankingSendAllOutcome> => {
    if (lock.current) return { ok: false, code: null };
    lock.current = true;
    setSendingAll(true);
    try {
      return { ok: true, result: await offerHunterService.sendAllRanking(huntId, runId) };
    } catch (err) {
      return { ok: false, code: huntErrorCode(err) };
    } finally {
      lock.current = false;
      setSendingAll(false);
    }
  }, [huntId, runId]);

  return { busyProductId, sendingAll, busy: busyProductId !== null || sendingAll, sendOne, sendAll };
}
