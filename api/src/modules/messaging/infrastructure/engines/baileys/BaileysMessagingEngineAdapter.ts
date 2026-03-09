/**
 * Baileys messaging engine adapter — STUB.
 *
 * This is the ONLY file in the entire codebase allowed to import from Baileys.
 * All engine-specific types, events and errors must be translated here and
 * never leak into application or domain layers.
 *
 * Implementation will be completed in Phase 2 (Sessions).
 */

import type {
  IMessagingEngine,
  CreateSessionInput,
  ConnectSessionResult,
  SendTextMessageInput,
  SendMediaMessageInput,
  SendMessageResult,
} from '../../../domain/contracts/IMessagingEngine';
import type { SessionStatus } from '../../../../sessions/domain/enums/SessionStatus';
import { EngineNotReadyError } from '../../../../../shared/errors/internal/MessagingErrors';

export class BaileysMessagingEngineAdapter implements IMessagingEngine {
  async createSession(_input: CreateSessionInput): Promise<void> {
    throw new EngineNotReadyError();
  }

  async connectSession(_sessionId: string): Promise<ConnectSessionResult> {
    throw new EngineNotReadyError();
  }

  async disconnectSession(_sessionId: string): Promise<void> {
    throw new EngineNotReadyError();
  }

  async reconnectSession(_sessionId: string): Promise<void> {
    throw new EngineNotReadyError();
  }

  async logoutSession(_sessionId: string): Promise<void> {
    throw new EngineNotReadyError();
  }

  async getSessionStatus(_sessionId: string): Promise<SessionStatus> {
    throw new EngineNotReadyError();
  }

  async sendTextMessage(_input: SendTextMessageInput): Promise<SendMessageResult> {
    throw new EngineNotReadyError();
  }

  async sendMediaMessage(_input: SendMediaMessageInput): Promise<SendMessageResult> {
    throw new EngineNotReadyError();
  }
}
