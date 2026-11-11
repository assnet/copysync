import { buildApp } from './app';
import { env } from '../shared/config/env';
import { logger } from '../shared/logger/logger';
import { prisma } from '../shared/database/prisma.client';
import { PrismaSessionRepository } from '../modules/sessions/infrastructure/repositories/PrismaSessionRepository';
import { SessionBootstrapService } from '../modules/sessions/application/services/SessionBootstrapService';
import { getActiveEngine } from '../shared/engine/activeEngine';
import {
  SessionStatusReconciler,
  scheduleLeaseExpiryRecheck,
} from '../modules/sessions/application/services/SessionStatusReconciler';
import { PrismaChatContactRepository } from '../modules/chat/infrastructure/repositories/PrismaChatContactRepository';
import { PrismaChatConversationRepository } from '../modules/chat/infrastructure/repositories/PrismaChatConversationRepository';
import { PrismaChatMessageRepository } from '../modules/chat/infrastructure/repositories/PrismaChatMessageRepository';
import { PrismaChatMessageReactionRepository } from '../modules/chat/infrastructure/repositories/PrismaChatMessageReactionRepository';
import { IngestIncomingMessageUseCase } from '../modules/chat/application/use-cases/IngestIncomingMessageUseCase';
import { IngestMessageReactionUseCase } from '../modules/chat/application/use-cases/IngestMessageReactionUseCase';
import { chatIngestComposition } from '../modules/messaging/infrastructure/ingestGate/chatIngestComposition';
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
import { registerTenantSuspendedSessionListener } from '../modules/sessions/infrastructure/listeners/TenantSuspendedSessionListener';
import { PrismaAuditLogRepository } from '../shared/audit/PrismaAuditLogRepository';
import { createReconcileSubscriptionsUseCase } from '../modules/integrations/infrastructure/billing/createReconcileSubscriptionsUseCase';
import { billingWebhookBlockReason } from '../modules/integrations/billing/billingWebhookGuard';
import { offersContainer } from '../modules/campaigns/infrastructure/offersContainer';
import { OfferDispatchWorker } from '../modules/campaigns/infrastructure/worker/OfferDispatchWorker';
import { createLinkRotationMemberSyncJob, type LinkRotationMemberSyncJob } from '../modules/link-rotation/infrastructure/jobs/LinkRotationMemberSyncJob';
import { automationContainer } from '../modules/automation/infrastructure/automationContainer';
import { registerGroupMonitoringListener } from '../modules/automation/infrastructure/listeners/GroupMonitoringMessageListener';
import { extensionContainer } from '../modules/extension/infrastructure/extensionContainer';
import { HubOutboxWorker } from '../modules/extension/infrastructure/hub/HubOutboxWorker';
import { ExtensionRetentionJob } from '../modules/extension/infrastructure/jobs/ExtensionRetentionJob';
import {
  createWorkerAutoscalerJob,
  sessionLeaseContainer,
  workerScalingSettingsProvider,
} from '../modules/sessions/infrastructure/lease/sessionLeaseContainer';
import type { WorkerAutoscalerJob } from '../modules/sessions/infrastructure/jobs/WorkerAutoscalerJob';
import { sessionAdoptionContainer } from '../modules/sessions/infrastructure/lease/sessionAdoptionContainer';
import { createOpsMetricsSamplerJob } from '../modules/metrics/infrastructure/opsMetricsContainer';
import type { OpsMetricsSamplerJob } from '../modules/metrics/infrastructure/jobs/OpsMetricsSamplerJob';
import type { IMessagingEngine } from '../modules/messaging/domain/contracts/IMessagingEngine';
import type { ISessionSocketControl } from '../modules/messaging/domain/contracts/ISessionSocketControl';
import { currentRole, runsSessions, type ProcessRole } from '../shared/config/processRole';
import { jobsFor } from './processJobs';
import { mediaDrainBudgetMs } from './shutdownBudget';
import { buildOfferWorkerOptions, offerWorkerStopOptions } from './offerWorkerComposition';
import { composeForRole } from './roleComposition';
import { buildWorkerApp } from './workerApp';
import { workerScaler } from '../modules/sessions/infrastructure/scaler/workerScaler';

