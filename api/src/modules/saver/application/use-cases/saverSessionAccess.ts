import type { ISaverSessionReader, SaverSessionRef } from '../../domain/contracts/ISaverSessionReader';
import { EngineOperationUnsupportedError } from '../../../../shared/errors/internal/MessagingErrors';
import { SessionNotConnectedError, SessionNotFoundError } from '../../../../shared/errors/internal/SessionErrors';

const TELEGRAM_ENGINE = 'telegram';
const CONNECTED = 'CONNECTED';

/**
 * Sessão usável pelo Saver: do tenant, WhatsApp e conectada (SAVER-06..08).
 * Outro tenant/excluída → `SESSION_NOT_FOUND`; Telegram → `ENGINE_OPERATION_UNSUPPORTED`; desconectada → `SESSION_NOT_CONNECTED`.
 */
export async function requireSaverSession(
  sessions: ISaverSessionReader,
  tenantId: string,
  sessionId: string,
): Promise<SaverSessionRef> {
  const session = await sessions.findById(tenantId, sessionId);
  if (!session) throw new SessionNotFoundError(sessionId);
  if (session.engine === TELEGRAM_ENGINE) throw new EngineOperationUnsupportedError(TELEGRAM_ENGINE, 'saver');
  if (session.status !== CONNECTED) throw new SessionNotConnectedError(sessionId);
  return session;
}

/** JID de grupo sem `@g.us` (formato de `listParticipatingGroups`). */
export const bareGroupJid = (jid: string): string => jid.trim().replace(/@g\.us$/i, '');
