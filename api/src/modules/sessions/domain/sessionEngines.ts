/**
 * Engines (canais) de sessão. O nome descreve a lib/canal, nunca a marca.
 * `baileys` = WhatsApp; `telegram` = conta de usuário Telegram (MTProto).
 */
export const SESSION_ENGINES = ['baileys', 'telegram'] as const;
export type SessionEngine = (typeof SESSION_ENGINES)[number];

export function isSessionEngine(value: unknown): value is SessionEngine {
  return typeof value === 'string' && (SESSION_ENGINES as readonly string[]).includes(value);
}
