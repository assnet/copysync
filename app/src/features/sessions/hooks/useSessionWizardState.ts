import { usePersistedState } from '@/hooks/usePersistedState';
import type { SessionChannel } from '../utils';

export interface SessionWizardState {
  step: number;
  phoneInput: string;
  name: string;
  /** Sessão já criada no passo de nome (o assistente segue para conectar). */
  sessionId: string | null;
}

const INITIAL: SessionWizardState = { step: 0, phoneInput: '', name: '', sessionId: null };

/**
 * Estado de trabalho do assistente de nova sessão, por canal, em `sessionStorage`
 * (docs/padrao-ui-painel.md, "Persistência"): recarregar volta ao mesmo passo com os campos
 * preenchidos. `clear()` ao concluir ou cancelar. Senha/código nunca entram aqui.
 */
export function useSessionWizardState(channel: SessionChannel) {
  const [state, setState, clear] = usePersistedState<SessionWizardState>(
    `sessions.createWizard.${channel}`,
    INITIAL,
    { version: 1 },
  );
  const patch = (partial: Partial<SessionWizardState>) => setState((prev) => ({ ...prev, ...partial }));
  return { state, patch, clear };
}
