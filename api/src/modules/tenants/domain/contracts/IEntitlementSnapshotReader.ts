/**
 * Leitura em lote dos entitlements do tenant (1 consulta). Separada de `IEntitlementReader`
 * para não quebrar os fakes existentes. Valores crus (JSON): quem consome interpreta.
 */
export interface IEntitlementSnapshotReader {
  /** Mapa chave → valor. Chave ausente = entitlement não sincronizado. */
  readAll(tenantId: string): Promise<Record<string, unknown>>;
}
