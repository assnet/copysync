import { buildApp } from './app';
import { env } from '../shared/config/env';
import { logger } from '../shared/logger/logger';
import { prisma } from '../shared/database/prisma.client';
import { PrismaSessionRepository } from '../modules/sessions/infrastructure/repositories/PrismaSessionRepository';
import { SessionBootstrapService } from '../modules/sessions/application/services/SessionBootstrapService';
import { getActiveEngine } from '../shared/engine/activeEngine';
import { SessionStatusReconciler } from '../modules/sessions/application/services/SessionStatusReconciler';
import { PrismaChatContactRepository } from '../modules/chat/infrastructure/repositories/PrismaChatContactRepository';
import { PrismaChatConversationRepository } from '../modules/chat/infrastructure/repositories/PrismaChatConversationRepository';
import { PrismaChatMessageRepository } from '../modules/chat/infrastructure/repositories/PrismaChatMessageRepository';
import { PrismaChatMessageReactionRepository } from '../modules/chat/infrastructure/repositories/PrismaChatMessageReactionRepository';
import { IngestIncomingMessageUseCase } from '../modules/chat/application/use-cases/IngestIncomingMessageUseCase';
import { IngestMessageReactionUseCase } from '../modules/chat/application/use-cases/IngestMessageReactionUseCase';
import { IngestHistorySyncUseCase } from '../modules/chat/application/use-cases/IngestHistorySyncUseCase';
import { FailOrphanPendingMediaUseCase } from '../modules/chat/application/use-cases/FailOrphanPendingMediaUseCase';
import { ReconcileInterruptedUploadsUseCase } from '../modules/chat/application/use-cases/ReconcileInterruptedUploadsUseCase';
import { chatMediaContainer } from '../modules/chat/infrastructure/chatMediaContainer';
import { registerChatIncomingMessageListener } from '../modules/chat/infrastructure/listeners/ChatIncomingMessageListener';
import { registerChatMessageStatusListener } from '../modules/chat/infrastructure/listeners/ChatMessageStatusListener';
import { registerChatMessageReactionListener } from '../modules/chat/infrastructure/listeners/ChatMessageReactionListener';
import { registerChatPresenceListener } from '../modules/chat/infrastructure/listeners/ChatPresenceListener';
import { registerChatContactAvatarListener } from '../modules/chat/infrastructure/listeners/ChatContactAvatarListener';
import { registerChatGroupAvatarListener } from '../modules/chat/infrastructure/listeners/ChatGroupAvatarListener';
import { registerChatConversationStateListener } from '../modules/chat/infrastructure/listeners/ChatConversationStateListener';
import { registerChatSessionStatusListener } from '../modules/chat/infrastructure/listeners/ChatSessionStatusListener';
import { UploadSessionSweeper } from '../modules/media/infrastructure/uploads/UploadSessionSweeper';
import { diskBudget } from '../modules/media/domain/services/diskBudget';
import { initMediaModule, mediaContainer } from '../modules/media/infrastructure/mediaContainer';
import { SecretCipherFactory } from '../shared/security/SecretCipherFactory';
import { flushAllAuthStates } from '../modules/messaging/infrastructure/engines/baileys/BaileysAuthStatePersistence';
import { registerTenantSuspendedSessionListener } from '../modules/sessions/infrastructure/listeners/TenantSuspendedSessionListener';
import { PrismaAuditLogRepository } from '../shared/audit/PrismaAuditLogRepository';
import { ReconcileSubscriptionsUseCase } from '../modules/integrations/billing/ReconcileSubscriptionsUseCase';
import { offersContainer } from '../modules/campaigns/infrastructure/offersContainer';
import { OfferDispatchWorker } from '../modules/campaigns/infrastructure/worker/OfferDispatchWorker';
import { createLinkRotationMemberSyncJob, type LinkRotationMemberSyncJob } from '../modules/link-rotation/infrastructure/jobs/LinkRotationMemberSyncJob';
import { automationContainer } from '../modules/automation/infrastructure/automationContainer';
import { registerGroupMonitoringListener } from '../modules/automation/infrastructure/listeners/GroupMonitoringMessageListener';
import { extensionContainer } from '../modules/extension/infrastructure/extensionContainer';
import { HubOutboxWorker } from '../modules/extension/infrastructure/hub/HubOutboxWorker';
import { ExtensionRetentionJob } from '../modules/extension/infrastructure/jobs/ExtensionRetentionJob';