/** Varredura de mídia `PENDING` que a fila não tem mais (design §8). */
const PENDING_MEDIA_SWEEP_INTERVAL_MS = 5 * 60_000;
/** Varredura das chaves órfãs de `outbound-tmp/` (worker): boot + a cada 1 h. */
const OUTBOUND_TMP_SWEEP_INTERVAL_MS = 60 * 60_000;
/** Espera dos envios de mídia em andamento no shutdown: a Render dá 30 s entre SIGTERM e SIGKILL. */
const MEDIA_QUEUE_DRAIN_TIMEOUT_MS = 25_000;
/** Teto da 1ª leitura da configuração de escala no boot; estourou, segue com a env. */
const SCALING_SETTINGS_BOOT_TIMEOUT_MS = 5_000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasSocketControl(engine: IMessagingEngine | null): engine is IMessagingEngine & ISessionSocketControl {
  const e = engine as Partial<ISessionSocketControl> | null;
  return typeof e?.closeAllSockets === 'function' && typeof e.listLocalSessionIds === 'function';
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

/** `worker`: Fastify só com `/health` (WROLE-04). Redis por `import()`: `all`/`http` nunca carregam por aqui. */
function buildWorkerHealthApp(engine: IMessagingEngine, workerId: string) {
  return buildWorkerApp({
    workerId,
    localSessions: () => (hasSocketControl(engine) ? engine.listLocalSessionIds().length : 0),
    redis: async () => {
      const { redisCommand } = await import('../shared/redis/redisConnections');
      return (await redisCommand().ping()) === 'PONG';
    },
    database: async () => {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    },
  });
}

/** Fecha os clientes Redis do papel (WROLE-15). `all` não abre Redis (D1). */
async function closeRedis(role: ProcessRole): Promise<void> {
  if (role === 'all') return;
  try {
    const { closeAllRedis } = await import('../shared/redis/redisConnections');
    await closeAllRedis();
    logger.info('Redis connections closed');
  } catch (err) {
    logger.error({ err }, 'Closing Redis connections failed during shutdown');
  }
}

async function start(): Promise<void> {
  const role = currentRole();
  // Engine do papel ANTES de `buildApp`: as rotas leem `getActiveEngine()` no registro (WROLE-02/05).
  // `all` = engine local, igual ao import de `session.routes` de antes.
  const composition = await composeForRole(role);
  // Lease de sessão: mesmo singleton das engines (gate, socket control). `workerId` do processo.
  const lease = sessionLeaseContainer();
  const app = role === 'worker' ? buildWorkerHealthApp(composition.engine, lease.workerId) : await buildApp();
  // Jobs de boot deste papel (§3.3). `all` (default) = todos, na ordem de sempre.
  const jobs = jobsFor(role);
  // Adoção por capacidade (E4): `null` com WORKER_ADOPTION_ENABLED desligada → boot/shutdown da E3.
  // Só em `worker`/`all`: o `http` nunca monta repositório, listener nem timer da adoção.
  const adoption = jobs.has('sessionAdoption') ? sessionAdoptionContainer() : null;
  // Escalador (WSCALE-11): construir no boot só para o aviso de `WORKER_SCALER_SERVICE_ID` inválido
  // sair no log de boot, não no 1º uso. Só constrói (sem rede). Papéis com as rotas de escala
  // (`http`/`all`) ou com a subida automática (`worker`/`all`, WSCALE-15).
  if (env.WORKER_SCALER_ENABLED && (role !== 'worker' || jobs.has('workerAutoscaler'))) workerScaler();

  // ── Connect to database ────────────────────────────────────────────────────
  await connectDatabaseWithRetry();

  // ── Configuração de escala (WSCALE-03) ─────────────────────────────────────
  // Antes do boot das sessões e da adoção: gate, adoção e jobs já leem o valor do banco. Falha de
  // leitura não lança: segue com o teto da env e troca no próximo refresh (30 s, `unref`).
  // Teto de 5 s: banco lento não segura o boot; a leitura continua e aplica quando terminar.
  const scalingSettings = workerScalingSettingsProvider();
  let scalingTimer: NodeJS.Timeout | undefined;
  const scalingTimedOut = await Promise.race([
    scalingSettings.refresh().then(() => false),
    new Promise<boolean>((resolve) => {
      scalingTimer = setTimeout(() => resolve(true), SCALING_SETTINGS_BOOT_TIMEOUT_MS);
      scalingTimer.unref();
    }),
  ]);
  clearTimeout(scalingTimer);
  if (scalingTimedOut) {
    logger.warn({ timeoutMs: SCALING_SETTINGS_BOOT_TIMEOUT_MS }, 'worker scaling settings boot refresh timed out; using env defaults');
  }
  scalingSettings.start();

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
    // WROLE-14: o boot poupa PENDING de sessão com lease vivo de outro processo
    workerId:     lease.workerId,
  });
  if (jobs.has('pendingMediaBoot')) {
    try {
      await failOrphanPendingMedia.runBoot();
    } catch (err) {
      logger.error({ err }, 'Pending media recovery failed on startup');
    }
  }

  // ── Uploads interrompidos no meio do consumo ───────────────────────────────
  // Antes da varredura de uploads (que apagaria um CONSUMING vencido sem olhar se virou
  // mensagem). No banco, só leitura — seguro sem flag.
  if (jobs.has('interruptedUploads')) {
    try {
      await new ReconcileInterruptedUploadsUseCase(mediaContainer.uploadStore, chatMessageRepo).execute();
    } catch (err) {
      logger.error({ err }, 'Interrupted upload reconciliation failed on startup');
    }
  }

  // ── Start HTTP server ──────────────────────────────────────────────────────
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    logger.info({ port: env.PORT, host: env.HOST, env: env.NODE_ENV, ...(role !== 'all' && { role }) }, 'Server started');
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }

  // ── Limpeza de uploads em partes ───────────────────────────────────────────
  // Só disco, nenhum banco. Falha aqui só loga: a API sobe sem a varredura.
  // Mesmo store das rotas (pasta preparada no `initMediaModule`).
  let uploadSweeper: UploadSessionSweeper | null = null;
  if (jobs.has('uploadSweeper')) {
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
  }

  // ── Varredura de mídia pendente ────────────────────────────────────────────
  // Só com MEDIA_PENDING_RECOVERY_ENABLED (mesmo motivo do boot). Poupa o que a fila ainda
  // tem; `runPeriodic` nunca lança. `unref`: o intervalo não segura o processo vivo.
  let pendingMediaSweep: NodeJS.Timeout | null = null;
  if (jobs.has('pendingMediaSweep') && env.MEDIA_PENDING_RECOVERY_ENABLED) {
    pendingMediaSweep = setInterval(() => {
      // A consulta, não a foto: o repositório a chama entre a seleção e a escrita
      void failOrphanPendingMedia.runPeriodic(() => chatMediaContainer.queue.inFlightIds());
    }, PENDING_MEDIA_SWEEP_INTERVAL_MS);
    pendingMediaSweep.unref();
  }

  // ── Mídia temporária de envio (outbound-tmp/) ──────────────────────────────
  // Só no `worker` (`all` não sobe chave ao storage: composição sem `outboundMedia`). Apaga chaves com mais de
  // 1 h que o `finally` do envio não removeu (processo morto no meio). `sweepExpired` nunca lança. Alternativa:
  // regra de lifecycle do bucket (docs/arquitetura-escala.md §3.3).
  let outboundTmpSweep: NodeJS.Timeout | null = null;
  const outboundMedia = composition.outboundMedia;
  if (jobs.has('outboundTmpSweep') && outboundMedia) {
    void outboundMedia.sweepExpired();
    outboundTmpSweep = setInterval(() => void outboundMedia.sweepExpired(), OUTBOUND_TMP_SWEEP_INTERVAL_MS);
    outboundTmpSweep.unref();
  }

  // ── Envios do gerador de ofertas ───────────────────────────────────────────
  // Só com OFFER_DISPATCH_WORKER_ENABLED: o worker escreve no banco e envia mensagens, e
  // `api/.env` aponta para produção (AGENTS §22).
  // Mesmo worker processa as capturas do monitoramento (GROUP_MONITORING_ENABLED): sem
  // setInterval novo. Cada parte isolada: erro numa não derruba a outra (docs/monitoramento-grupos.md).
  let offerDispatchWorker: OfferDispatchWorker | null = null;
  // OFFER_WORKER_INDEPENDENT_STAGES_ENABLED (entrega A): true = envio e capturas em slots
  // independentes no mesmo timer; false = tick sequencial de hoje (`offerWorkerComposition`).
  const offerWorkerFlags = {
    offerDispatch: env.OFFER_DISPATCH_WORKER_ENABLED,
    groupMonitoring: env.GROUP_MONITORING_ENABLED,
    independentStages: env.OFFER_WORKER_INDEPENDENT_STAGES_ENABLED,
    dispatchConcurrency: env.OFFER_DISPATCH_CONCURRENCY,
  };
  if (jobs.has('offerDispatch')) {
    const offerWorkerOptions = buildOfferWorkerOptions({
      jobs,
      flags: offerWorkerFlags,
      runners: {
        offerDispatch: () => offersContainer.processDueDispatches(),
        groupMonitoring: () => automationContainer.processCaptured(),
      },
      onLegacyPartError: (part, err) => logger.error({ err: (err as Error)?.name, part }, 'worker tick part failed'),
    });
    if (offerWorkerOptions) {
      offerDispatchWorker = new OfferDispatchWorker(offerWorkerOptions);
      offerDispatchWorker.start();
      logger.info({ ...offerWorkerFlags }, 'Offer dispatch worker started');
    } else {
      logger.info('Offer dispatch worker disabled (OFFER_DISPATCH_WORKER_ENABLED=false, GROUP_MONITORING_ENABLED=false)');
    }
  }

  // ── Rodízio de links: membros dos grupos + retenção de cliques ─────────────
  // Só com LINK_ROTATION_MEMBER_SYNC_ENABLED (escreve no banco e chama o WhatsApp; AGENTS §22).
  // Lease `link-rotation-member-sync`: 1 processo por tick (.specs/features/link-rotation/design.md §4.5).
  let linkRotationMemberSyncJob: LinkRotationMemberSyncJob | null = null;
  if (jobs.has('linkRotationSync') && env.LINK_ROTATION_MEMBER_SYNC_ENABLED) {
    linkRotationMemberSyncJob = createLinkRotationMemberSyncJob(prisma);
    linkRotationMemberSyncJob.start();
    logger.info('Link rotation member sync job started');
  }

  // ── Hub outbox worker + retention ─────────────────────────────────────────
  let hubOutboxWorker: HubOutboxWorker | null = null;
  let extensionRetentionJob: ExtensionRetentionJob | null = null;
  if (env.HUB_EVENTS_ENABLED && env.HUB_EVENTS_CONFIGURED) {
    if (jobs.has('hubOutbox')) {
      hubOutboxWorker = new HubOutboxWorker({
        repository: extensionContainer.outboxRepository,
        hubUrl: env.HUB_EVENTS_URL!,
        applicationKey: env.HUB_EVENTS_APPLICATION_KEY!,
        secret: env.HUB_EVENTS_SECRET!,
      });
      hubOutboxWorker.start();
      logger.info('Hub outbox worker started');
    }

    if (jobs.has('extensionRetention')) {
      extensionRetentionJob = new ExtensionRetentionJob({
        prisma,
        outbox: extensionContainer.outboxRepository,
      });
      extensionRetentionJob.start();
      logger.info('Extension retention job started');
    }
  } else {
    logger.info('Hub outbox worker disabled (HUB_EVENTS_ENABLED=false or not configured)');
  }

  // ── Billing warnings ───────────────────────────────────────────────────────
  // Produção com noop/hub: a rota do webhook nem sobe (routes.ts loga o erro)
  if (env.BILLING_ENABLED && env.NODE_ENV !== 'production' && env.EMAIL_SENDER === 'noop') {
    logger.warn('Billing enabled but EMAIL_SENDER=noop — invite and provision emails will not be delivered');
  }

  // ── Billing reconciliation interval ───────────────────────────────────────
  let billingReconcileInterval: NodeJS.Timeout | null = null;
  // Webhook bloqueado (produção sem e-mail real) → reconciliação também fica parada
  if (jobs.has('billingReconcile') && env.BILLING_ENABLED && env.BILLING_RECONCILE_INTERVAL_MS > 0 && billingWebhookBlockReason(env) === null) {
    const reconcileUseCase = createReconcileSubscriptionsUseCase();
    billingReconcileInterval = setInterval(() => {
      void reconcileUseCase.execute().catch((err) => {
        logger.error({ err }, 'Billing reconciliation failed');
      });
    }, env.BILLING_RECONCILE_INTERVAL_MS);
    billingReconcileInterval.unref();
    logger.info({ intervalMs: env.BILLING_RECONCILE_INTERVAL_MS }, 'Billing reconciliation scheduled');
  }

  // ── Register chat listeners ────────────────────────────────────────────────
  // Gate do chat por entitlement (entrega D): mesma composição do `localEngineContainer`.
  const chatGate = chatIngestComposition().gate;
  const ingestUseCase = new IngestIncomingMessageUseCase(
    chatContactRepo,
    chatConversationRepo,
    chatMessageRepo,
    new PrismaSessionRepository(),
    chatGate,
  );
  registerChatIncomingMessageListener(ingestUseCase);
  // Grava capturas no banco: só com a flag (api/.env local aponta para produção, AGENTS §22).
  // Só onde há sessões: as mensagens de grupo nascem no processo dono do socket.
  if (runsSessions(role) && env.GROUP_MONITORING_ENABLED) registerGroupMonitoringListener();
  registerChatMessageStatusListener(chatMessageRepo, chatGate);
  registerChatMessageReactionListener(
    new IngestMessageReactionUseCase(chatMessageRepo, chatReactionRepo, chatContactRepo),
    chatGate,
  );
  registerChatPresenceListener(chatGate);
  registerChatContactAvatarListener(chatContactRepo, chatGate);
  registerChatGroupAvatarListener(chatConversationRepo, chatGate);
  registerChatSessionStatusListener();
  registerChatConversationStateListener(chatConversationRepo, chatGate);

  // ── Session suspension listener ────────────────────────────────────────────
  // Todo papel (WROLE-13): no `http` a engine remota leva o `disconnect` ao dono por BullMQ.
  registerTenantSuspendedSessionListener(
    new PrismaSessionRepository(),
    composition.engine,
    new PrismaAuditLogRepository(),
    lease.release,
  );

  // ── Bootstrap active sessions ──────────────────────────────────────────────
  // Disabled by default in production because reconnecting WhatsApp sessions on
  // every deploy can generate large Baileys auth-state writes and overload small
  // PostgreSQL instances. Sessions can still be connected manually via API/UI.
  // F1: crash/SIGKILL não solta o lease; a 2ª passada (após o TTL) trata as sessões puladas.
  let cancelBootRecheck: (() => Promise<void>) | null = null;
  if (env.SESSION_BOOTSTRAP_ON_STARTUP) {
    if (adoption) {
      // ADOPT-08/D8: com a adoção o ticker reconecta (com teto), inclusive as sessões puladas por
      // lease de outro processo; sem `SessionBootstrapService` nem 2ª passada (F1).
      logger.info('Session bootstrap delegated to adoption ticker');
    } else if (jobs.has('sessionBootstrap')) {
      try {
        const engine = getActiveEngine();
        if (!engine) throw new Error('MessagingEngine not initialized — session routes must register before bootstrap');
        const bootstrapService = new SessionBootstrapService(new PrismaSessionRepository(), engine, {
          maxConcurrent: env.SESSION_BOOTSTRAP_MAX_CONCURRENT,
        });
        await bootstrapService.bootstrap();
        cancelBootRecheck = scheduleLeaseExpiryRecheck(() =>
          bootstrapService.bootstrap({ onlyWithoutLiveLease: true }),
        );
      } catch (err) {
        logger.error({ err }, 'Session bootstrap failed — server continues without active sessions');
      }
    }
  } else if (jobs.has('sessionReconciler')) {
    logger.warn(
      'Session bootstrap disabled; WhatsApp sessions will remain disconnected until manually connected',
    );
    // Nenhum socket sobrevive ao restart, mas o status gravado antes do shutdown sim.
    // Sem reconciliar, a sessão aparece CONNECTED no painel enquanto nada chega.
    try {
      const reconciler = new SessionStatusReconciler(new PrismaSessionRepository());
      await reconciler.markActiveSessionsAsDisconnected();
      cancelBootRecheck = scheduleLeaseExpiryRecheck(() => reconciler.markActiveSessionsAsDisconnected());
    } catch (err) {
      logger.error({ err }, 'Failed to reconcile session statuses on startup');
    }
  }

  // ── Renovação do lease (LEASE-04) ──────────────────────────────────────────
  // Depois do boot das sessões: renova a cada 20 s só as sessões com socket local.
  if (jobs.has('leaseKeeper')) {
    lease.keeper.start();
    logger.info({ workerId: lease.workerId }, 'Session lease keeper started');
  }

  // ── Adoção por capacidade (ADOPT-07/10/11) ─────────────────────────────────
  // Depois do keeper: sessão adotada já tem quem renove o lease. Timers `unref`, nascem parados.
  if (adoption) {
    if (jobs.has('sessionAdoption')) adoption.ticker.start();
    if (jobs.has('workerHeartbeat')) adoption.heartbeat.start();
    if (jobs.has('capacityAlert')) adoption.capacityAlert.start();
    logger.info(
      {
        workerId: lease.workerId,
        maxSessions: scalingSettings.current().value.maxSessionsPerWorker,
        maxPendingLogins: scalingSettings.current().value.maxPendingLoginsPerWorker,
        shard: adoption.config.shard,
      },
      'Session adoption started',
    );
  }

  // ── Métricas de recursos (MQ-22) ───────────────────────────────────────────
  // Só worker/all e com a flag; 1 dono por vez via lease. Timer `unref`, nunca em requisição.
  let opsMetricsSampler: OpsMetricsSamplerJob | null = null;
  if (jobs.has('opsMetricsSampler') && env.OPS_METRICS_SAMPLER_ENABLED) {
    const sampler = createOpsMetricsSamplerJob();
    opsMetricsSampler = sampler.job;
    opsMetricsSampler.start();
    logger.info({ platform: sampler.platformEnabled }, 'Ops metrics sampler started');
  }

  // ── Subida automática de workers (WSCALE-15) ───────────────────────────────
  // Só worker/all; 1 dono por vez via lease. Age só com `scalerMode = auto` (lido a cada tick).
  let workerAutoscaler: WorkerAutoscalerJob | null = null;
  if (jobs.has('workerAutoscaler')) {
    workerAutoscaler = createWorkerAutoscalerJob();
    workerAutoscaler.start();
    logger.info('Worker autoscaler started');
  }

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  // WROLE-15. `all`: ordem de hoje. `http`: jobs → composição → mídia → Redis → app.
  // `worker`: keeper → jobs → consumidores BullMQ/RPC → mídia (ofertas, D8) → sockets → flush →
  // leases → Redis → app. `stop()` da composição: no-op em `all`. Adoção ligada (ADOPT-14): ticker e
  // alerta param com o keeper, drain com teto (`shutdownBudget`), heartbeat apagado após os leases.
  const sessions = runsSessions(role);
  const shutdown = async (signal: string): Promise<void> => {
    const shutdownStartedAt = Date.now();
    logger.info({ signal }, 'Shutdown signal received');
    // Cancela o timer já; a passada em curso é aguardada antes de fechar os sockets (F8).
    const bootRecheckSettled = cancelBootRecheck?.() ?? Promise.resolve();
    scalingSettings.stop();
    // LEASE-09: primeiro o keeper — nenhuma renovação concorre com o fechamento dos sockets.
    if (sessions) {
      try {
        await lease.keeper.stop();
        logger.info('Session lease keeper stopped');
      } catch (err) {
        logger.error({ err }, 'Session lease keeper stop failed during shutdown');
      }
    }
    // ADOPT-14/D4: junto com o keeper param ticker (espera o tick em curso) e alerta. O heartbeat
    // segue batendo até soltar os leases; `heartbeat.stop()` apaga a linha no fim.
    // MQ-22: o sampler para junto (cancela a Render em voo, solta o lease), aguardado em paralelo.
    // WSCALE-15: a subida automática também (espera o tick em curso).
    if (adoption || opsMetricsSampler || workerAutoscaler) {
      try {
        await Promise.all([
          adoption?.ticker.stop(),
          adoption?.capacityAlert.stop(),
          opsMetricsSampler?.stop(),
          workerAutoscaler?.stop(),
        ]);
        if (adoption) logger.info('Session adoption stopped');
      } catch (err) {
        logger.error({ err }, 'Session adoption stop failed during shutdown');
      }
    }
    uploadSweeper?.stop();
    if (pendingMediaSweep) clearInterval(pendingMediaSweep);
    if (outboundTmpSweep) clearInterval(outboundTmpSweep);
    if (billingReconcileInterval) clearInterval(billingReconcileInterval);
    // Antes do drain: o tick em curso termina de enfileirar; nada novo entra na fila depois.
    try {
      await offerDispatchWorker?.stop(offerWorkerStopOptions(offerWorkerFlags.independentStages, Date.now() - shutdownStartedAt));
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
    // Consumidores BullMQ/RPC (worker) e cliente RPC/relay (http): nada novo chega à engine.
    if (role !== 'all') {
      await composition.stop();
      logger.info({ role }, 'Role composition stopped');
    }
    // Antes do `app.close()`: envios de mídia em andamento terminam; o que ficar PENDING a
    // recuperação do próximo boot resolve. Novos envios nesse intervalo são recusados (FAILED).
    // D4: com a adoção o drain tem teto que reserva o fim (close + flush + release) dentro de 27 s.
    try {
      const count = chatMediaContainer.queue.inFlightIds().length;
      const drainMs = adoption ? mediaDrainBudgetMs(Date.now() - shutdownStartedAt) : MEDIA_QUEUE_DRAIN_TIMEOUT_MS;
      await chatMediaContainer.queue.drain(drainMs);
      logger.info({ count, ...(adoption && { drainMs }) }, 'Media send queue drained');
    } catch (err) {
      logger.error({ err }, 'Media send queue drain failed during shutdown');
    }
    // F8: a 2ª passada do boot em curso pode abrir socket; termina antes de fechá-los.
    await bootRecheckSettled;
    if (sessions) {
      // LEASE-09: sockets fechados antes do flush (nenhuma chave nova chega depois dele).
      // Mídia × flush (D4 da E4): o drain vem antes, com teto quando a adoção está ligada.
      try {
        const engine = getActiveEngine();
        if (hasSocketControl(engine)) {
          const count = engine.listLocalSessionIds().length;
          await engine.closeAllSockets();
          logger.info({ count }, 'Session sockets closed');
        }
      } catch (err) {
        logger.error({ err }, 'Closing session sockets failed during shutdown');
      }
      // `import()`: o `http` nunca carrega o Baileys (WROLE-05); nos papéis com sessão já está em cache.
      try {
        const { flushAllAuthStates } = await import('../modules/messaging/infrastructure/engines/baileys/BaileysAuthStatePersistence');
        await flushAllAuthStates();
        logger.info('Auth states flushed');
      } catch (err) {
        logger.error({ err }, 'Auth state flush failed during shutdown');
      }
      // D1: solta os leases deste worker e marca DISCONNECTED as ativas (mantém o pedido de conexão).
      try {
        const count = await lease.repo.releaseAllOwned(lease.workerId);
        logger.info({ count, workerId: lease.workerId }, 'Session leases released');
      } catch (err) {
        logger.error({ err }, 'Session lease release failed during shutdown');
      }
      // ADOPT-10: só depois de soltar os leases a linha some de `worker_heartbeats`. Nunca lança.
      if (adoption) {
        await adoption.heartbeat.stop();
        logger.info({ workerId: lease.workerId }, 'Worker heartbeat removed');
      }
    }
    await closeRedis(role);
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

// Boot que lança (composição por papel, Redis, S3…) encerra com código 1: nada de processo
// meio vivo sem porta nem consumidores. O Render reinicia.
start().catch((err: unknown) => {
  logger.fatal({ err }, 'Boot failed — exiting');
  process.exit(1);
});
