import { internalEventBus } from '../../../../shared/events/InternalEventBus';
import type { InternalMessagingEvent } from '../../../../shared/events/InternalMessagingEvent';
import type { ISessionAdoptionRepository } from '../../domain/contracts/ISessionAdoptionRepository';
import { logger } from '../../../../shared/logger/logger';

const log = logger.child({ module: 'SessionAdoptionResetListener' });

type SessionConnectedEvent = Extract<InternalMessagingEvent, { type: 'SESSION_CONNECTED' }>;

/**
 * ADOPT-04: conexão bem-sucedida zera contador e backoff de adoção. Best-effort: erro só loga.
 * Registrado apenas com a flag de adoção ligada (T14). Devolve a função que remove o listener.
 */
export function registerSessionAdoptionResetListener(
  adoptionRepo: Pick<ISessionAdoptionRepository, 'resetFailures'>,
): () => void {
  const handler = async (event: SessionConnectedEvent): Promise<void> => {
    try {
      await adoptionRepo.resetFailures(event.sessionId);
    } catch (err) {
      log.warn({ err, sessionId: event.sessionId, tenantId: event.tenantId }, 'Failed to reset adoption backoff');
    }
  };
  internalEventBus.on<SessionConnectedEvent>('SESSION_CONNECTED', handler);
  return () => {
    internalEventBus.off<SessionConnectedEvent>('SESSION_CONNECTED', handler);
  };
}