/** Varredura de mídia `PENDING` que a fila não tem mais (design §8). */
const PENDING_MEDIA_SWEEP_INTERVAL_MS = 5 * 60_000;
/** Espera dos envios de mídia em andamento no shutdown: a Render dá 30 s entre SIGTERM e SIGKILL. */
const MEDIA_QUEUE_DRAIN_TIMEOUT_MS = 25_000;

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

  // ── Media module (ffmpeg + pasta de uploads) ───────────────────────────────
  // Antes do listen: a primeira requisição já vê as capacidades detectadas. Só loga.
  try {
    await initMediaModule();
  } catch (err) {
    logger.error({ err }, 'Media module initialization failed');
  }

  // ── Cifra de credenciais ───────────────────────────────────────────────────
  // Só avisa: sem chave válida as rotas que cifram respondem 503, o resto da API sobe.
  const cipherProblem = SecretCipherFactory.check();
  if (cipherProblem) {
    logger.error({ reason: cipherProblem }, 'CREDENTIALS_ENCRYPTION_KEY unavailable — affiliate credential writes will return 503');
  }

  // ── Chat repositories ──────────────────────────────────────────────────────
  const chatContactRepo      = new PrismaChatContactRepository(prisma);
  const chatConversationRepo = new PrismaChatConversationRepository(prisma);
  const chatMessageRepo      = new PrismaChatMessageRepository(prisma);
  const chatReactionRepo     = new PrismaChatMessageReactionRepository(prisma);

  // ── Mídia pendente órfã ────────────────────────────────────────────────────
  // Antes do listen: a fila é memória, então todo PENDING do banco ficou sem envio. Só com
  // MEDIA_PENDING_RECOVERY_ENABLED (Render) — `api/.env` aponta para produção e um `pnpm dev`
  // não pode falhar mídia que a produção ainda envia. A varredura periódica (`runPeriodic`)
  // é agendada junto com a fila. Nunca lança; o try/catch só guarda o boot.
  const failOrphanPendingMedia = new FailOrphanPendingMediaUseCase(chatMessageRepo, chatMediaContainer.statusPublisher, {
    enabled:      env.MEDIA_PENDING_RECOVERY_ENABLED,
    staleMinutes: env.MEDIA_PENDING_STALE_MINUTES,
  });
  try {
    await failOrphanPendingMedia.runBoot();
  } catch (err) {
    logger.error({ err }, 'Pending media recovery failed on startup');
  }

  // ── Uploads interrompidos no meio do consumo ───────────────────────────────
  // Antes da varredura de uploads (que apagaria um CONSUMING vencido sem olhar se virou
  // mensagem). No banco, só leitura — seguro sem flag.
  try {
    await new ReconcileInterruptedUploadsUseCase(mediaContainer.uploadStore, chatMessageRepo).execute();
  } catch (err) {
    logger.error({ err }, 'Interrupted upload reconciliation failed on startup');
  }

  // ── Start HTTP server ──────────────────────────────────────────────────────
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    logger.info({ port: env.PORT, host: env.HOST, env: env.NODE_ENV }, 'Server started');
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }

  // ── Limpeza de uploads em partes ───────────────────────────────────────────
  // Só disco, nenhum banco. Falha aqui só loga: a API sobe sem a varredura.
  // Mesmo store das rotas (pasta preparada no `initMediaModule`).
  let uploadSweeper: UploadSessionSweeper | null = null;
  try {
    uploadSweeper = new UploadSessionSweeper({
      store: mediaContainer.uploadStore,
      ttlMs: env.MEDIA_UPLOAD_TTL_MINUTES * 60_000,
      reserveFor: (totalBytes) =>
        diskBudget({ totalBytes, reserveBytes: env.MEDIA_DISK_RESERVE_BYTES }).reserveBytes,
    });
    uploadSweeper.start();
  } catch (err) {
    logger.error({ err }, 'Upload sweeper failed to start — expired uploads will not be removed');
  }

  // ── Varredura de mídia pendente ────────────────────────────────────────────
  // Só com MEDIA_PENDING_RECOVERY_ENABLED (mesmo motivo do boot). Poupa o que a fila ainda
  // tem; `runPeriodic` nunca lança. `unref`: o intervalo não segura o processo vivo.
  let pendingMediaSweep: NodeJS.Timeout | null = null;
  if (env.MEDIA_PENDING_RECOVERY_ENABLED) {
    pendingMediaSweep = setInterval(() => {
      // A consulta, não a foto: o repositório a chama entre a seleção e a escrita
      void failOrphanPendingMedia.runPeriodic(() => chatMediaContainer.queue.inFlightIds());
    }, PENDING_MEDIA_SWEEP_INTERVAL_MS);
    pendingMediaSweep.unref();
  }

  // ── Envios do gerador de ofertas ───────────────────────────────────────────
  // Só com OFFER_DISPATCH_WORKER_ENABLED: o worker escreve no banco e envia mensagens, e
  // `api/.env` aponta para produção (AGENTS §22).
  // Mesmo worker processa as capturas do monitoramento (GROUP_MONITORING_ENABLED): sem
  // setInterval novo. Cada parte isolada: erro numa não derruba a outra (docs/monitoramento-grupos.md).
  let offerDispatchWorker: OfferDispatchWorker | null = null;
  if (env.OFFER_DISPATCH_WORKER_ENABLED || env.GROUP_MONITORING_ENABLED) {
    const safe = async (name: string, run: () => Promise<{ processed: number }>) => {
      try {
        return (await run()).processed;
      } catch (err) {
        logger.error({ err: (err as Error)?.name, part: name }, 'worker tick part failed');
        return 0;
      }
    };
    offerDispatchWorker = new OfferDispatchWorker({
      tick: () => ({
        execute: async () => ({
          processed:
            (env.OFFER_DISPATCH_WORKER_ENABLED ? await safe('offer-dispatch', () => offersContainer.processDueDispatches().execute()) : 0)
            + (env.GROUP_MONITORING_ENABLED ? await safe('group-monitoring', () => automationContainer.processCaptured().execute()) : 0),
        }),
      }),
    });
    offerDispatchWorker.start();
    logger.info({ offerDispatch: env.OFFER_DISPATCH_WORKER_ENABLED, groupMonitoring: env.GROUP_MONITORING_ENABLED }, 'Offer dispatch worker started');
  } else {
    logger.info('Offer dispatch worker disabled (OFFER_DISPATCH_WORKER_ENABLED=false, GROUP_MONITORING_ENABLED=false)');
  }

  // ── Rodízio de links: membros dos grupos + retenção de cliques ─────────────
  // Só com LINK_ROTATION_MEMBER_SYNC_ENABLED (escreve no banco e chama o WhatsApp; AGENTS §22).
  // Lease `link-rotation-member-sync`: 1 processo por tick (.specs/features/link-rotation/design.md §4.5).
  let linkRotationMemberSyncJob: LinkRotationMemberSyncJob | null = null;
  if (env.LINK_ROTATION_MEMBER_SYNC_ENABLED) {
    linkRotationMemberSyncJob = createLinkRotationMemberSyncJob(prisma);
    linkRotationMemberSyncJob.start();
    logger.info('Link rotation member sync job started');
  }

  // ── Hub outbox worker + retention ─────────────────────────────────────────
  let hubOutboxWorker: HubOutboxWorker | null = null;
  let extensionRetentionJob: ExtensionRetentionJob | null = null;
  if (env.HUB_EVENTS_ENABLED && env.HUB_EVENTS_CONFIGURED) {
    hubOutboxWorker = new HubOutboxWorker({
      repository: extensionContainer.outboxRepository,
      hubUrl: env.HUB_EVENTS_URL!,
      applicationKey: env.HUB_EVENTS_APPLICATION_KEY!,
      secret: env.HUB_EVENTS_SECRET!,
    });
    hubOutboxWorker.start();
    logger.info('Hub outbox worker started');

    extensionRetentionJob = new ExtensionRetentionJob({
      prisma,
      outbox: extensionContainer.outboxRepository,
    });
    extensionRetentionJob.start();
    logger.info('Extension retention job started');
  } else {
    logger.info('Hub outbox worker disabled (HUB_EVENTS_ENABLED=false or not configured)');
  }

  // ── Billing warnings ───────────────────────────────────────────────────────
  if (env.BILLING_ENABLED && env.EMAIL_SENDER === 'noop') {
    logger.warn('Billing enabled but EMAIL_SENDER=noop — invite and provision emails will not be delivered');
  }

  // ── Billing reconciliation interval ───────────────────────────────────────
  let billingReconcileInterval: NodeJS.Timeout | null = null;
  if (env.BILLING_ENABLED && env.BILLING_RECONCILE_INTERVAL_MS > 0) {
    const reconcileUseCase = new ReconcileSubscriptionsUseCase();
    billingReconcileInterval = setInterval(() => {
      void reconcileUseCase.execute().catch((err) => {
        logger.error({ err }, 'Billing reconciliation failed');
      });
    }, env.BILLING_RECONCILE_INTERVAL_MS);
    billingReconcileInterval.unref();
    logger.info({ intervalMs: env.BILLING_RECONCILE_INTERVAL_MS }, 'Billing reconciliation scheduled');
  }

  // ── Register chat listeners ────────────────────────────────────────────────
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
  // Grava capturas no banco: só com a flag (api/.env local aponta para produção, AGENTS §22)
  if (env.GROUP_MONITORING_ENABLED) registerGroupMonitoringListener();
  registerChatMessageStatusListener(chatMessageRepo);
  registerChatMessageReactionListener(
    new IngestMessageReactionUseCase(chatMessageRepo, chatReactionRepo, chatContactRepo),
  );
  registerChatPresenceListener();
  registerChatContactAvatarListener(chatContactRepo);
  registerChatGroupAvatarListener(chatConversationRepo);
  registerChatSessionStatusListener();
  registerChatConversationStateListener(chatConversationRepo);

  // ── Session suspension listener ────────────────────────────────────────────
  {
    const activeEngine = getActiveEngine();
    if (activeEngine) {
      registerTenantSuspendedSessionListener(
        new PrismaSessionRepository(),
        activeEngine,
        new PrismaAuditLogRepository(),
      );
    }
  }

  // ── Bootstrap active sessions ──────────────────────────────────────────────
  // Disabled by default in production because reconnecting WhatsApp sessions on
  // every deploy can generate large Baileys auth-state writes and overload small
  // PostgreSQL instances. Sessions can still be connected manually via API/UI.
  if (env.SESSION_BOOTSTRAP_ON_STARTUP) {
    try {
      const engine = getActiveEngine();
      if (!engine) throw new Error('MessagingEngine not initialized — session routes must register before bootstrap');
      const bootstrapService = new SessionBootstrapService(new PrismaSessionRepository(), engine, {
        maxConcurrent: env.SESSION_BOOTSTRAP_MAX_CONCURRENT,
      });
      await bootstrapService.bootstrap();
    } catch (err) {
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
    uploadSweeper?.stop();
    if (pendingMediaSweep) clearInterval(pendingMediaSweep);
    if (billingReconcileInterval) clearInterval(billingReconcileInterval);
    // Antes do drain: o tick em curso termina de enfileirar; nada novo entra na fila depois.
    try {
      await offerDispatchWorker?.stop();
    } catch (err) {
      logger.error({ err }, 'Offer dispatch worker stop failed during shutdown');
    }
    try {
      await linkRotationMemberSyncJob?.stop();
    } catch (err) {
      logger.error({ err }, 'Link rotation member sync job stop failed during shutdown');
    }
    try {
      await hubOutboxWorker?.stop();
    } catch (err) {
      logger.error({ err }, 'Hub outbox worker stop failed during shutdown');
    }
    try {
      await extensionRetentionJob?.stop();
    } catch (err) {
      logger.error({ err }, 'Extension retention job stop failed during shutdown');
    }
    // Antes do `app.close()`: envios de mídia em andamento terminam; o que ficar PENDING a
    // recuperação do próximo boot resolve. Novos envios nesse intervalo são recusados (FAILED).
    try {
      await chatMediaContainer.queue.drain(MEDIA_QUEUE_DRAIN_TIMEOUT_MS);
    } catch (err) {
      logger.error({ err }, 'Media send queue drain failed during shutdown');
    }
    try {
      await flushAllAuthStates();
    } catch (err) {
      logger.error({ err }, 'Auth state flush failed during shutdown');
    }
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

// Rede de segurança do processo. Uma rejeição não tratada num caminho de requisição não
// pode derrubar todas as sessões de WhatsApp do servidor: fica logada com stack para
// correção (incidente 2026-10-27: ERR_HTTP_HEADERS_SENT em promise matava a API em loop).
// Exceção síncrona não tratada deixa estado desconhecido: loga com stack e encerra, para o
// Render reiniciar — antes só a primeira linha do erro chegava ao log.
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection (process kept alive)');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — exiting');
  process.exit(1);
});

start();
