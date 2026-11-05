/**
 * Política do lease de sessão (dono único do socket). Constantes fixas, sem env
 * (LEASE-11). Ver `.specs/features/session-lease/spec.md` e `docs/arquitetura-escala.md` §3.1.
 */

/** Validade do lease gravada no banco a cada aquisição/renovação. */
export const LEASE_TTL_MS = 60_000;

/** Intervalo do keeper que renova os leases das sessões com socket local. */
export const LEASE_RENEW_INTERVAL_MS = 20_000;

/** Folga antes do TTL: sem renovar com sucesso, o socket cai em TTL − margem (55 s). */
export const LEASE_FENCE_MARGIN_MS = 5_000;

/** Tempo máximo de uma rodada de renovação; estourou = falha (vale o fence). */
export const LEASE_RENEW_TIMEOUT_MS = 5_000;

/**
 * Fence: true quando a última renovação bem-sucedida ficou para trás do limite
 * seguro (`now > lastRenewOkAt + TTL − margem`), e o socket deve ser derrubado.
 */
export function isLeaseFenceExpired(lastRenewOkAt: Date, now: Date): boolean {
  return now.getTime() > lastRenewOkAt.getTime() + LEASE_TTL_MS - LEASE_FENCE_MARGIN_MS;
}

/**
 * Prazo da carga do auth state ao abrir pela origem automática (retomada/adoção), igual nas
 * engines (F12/F13). Estourou = erro transitório.
 */
export const OPEN_AUTH_STATE_TIMEOUT_MS = 15_000;

/**
 * Prazo da mesma carga no connect/pareamento do usuário (F14): mais folgado que o automático
 * (banco lento não vira 503 cedo), mas finito (banco mudo não prende a requisição). Estourou = 503.
 */
export const USER_OPEN_AUTH_STATE_TIMEOUT_MS = 60_000;

/** Prazo da carga do auth state na abertura conforme a origem. */
export function openAuthStateTimeoutMs(origin: 'user' | 'auto'): number {
  return origin === 'user' ? USER_OPEN_AUTH_STATE_TIMEOUT_MS : OPEN_AUTH_STATE_TIMEOUT_MS;
}
