import { internalEventBus } from '../../../../shared/events/InternalEventBus';
import type { InternalMessagingEvent } from '../../../../shared/events/InternalMessagingEvent';
import { logger } from '../../../../shared/logger/logger';
import { automationContainer } from '../automationContainer';

type MessageReceivedEvent = Extract<InternalMessagingEvent, { type: 'MESSAGE_RECEIVED' }>;

/**
 * Captura de ofertas: mensagem de grupo monitorado vira captura PENDING. Só evento interno
 * (nunca o payload cru da engine). Barato: sem link no texto, nem consulta o banco. Registrar
 * uma vez no boot, no processo que tem a engine. O processamento é do worker (flag).
 */
export function registerGroupMonitoringListener(): void {
  internalEventBus.on<MessageReceivedEvent>('MESSAGE_RECEIVED', async (e) => {
    if (!e.isGroup || e.fromMe) return;
    try {
      const result = await automationContainer.registerMessage().execute({
        tenantId: e.tenantId,
        sessionId: e.sessionId,
        isGroup: e.isGroup,
        fromMe: e.fromMe,
        groupJid: e.groupJid,
        externalMessageId: e.externalMessageId,
        body: e.body,
        msgType: e.msgType,
        mediaUrl: e.mediaUrl,
        mimeType: e.mimeType,
      });
      // Sem texto da mensagem: só o fato, para a operação saber que a flag está agindo
      if (result === 'outside_window') logger.info({ sessionId: e.sessionId, tenantId: e.tenantId, groupJid: e.groupJid }, 'group message outside operating window; not captured');
    } catch (err) {
      // Sem texto da mensagem no log
      logger.error({ err: (err as Error)?.name, sessionId: e.sessionId, tenantId: e.tenantId }, 'group monitoring capture failed');
    }
  });
}
