import { useCallback, useEffect, useRef, useState } from 'react';
import { broadcastGroupsService } from '@/services/broadcastGroups.service';
import type { BroadcastGroupsResponse } from '@/types/api.types';

/**
 * Catálogo dos grupos de disparo (dado do servidor: recarregado, nunca persistido na aba).
 * `remove` tira o grupo de todos os usos e recarrega a lista para os chips `n / limite` baterem com a API.
 */
export function useBroadcastGroups() {
  const [data, setData] = useState<BroadcastGroupsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  // Só a resposta do load mais recente é aplicada (remover durante um load em voo)
  const seq = useRef(0);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    const id = ++seq.current;
    setLoading(true);
    setFailed(false);
    try {
      const next = await broadcastGroupsService.list();
      if (mounted.current && id === seq.current) setData(next);
    } catch {
      if (mounted.current && id === seq.current) setFailed(true);
    } finally {
      if (mounted.current && id === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
  }, [load]);

  /** Erro do DELETE sobe para a tela (aviso); a lista só muda pelo GET seguinte. */
  const remove = useCallback(async (conversationId: string) => {
    setRemoving(conversationId);
    try {
      await broadcastGroupsService.remove(conversationId);
    } finally {
      if (mounted.current) setRemoving(null);
    }
    await load();
  }, [load]);

  return { data, loading, failed, removing, reload: load, remove };
}
