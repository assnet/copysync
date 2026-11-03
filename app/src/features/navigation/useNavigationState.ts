import { useCallback, useEffect, useMemo } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { findActiveEntry, type NavigationModel } from './model';

export const EXPANDED_PRODUCTS_KEY = 'navigation.expandedProducts';
const DEFAULT_EXPANDED = ['affiliates'];

export interface NavigationState {
  active: ReturnType<typeof findActiveEntry>;
  isExpanded: (productKey: string) => boolean;
  toggle: (productKey: string) => void;
}

/**
 * Produtos expandidos no menu, persistidos por navegador (preferência, não estado de trabalho).
 * O produto que contém a rota ativa expande sozinho ao navegar.
 */
export function useNavigationState(model: NavigationModel, pathname: string): NavigationState {
  const [expanded, setExpanded] = usePersistedState<string[]>(
    EXPANDED_PRODUCTS_KEY,
    DEFAULT_EXPANDED,
    { scope: 'browser' },
  );

  const active = useMemo(() => findActiveEntry(model, pathname), [model, pathname]);
  const activeProductKey = active?.product?.key;

  useEffect(() => {
    if (!activeProductKey) return;
    setExpanded((prev) => (prev.includes(activeProductKey) ? prev : [...prev, activeProductKey]));
  }, [activeProductKey, setExpanded]);

  const isExpanded = useCallback((key: string) => expanded.includes(key), [expanded]);
  const toggle = useCallback(
    (key: string) => setExpanded((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key])),
    [setExpanded],
  );

  return { active, isExpanded, toggle };
}
