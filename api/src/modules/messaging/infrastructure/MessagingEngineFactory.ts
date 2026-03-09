import type { IMessagingEngine } from '../domain/contracts/IMessagingEngine';
import { BaileysMessagingEngineAdapter } from '../infrastructure/engines/baileys/BaileysMessagingEngineAdapter';

export type MessagingEngineName = 'baileys';

/**
 * Factory that resolves the active engine implementation from config.
 * Swap the engine here without touching anything else in the system.
 */
export class MessagingEngineFactory {
  static create(engine: MessagingEngineName = 'baileys'): IMessagingEngine {
    switch (engine) {
      case 'baileys':
        return new BaileysMessagingEngineAdapter();
      default:
        throw new Error(`Unknown messaging engine: ${engine}`);
    }
  }
}
