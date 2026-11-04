import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { BroadcastGroupsResponse } from '@/types/api.types';

const list = vi.fn();
const remove = vi.fn();
vi.mock('@/services/broadcastGroups.service', () => ({
  broadcastGroupsService: { list: () => list(), remove: (id: string) => remove(id) },
}));

import { useBroadcastGroups } from './useBroadcastGroups';

const item = (conversationId: string) => ({
  conversationId, sessionId: 's1', channel: 'whatsapp' as const, title: 'G', avatarUrl: null, usedBy: ['generator' as const],
});
const resp = (ids: string[]): BroadcastGroupsResponse => ({
  items: ids.map(item),
  limits: { whatsapp: { broadcastGroups: 5 }, telegram: { broadcastGroups: 0 } },
  usage: { whatsapp: { broadcastGroups: ids.length }, telegram: { broadcastGroups: 0 } },
});

beforeEach(() => { list.mockReset(); remove.mockReset(); });

describe('useBroadcastGroups', () => {
  it('carrega o catálogo ao montar', async () => {
    list.mockResolvedValue(resp(['c1', 'c2']));
    const { result } = renderHook(() => useBroadcastGroups());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.items).toHaveLength(2);
    expect(result.current.failed).toBe(false);
  });

  it('falha no GET marca failed', async () => {
    list.mockRejectedValue(new Error('x'));
    const { result } = renderHook(() => useBroadcastGroups());
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('remover chama o DELETE pelo id e recarrega a lista e o uso', async () => {
    list.mockResolvedValueOnce(resp(['c1', 'c2'])).mockResolvedValueOnce(resp(['c2']));
    remove.mockResolvedValue(undefined);
    const { result } = renderHook(() => useBroadcastGroups());
    await waitFor(() => expect(result.current.data?.items).toHaveLength(2));
    await act(async () => { await result.current.remove('c1'); });
    expect(remove).toHaveBeenCalledWith('c1');
    expect(list).toHaveBeenCalledTimes(2);
    expect(result.current.data?.items.map((i) => i.conversationId)).toEqual(['c2']);
    expect(result.current.data?.usage.whatsapp.broadcastGroups).toBe(1);
    expect(result.current.removing).toBeNull();
  });

  it('erro no DELETE sobe, não recarrega e mantém a lista', async () => {
    list.mockResolvedValue(resp(['c1']));
    remove.mockRejectedValue(new Error('PLAN'));
    const { result } = renderHook(() => useBroadcastGroups());
    await waitFor(() => expect(result.current.data).not.toBeNull());
    await act(async () => { await expect(result.current.remove('c1')).rejects.toThrow('PLAN'); });
    expect(list).toHaveBeenCalledTimes(1);
    expect(result.current.data?.items).toHaveLength(1);
    expect(result.current.removing).toBeNull();
  });

  it('resposta de load antigo não sobrescreve a do mais recente', async () => {
    let resolveFirst!: (v: BroadcastGroupsResponse) => void;
    list.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; })).mockResolvedValueOnce(resp(['novo']));
    const { result } = renderHook(() => useBroadcastGroups());
    await act(async () => { await result.current.reload(); });
    await act(async () => { resolveFirst(resp(['velho'])); });
    expect(result.current.data?.items.map((i) => i.conversationId)).toEqual(['novo']);
  });
});
