import { useCallback, useState } from 'react';
import { offerHunterService } from '@/services/offerHunter.service';
import type { CreateHuntInput, Hunt, HuntRunResult, UpdateHuntInput } from '../types';
import { useHuntResource } from './useHuntResource';

const replace = (list: Hunt[] | null, hunt: Hunt) => (list ?? []).map((h) => (h.id === hunt.id ? hunt : h));

/**
 * Lista de caçadas + mutações que atualizam a lista local (sem recarregar). Mutações rejeitam com o
 * erro do `apiClient` (`offerHunterErrorMessage(err)` na tela). `busyId` = caçada com ação em andamento.
 */
export function useOfferHunts() {
  const r = useHuntResource('hunts', offerHunterService.list);
  const { setData } = r;
  const [busyId, setBusyId] = useState<string | null>(null);

  const track = useCallback(async <T,>(id: string, fn: () => Promise<T>): Promise<T> => {
    setBusyId(id);
    try {
      return await fn();
    } finally {
      setBusyId((cur) => (cur === id ? null : cur));
    }
  }, []);

  const create = useCallback(async (body: CreateHuntInput) => {
    const hunt = await offerHunterService.create(body);
    setData((list) => [...(list ?? []), hunt]);
    return hunt;
  }, [setData]);

  const update = useCallback((id: string, body: UpdateHuntInput) => track(id, async () => {
    const hunt = await offerHunterService.update(id, body);
    setData((list) => replace(list, hunt));
    return hunt;
  }), [setData, track]);

  const remove = useCallback((id: string) => track(id, async () => {
    await offerHunterService.remove(id);
    setData((list) => (list ?? []).filter((h) => h.id !== id));
  }), [setData, track]);

  /** `<Switch>` de pausa: true = ligada (retoma), false = pausa. */
  const setActive = useCallback((id: string, active: boolean) => track(id, async () => {
    const hunt = active ? await offerHunterService.resume(id) : await offerHunterService.pause(id);
    setData((list) => replace(list, hunt));
    return hunt;
  }), [setData, track]);

  return { ...r, hunts: r.data, busyId, create, update, remove, setActive };
}

/**
 * Uma caçada (detalhe/edição) + "Testar agora". `run` guarda o último resultado em `lastRun`
 * (só em memória: é dado do servidor). Depois de rodar, recarregar uso e histórico na tela.
 */
export function useOfferHunt(huntId: string | null | undefined) {
  const id = huntId || null;
  const load = useCallback(() => offerHunterService.get(id as string), [id]);
  const r = useHuntResource(id, load);
  const { setData, reload } = r;
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<HuntRunResult | null>(null);
  const [saving, setSaving] = useState(false);

  const update = useCallback(async (body: UpdateHuntInput) => {
    if (!id) throw new Error('hunt id required');
    setSaving(true);
    try {
      const hunt = await offerHunterService.update(id, body);
      setData(hunt);
      return hunt;
    } finally {
      setSaving(false);
    }
  }, [id, setData]);

  const setActive = useCallback(async (active: boolean) => {
    if (!id) throw new Error('hunt id required');
    const hunt = active ? await offerHunterService.resume(id) : await offerHunterService.pause(id);
    setData(hunt);
    return hunt;
  }, [id, setData]);

  const run = useCallback(async () => {
    if (!id) throw new Error('hunt id required');
    setRunning(true);
    try {
      const result = await offerHunterService.run(id);
      setLastRun(result);
      // Pausa automática durante a execução: recarrega para refletir status/motivo
      if (result.pausedReason) void reload();
      return result;
    } finally {
      setRunning(false);
    }
  }, [id, reload]);

  return { ...r, hunt: r.data, saving, running, lastRun, clearLastRun: () => setLastRun(null), update, setActive, run };
}
