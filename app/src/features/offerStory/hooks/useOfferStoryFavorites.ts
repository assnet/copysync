import { useCallback, useEffect, useMemo } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';

const KEY = 'offerStory.favorites';

/**
 * Templates favoritos, preferência do navegador (`browser`). Id fora do catálogo (template removido)
 * é ignorado e some do salvo quando o catálogo chega. `catalogIds` null = catálogo ainda carregando.
 */
export function useOfferStoryFavorites(catalogIds: readonly string[] | null) {
  const [saved, setSaved] = usePersistedState<string[]>(KEY, [], {
    scope: 'browser',
    deserialize: (raw) => (Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []),
  });

  const favorites = useMemo(() => (catalogIds ? saved.filter((id) => catalogIds.includes(id)) : saved), [saved, catalogIds]);

  useEffect(() => {
    if (catalogIds && favorites.length !== saved.length) setSaved(favorites);
  }, [catalogIds, favorites, saved.length, setSaved]);

  const isFavorite = useCallback((id: string) => favorites.includes(id), [favorites]);
  const toggle = useCallback(
    (id: string) => setSaved((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id])),
    [setSaved],
  );

  return { favorites, isFavorite, toggle };
}
