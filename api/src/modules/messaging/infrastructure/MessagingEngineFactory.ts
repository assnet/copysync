import type { IMessagingEngine } from '../domain/contracts/IMessagingEngine';
import type { ISessionRepository } from '../../sessions/domain/contracts/ISessionRepository';
import type { ISessionAuthStateRepository } from '../../sessions/domain/contracts/ISessionAuthStateRepository';
import type { IChatContactRepository } from '../../chat/domain/contracts/IChatContactRepository';
import type { IChatConversationRepository } from '../../chat/domain/contracts/IChatConversationRepository';
import type { IngestHistorySyncUseCase } from '../../chat/application/use-cases/IngestHistorySyncUseCase';
import { BaileysMessagingEngineAdapter } from './engines/baileys/BaileysMessagingEngineAdapter';

export type MessagingEngineName = 'baileys';

/**
 * Factory that resolves the active engine implementation from config.
 * Swap the engine here without touching anything else in the system.
 */
export class MessagingEngineFactory {
  static create(
    engine: MessagingEngineName = 'baileys',
    sessionRepo: ISessionRepository,
    authStateRepo: ISessionAuthStateRepository,
    chatContactRepo: IChatContactRepository,
    chatConversationRepo: IChatConversationRepository,
    historySyncUseCase: IngestHistorySyncUseCase,
  ): IMessagingEngine {
    switch (engine) {
      case 'baileys':
        return new BaileysMessagingEngineAdapter(
          sessionRepo,
          authStateRepo,
          chatContactRepo,
          chatConversationRepo,
          historySyncUseCase,
        );
      default:
        throw new Error(`Unknown messaging engine: ${engine}`);
    }
  }
}
