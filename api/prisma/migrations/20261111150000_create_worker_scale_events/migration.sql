-- WSCALE-13: pedidos de escala dos workers (manual e automático). Sem tenant (infraestrutura).
-- Retenção de 180 dias apagada em lotes pelo WorkerAutoscalerJob (P4).
CREATE TABLE "worker_scale_events" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trigger" TEXT NOT NULL,
    "actorUserId" TEXT,
    "fromReplicas" INTEGER NOT NULL,
    "toReplicas" INTEGER NOT NULL,
    "reason" VARCHAR(200) NOT NULL,
    "outcome" TEXT NOT NULL,
    "error" VARCHAR(200),
    "requestId" TEXT,

    CONSTRAINT "worker_scale_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "worker_scale_events_trigger_check" CHECK ("trigger" IN ('manual', 'auto')),
    CONSTRAINT "worker_scale_events_outcome_check" CHECK ("outcome" IN ('requested', 'succeeded', 'failed', 'rejected'))
);

CREATE UNIQUE INDEX "worker_scale_events_requestId_key" ON "worker_scale_events"("requestId");
CREATE INDEX "worker_scale_events_at_idx" ON "worker_scale_events"("at" DESC);
