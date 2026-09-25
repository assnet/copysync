/**
 * Diz se a mensagem é o eco de um envio nosso registrado. Só consulta (e retira) o id
 * quando é `fromMe` com id: mensagem recebida nunca gasta a marca de um eco legítimo.
 */
export function isOwnOutboundEcho(
  key: { fromMe?: boolean | null; id?: string | null } | null | undefined,
  consume: (id: string) => boolean,
): boolean {
  if (!key?.fromMe || !key.id) return false;
  return consume(key.id);
}
