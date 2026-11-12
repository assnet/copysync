/** O tenant tem IA de texto utilizável (plataforma ou chave própria). Só leitura, não chama provedor. */
export interface IHuntAiAvailability {
  isAvailable(tenantId: string): Promise<boolean>;
}
