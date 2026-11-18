import { useEffect, useRef } from 'react';
import { tabsClasses } from '@mui/material';

/**
 * Mantém a aba selecionada visível numa `<Tabs variant="scrollable">` quando a largura muda sem recarregar.
 *
 * O MUI só rola a aba selecionada para a vista ao montar ou ao trocar de aba: ao estreitar a janela (1440 → 390 px)
 * a posição das abas no trilho não muda, então ele não rola e a aba ativa fica cortada ("TE…") até o reload.
 * Aqui um `ResizeObserver` no trilho ajusta o `scrollLeft` só o necessário. Passe o `ref` para a `<Tabs>`.
 */
export function useSelectedTabInView<T>(value: T) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = ref.current?.querySelector<HTMLElement>(`.${tabsClasses.scroller}`);
    if (!scroller || typeof ResizeObserver === 'undefined') return undefined;
    const fit = () => {
      const tab = scroller.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      if (!tab) return;
      const box = scroller.getBoundingClientRect();
      const r = tab.getBoundingClientRect();
      if (r.left < box.left) scroller.scrollLeft -= box.left - r.left;
      else if (r.right > box.right) scroller.scrollLeft += Math.min(r.right - box.right, r.left - box.left);
    };
    const observer = new ResizeObserver(fit);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [value]);
  return ref;
}
