/** Máscara fixa: nenhum dígito da chave é guardado nem calculado para exibição. */
export const MASKED_API_KEY = '••••';

/** AAD da chave de um provedor da plataforma. */
export function platformProviderAad(id: string): string {
  return `platform:ai:${id}`;
}

/** AAD da chave própria do tenant. */
export function tenantCredentialAad(tenantId: string): string {
  return `${tenantId}:ai:apikey`;
}

/** Remove espaços; vazio = null (mantém a chave atual onde isso é permitido). */
export function normalizeApiKey(raw: string | undefined | null): string | null {
  const v = raw?.trim() ?? '';
  return v === '' ? null : v;
}
