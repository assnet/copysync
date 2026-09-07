import { useEffect } from 'react';
import { domGuardian } from '@/shared/dom-guardian/DomGuardian';

/**
 * Ativa o DomGuardian assim que o App monta.
 * Deve ser chamado o mais alto possível na árvore de componentes (App.tsx).
 */
export function useDomGuardian(): void {
  useEffect(() => {
    domGuardian.start();
    return () => domGuardian.stop();
  }, []);
}
