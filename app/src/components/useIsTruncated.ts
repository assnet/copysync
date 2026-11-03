import { useLayoutEffect, useState, type RefObject } from 'react';

/** Elemento cortado com reticências: conteúdo mais largo que a caixa. */
export function isElementTruncated(el: HTMLElement | null | undefined): boolean {
  return !!el && el.scrollWidth > el.clientWidth;
}

/**
 * Diz se o texto do elemento está cortado (`scrollWidth > clientWidth`). Recalcula quando o elemento muda de
 * tamanho (`ResizeObserver`) e quando `content` muda. `select` mede um descendente (ex.: `.MuiChip-label`);
 * deve ser estável (função de módulo).
 */
export function useIsTruncated<T extends HTMLElement>(
  ref: RefObject<T | null>,
  content?: unknown,
  select?: (el: T) => HTMLElement | null,
): boolean {
  const [truncated, setTruncated] = useState(false);

  useLayoutEffect(() => {
    const root = ref.current;
    const el = root ? (select ? select(root) : root) : null;
    if (!el) {
      setTruncated(false);
      return;
    }
    const measure = () => setTruncated(isElementTruncated(el));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, content, select]);

  return truncated;
}
