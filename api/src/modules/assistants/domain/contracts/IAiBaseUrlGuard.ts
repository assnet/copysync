/** `blocked` = algum endereço resolvido é privado/reservado; `unresolvable` = DNS falhou. */
export type AiBaseUrlVerdict = 'ok' | 'blocked' | 'unresolvable';

/**
 * Proteção contra SSRF de endpoint próprio: resolve o host e recusa se qualquer endereço for
 * loopback, privado, link-local, CGNAT ou reservado. Roda ao salvar e antes de cada chamada
 * (DNS rebinding). Recebe uma URL já aprovada por `checkCustomBaseUrl`.
 */
export interface IAiBaseUrlGuard {
  check(baseUrl: string): Promise<AiBaseUrlVerdict>;
}
