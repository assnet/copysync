/**
 * Diz se o tenant tem o produto Chat (entitlement `chat_enabled`). Desligado: a ingestão grava só
 * o contato e os listeners de estado do chat não gravam nem publicam. Ausente na composição = ligado.
 */
export interface IChatEntitlementGate {
  isChatEnabled(tenantId: string): Promise<boolean>;
}
