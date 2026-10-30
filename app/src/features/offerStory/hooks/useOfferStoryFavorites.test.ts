import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { readPersisted, writePersisted } from '@/hooks/usePersistedState';
import { useOfferStoryFavorites } from './useOfferStoryFavorites';

const KEY = 'offerStory.favorites';
const CATALOG = ['flash-night', 'blue-burst'];

describe('useOfferStoryFavorites', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

  it('liga/desliga e salva no navegador', () => {
    const { result } = renderHook(() => useOfferStoryFavorites(CATALOG));
    act(() => result.current.toggle('blue-burst'));
    expect(result.current.isFavorite('blue-burst')).toBe(true);
    expect(readPersisted(KEY, { scope: 'browser' })).toEqual(['blue-burst']);
    act(() => result.current.toggle('blue-burst'));
    expect(result.current.favorites).toEqual([]);
  });

  it('ignora id fora do catálogo e limpa o salvo quando o catálogo chega', () => {
    writePersisted(KEY, ['gone', 'flash-night', 42], { scope: 'browser' });
    const { result, rerender } = renderHook(({ ids }: { ids: string[] | null }) => useOfferStoryFavorites(ids), { initialProps: { ids: null as string[] | null } });
    // catálogo carregando: lixo sai, id desconhecido fica até o catálogo chegar
    expect(readPersisted(KEY, { scope: 'browser' })).toEqual(['gone', 'flash-night']);
    rerender({ ids: CATALOG });
    expect(result.current.favorites).toEqual(['flash-night']);
    expect(readPersisted(KEY, { scope: 'browser' })).toEqual(['flash-night']);
  });
});
