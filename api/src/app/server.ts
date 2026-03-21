import { buildApp } from './app';
import { env } from '../shared/config/env';
import { logger } from '../shared/logger/logger';
import { prisma } from '../shared/database/prisma.client';
import { PrismaSessionRepository } from '../modules/sessions/infrastructure/repositories/PrismaSessionRepository';
import { PrismaSessionAuthStateRepository } from '../modules/sessions/infrastructure/repositories/PrismaSessionAuthStateRepository';
import { MessagingEngineFactory } from '../modules/messaging/infrastructure/MessagingEngineFactory';
import { SessionBootstrapService } from '../modules/sessions/application/services/SessionBootstrapService';
import { PrismaChatContactRepository } from '../modules/chat/infrastructure/repositories/PrismaChatContactRepository';
import { PrismaChatConversationRepository } from '../modules/chat/infrastructure/repositories/PrismaChatConversationRepository';
import { PrismaChatMessageRepository } from '../modules/chat/infrastructure/repositories/PrismaChatMessageRepository';
import { IngestIncomingMessageUseCase } from '../modules/chat/application/use-cases/IngestIncomingMessageUseCase';
import { IngestHistorySyncUseCase } from '../modules/chat/application/use-cases/IngestHistorySyncUseCase';
import { registerChatIncomingMessageListener } from '../modules/chat/infrastructure/listeners/ChatIncomingMessageListener';
import { registerChatMessageStatusListener } from '../modules/chat/infrastructure/listeners/ChatMessageStatusListener';
import { registerChatPresenceListener } from '../modules/chat/infrastructure/listeners/ChatPresenceListener';
import { registerChatContactAvatarListener } from '../modules/chat/infrastructure/listeners/ChatContactAvatarListener';

async function start(): Promise<void> {
  const app = await buildApp();

  // ── Connect to database ────────────────────────────────────────────────────
  try {
    await prisma.$connect();
    logger.info('Database connected');
  } catch (err) {
    logger.fatal({ err }, 'Failed to connect to database');
    process.exit(1);
  }

  // ── Start HTTP server ──────────────────────────────────────────────────────
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    logger.info({ port: env.PORT, host: env.HOST, env: env.NODE_ENV }, 'Server started');
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }

  // ── Register chat listeners ────────────────────────────────────────────────
  const chatContactRepo      = new PrismaChatContactRepository(prisma);
  const chatConversationRepo = new PrismaChatConversationRepository(prisma);
  const chatMessageRepo      = new PrismaChatMessageRepository(prisma);
  const ingestUseCase = new IngestIncomingMessageUseCase(
    chatContactRepo,
    chatConversationRepo,
    chatMessageRepo,
  );
  const ingestHistorySyncUseCase = new IngestHistorySyncUseCase(
    chatContactRepo,
    chatConversationRepo,
    chatMessageRepo,
  );
  registerChatIncomingMessageListener(ingestUseCase);
  registerChatMessageStatusListener(chatMessageRepo);
  registerChatPresenceListener();
  registerChatContactAvatarListener(chatContactRepo);

  // ── Bootstrap active sessions ──────────────────────────────────────────────
  // Runs after the server is listening so QR events can be polled immediately.
  try {
    const sessionRepo = new PrismaSessionRepository();
    const authStateRepo = new PrismaSessionAuthStateRepository();
    const engine = MessagingEngineFactory.create(
      'baileys',
      sessionRepo,
      authStateRepo,
      chatContactRepo,
      ingestHistorySyncUseCase,
    );
    const bootstrapService = new SessionBootstrapService(sessionRepo, engine);
    await bootstrapService.bootstrap();
  } catch (err) {
    // Bootstrap failure must not crash the server
    logger.error({ err }, 'Session bootstrap failed — server continues without active sessions');
  }

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutdown signal received');
    try {
      await app.close();
      await prisma.$disconnect();
      logger.info('Server and database shut down cleanly');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start();
