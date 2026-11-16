import { useCallback, useMemo, useRef, useState } from 'react';
import { offerHunterService } from '@/services/offerHunter.service';
import type { HuntRankingItem, HuntRun } from '../types';
import { huntErrorCode } from './useHuntResource';

export type RunRankingEntry =
  | { state: 'loading' }
  | { state: 'ready'; items: HuntRankingItem[] | null; sentProductIds: string[]; reusable: boolean }
  | { state: 'error'; errorCode: string | null };

export interface RunRankings {
  get: (runId: string) => RunRankingEntry | undefined;
  /** Busca o ranking da execução (`GET /:id/runs/:runId`) se ainda não está em cache ou carregando. */
  load: (runId: string) => void;
  /** Nova tentativa após erro. */
  retry: (runId: string) => void;
  /** Recarrega sem voltar a "carregando" (após enviar item do ranking); erro mantém o que havia. */
  refresh: (runId: string) => void;
  /** Marca o produto como enviado já (otimista) enquanto o `refresh` não volta. */
  markSent: (runId: string, productId: string) => void;
}

const readyEntry = (run: HuntRun): RunRankingEntry => ({
  state: 'ready', items: run.ranking ?? null, sentProductIds: run.sentProductIds ?? [], reusable: run.rankingReusable === true,
});

/**
 * Ranking sob demanda por execução: a lista de execuções só traz `hasRanking`. Cache por execução
 * enquanto a tela está aberta (mora na página, sobrevive à troca de aba); trocar de caçada zera.
 * Ranking é dado do servidor: nunca persistido.
 */
export function useRunRankings(huntId: string | null | undefined): RunRankings {
  const id = huntId || null;
  const [entries, setEntries] = useState<Record<string, RunRankingEntry>>({});
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const huntRef = useRef(id);
  // Troca de caçada zera o cache já no render (efeito do filho que pede o ranking roda antes do efeito daqui)
  if (huntRef.current !== id) {
    huntRef.current = id;
    entriesRef.current = {};
    setEntries({});
  }

  const fetchRun = useCallback((runId: string) => {
    if (!id) return;
    const forHunt = id;
    entriesRef.current = { ...entriesRef.current, [runId]: { state: 'loading' } };
    setEntries((s) => ({ ...s, [runId]: { state: 'loading' } }));
    offerHunterService.getRun(forHunt, runId).then(
      (run) => {
        if (huntRef.current !== forHunt) return;
        setEntries((s) => ({ ...s, [runId]: readyEntry(run) }));
      },
      (err: unknown) => {
        if (huntRef.current !== forHunt) return;
        setEntries((s) => ({ ...s, [runId]: { state: 'error', errorCode: huntErrorCode(err) } }));
      },
    );
  }, [id]);

  const load = useCallback((runId: string) => {
    if (entriesRef.current[runId]) return;
    fetchRun(runId);
  }, [fetchRun]);

  const refresh = useCallback((runId: string) => {
    if (!id) return;
    const forHunt = id;
    offerHunterService.getRun(forHunt, runId).then(
      (run) => { if (huntRef.current === forHunt) setEntries((s) => ({ ...s, [runId]: readyEntry(run) })); },
      () => undefined,
    );
  }, [id]);

  const markSent = useCallback((runId: string, productId: string) => {
    setEntries((s) => {
      const e = s[runId];
      if (e?.state !== 'ready' || e.sentProductIds.includes(productId)) return s;
      return { ...s, [runId]: { ...e, sentProductIds: [...e.sentProductIds, productId] } };
    });
  }, []);

  const get = useCallback((runId: string) => entries[runId], [entries]);

  return useMemo(() => ({ get, load, retry: fetchRun, refresh, markSent }), [get, load, fetchRun, refresh, markSent]);
}
