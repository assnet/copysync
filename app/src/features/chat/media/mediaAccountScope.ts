/**
 * Troca de conta (logout ou troca de tenant) para o envio de mídia e o gravador de voz, que vivem
 * no layout autenticado e sobrevivem à troca de página. `AuthContext.logout` e
 * `TenantContext.switchTenant` chamam `reset()` ANTES de trocar o token (como o
 * `reactionDispatcher.reset()`): o que for cancelado ainda sai com o token da conta dona, e nada
 * da conta anterior — upload, confirmação, gravação, rascunho — continua na próxima.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export const mediaAccountScope = {
  reset(): void {
    listeners.forEach((listener) => listener());
  },
  /** Devolve o cancelamento da assinatura. */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
