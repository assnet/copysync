import { buildApp } from './app';
import { env } from '../shared/config/env';
import { logger } from '../shared/logger/logger';
import { prisma } from '../shared/database/prisma.client';
import { PrismaSessionRepository } from '../modules/sessions/infrastructure/repositories/PrismaSessionRepository';
import { PrismaSessionAuthStateRepository } from '../modules/sessions/infrastructure/repositories/PrismaSessionAuthStateRepository';
import { MessagingEngineFactory } from '../modules/messaging/infrastructure/MessagingEngineFactory';
import { SessionBootstrapService } from '../modules/sessions/application/services/SessionBootstrapService';
import { SessionStatusReconciler } from '../modules/sessions/application/services/SessionStatusReconciler';
import { PrismaChatContactRepository } from '../modules/chat/infrastructure/repositories/PrismaChatContactRepository';
import { PrismaChatConversationRepository } from '../modules/chat/infrastructure/repositories/PrismaChatConversationRepository';
import { PrismaChatMessageRepository } from '../modules/chat/infrastructure/repositories/PrismaChatMessageRepository';
import { IngestIncomingMessageUseCase } from '../modules/chat/application/use-cases/IngestIncomingMessageUseCase';
import { IngestHistorySyncUseCase } from '../modules/chat/application/use-cases/IngestHistorySyncUseCase';
import { registerChatIncomingMessageListener } from '../modules/chat/infrastructure/listeners/ChatIncomingMessageListener';
import { registerChatMessageStatusListener } from '../modules/chat/infrastructure/listeners/ChatMessageStatusListener';
import { registerChatPresenceListener } from '../modules/chat/infrastructure/listeners/ChatPresenceListener';
import { registerChatContactAvatarListener } from '../modules/chat/infrastructure/listeners/ChatContactAvatarListener';
import { registerChatGroupAvatarListener } from '../modules/chat/infrastructure/listeners/ChatGroupAvatarListener';
import { registerChatConversationStateListener } from '../modules/chat/infrastructure/listeners/ChatConversationStateListener';
import { registerChatSessionStatusListener } from '../modules/chat/infrastructure/listeners/ChatSessionStatusListener';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectDatabaseWithRetry(): Promise<void> {
  for (let attempt = 1; attempt <= env.DATABASE_CONNECT_MAX_ATTEMPTS; attempt++) {
    try {
      await prisma.$connect();
      logger.info('Database connected');
      return;
    } catch (err) {
      if (attempt >= env.DATABASE_CONNECT_MAX_ATTEMPTS) {
        logger.fatal({ err, attempt }, 'Failed to connect to database');
        process.exit(1);
      }

      logger.warn(
        { err, attempt, nextAttemptInMs: env.DATABASE_CONNECT_RETRY_DELAY_MS },
        'Database connection failed; retrying',
      );
      await wait(env.DATABASE_CONNECT_RETRY_DELAY_MS);
    }
  }
}

async function start(): Promise<void> {
  const app = await buildApp();

  // ── Connect to database ────────────────────────────────────────────────────
  await connectDatabaseWithRetry();

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
  registerChatGroupAvatarListener(chatConversationRepo);
  registerChatSessionStatusListener();
  registerChatConversationStateListener(chatConversationRepo);

  // ── Bootstrap active sessions ──────────────────────────────────────────────
  // Disabled by default in production because reconnecting WhatsApp sessions on
  // every deploy can generate large Baileys auth-state writes and overload small
  // PostgreSQL instances. Sessions can still be connected manually via API/UI.
  if (env.SESSION_BOOTSTRAP_ON_STARTUP) {
    try {
      const sessionRepo = new PrismaSessionRepository();
      const authStateRepo = new PrismaSessionAuthStateRepository();
      const engine = MessagingEngineFactory.create(
        'baileys',
        sessionRepo,
        authStateRepo,
        chatContactRepo,
        chatConversationRepo,
        ingestHistorySyncUseCase,
      );
      const bootstrapService = new SessionBootstrapService(sessionRepo, engine, {
        maxConcurrent: env.SESSION_BOOTSTRAP_MAX_CONCURRENT,
      });
      await bootstrapService.bootstrap();
    } catch (err) {
      // Bootstrap failure must not crash the server
      logger.error({ err }, 'Session bootstrap failed — server continues without active sessions');
    }
  } else {
    logger.warn(
      'Session bootstrap disabled; WhatsApp sessions will remain disconnected until manually connected',
    );
    // Nenhum socket sobrevive ao restart, mas o status gravado antes do shutdown sim.
    // Sem reconciliar, a sessão aparece CONNECTED no painel enquanto nada chega.
    try {
      const reconciler = new SessionStatusReconciler(new PrismaSessionRepository());
      await reconciler.markActiveSessionsAsDisconnected();
    } catch (err) {
      logger.error({ err }, 'Failed to reconcile session statuses on startup');
    }
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
