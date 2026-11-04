import type { IMessagingEngine } from '../domain/contracts/IMessagingEngine';
import type { ISessionRepository } from '../../sessions/domain/contracts/ISessionRepository';
import type { ISessionAuthStateRepository } from '../../sessions/domain/contracts/ISessionAuthStateRepository';
import type { IChatContactRepository } from '../../chat/domain/contracts/IChatContactRepository';
import type { IChatConversationRepository } from '../../chat/domain/contracts/IChatConversationRepository';
import type { IngestHistorySyncUseCase } from '../../chat/application/use-cases/IngestHistorySyncUseCase';
import { BaileysMessagingEngineAdapter } from './engines/baileys/BaileysMessagingEngineAdapter';
import { TelegramMessagingEngineAdapter } from './engines/telegram/TelegramMessagingEngineAdapter';
import { TelegramAuthStatePersistence } from './engines/telegram/TelegramAuthStatePersistence';
import { MessagingEngineRouter } from './MessagingEngineRouter';
import { SecretCipherFactory } from '../../../shared/security/SecretCipherFactory';
import { env } from '../../../shared/config/env';
import { logger } from '../../../shared/logger/logger';

export type MessagingEngineName = 'baileys' | 'telegram';

export interface MessagingEngineDeps {
  sessionRepo: ISessionRepository;
  authStateRepo: ISessionAuthStateRepository;
  chatContactRepo: IChatContactRepository;
  chatConversationRepo: IChatConversationRepository;
  historySyncUseCase: IngestHistorySyncUseCase;
}

/**
 * Monta as engines ligadas e devolve uma única porta (`MessagingEngineRouter`) que despacha
 * pela engine da sessão. Baileys (WhatsApp) é sempre criada; Telegram só com
 * `TELEGRAM_ENGINE_ENABLED=true` e credenciais de app (`TELEGRAM_API_ID`/`TELEGRAM_API_HASH`).
 */
export class MessagingEngineFactory {
  static createOne(engine: MessagingEngineName, deps: MessagingEngineDeps): IMessagingEngine {
    switch (engine) {
      case 'baileys':
        return new BaileysMessagingEngineAdapter(
          deps.sessionRepo,
          deps.authStateRepo,
          deps.chatContactRepo,
          deps.chatConversationRepo,
          deps.historySyncUseCase,
        );
      case 'telegram': {
        if (!env.TELEGRAM_API_ID || !env.TELEGRAM_API_HASH) throw new Error('Telegram engine requires TELEGRAM_API_ID and TELEGRAM_API_HASH');
        return new TelegramMessagingEngineAdapter(
          { apiId: env.TELEGRAM_API_ID, apiHash: env.TELEGRAM_API_HASH },
          deps.sessionRepo,
          new TelegramAuthStatePersistence(deps.authStateRepo, () => SecretCipherFactory.get()),
        );
      }
      default:
        throw new Error(`Unknown messaging engine: ${String(engine)}`);
    }
  }

  static createRouter(deps: MessagingEngineDeps): MessagingEngineRouter {
    const engines = new Map<string, IMessagingEngine>();
    engines.set('baileys', MessagingEngineFactory.createOne('baileys', deps));
    if (env.TELEGRAM_ENGINE_ENABLED) {
      if (env.TELEGRAM_API_ID && env.TELEGRAM_API_HASH && !SecretCipherFactory.check()) {
        engines.set('telegram', MessagingEngineFactory.createOne('telegram', deps));
      } else {
        logger.warn('TELEGRAM_ENGINE_ENABLED=true but TELEGRAM_API_ID/TELEGRAM_API_HASH/CREDENTIALS_ENCRYPTION_KEY missing — Telegram engine disabled');
      }
    }
    return new MessagingEngineRouter(engines, deps.sessionRepo);
  }
}
