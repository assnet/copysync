/** Leitura de limites do plano (entitlements sincronizados do hub). */
export interface IEntitlementReader {
  /** null se ausente, JSON null ou não numérico. Aceita número ou string numérica. */
  getNumber(tenantId: string, key: string): Promise<number | null>;
  /** null se ausente ou não booleano. Aceita `true`/`false` ou as strings equivalentes. */
  getBoolean(tenantId: string, key: string): Promise<boolean | null>;
}
