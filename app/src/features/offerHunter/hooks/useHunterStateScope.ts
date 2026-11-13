import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';

export { hunterStateKey } from '../stateKey';

/**
 * Dono do estado de trabalho do caçador na aba: tenant ativo + usuário. Entra na chave de todo `usePersistedState`
 * do caçador (rascunho de uma conta nunca abre em outra na mesma aba). Quem lê a chave remonta quando ele muda.
 */
export function useHunterStateScope(): string {
  const { user } = useAuth();
  const { activeTenantId } = useTenant();
  return `${activeTenantId ?? ''}:${user?.id ?? ''}`;
}
