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
