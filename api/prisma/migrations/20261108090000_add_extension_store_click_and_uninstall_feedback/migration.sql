-- Clique na Chrome Web Store como evento do ciclo de vida (sem instalação até a atribuição)
ALTER TABLE "extension_lifecycle_events" ALTER COLUMN "installationId" DROP NOT NULL;
ALTER TABLE "extension_lifecycle_events" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "extension_lifecycle_events" ADD COLUMN "source" TEXT;
CREATE INDEX "extension_lifecycle_events_userId_type_occurredAt_idx" ON "extension_lifecycle_events"("userId", "type", "occurredAt");

-- Outbox: STORE_CLICK vai à central sem installationId
ALTER TABLE "hub_outbox_events" ALTER COLUMN "installationId" DROP NOT NULL;

-- Pesquisa de desinstalação
CREATE TABLE "extension_uninstall_feedbacks" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "reasons" TEXT[],
    "comment" VARCHAR(500),
    "version" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "extension_uninstall_feedbacks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "extension_uninstall_feedbacks_installationId_key" ON "extension_uninstall_feedbacks"("installationId");
ALTER TABLE "extension_uninstall_feedbacks" ADD CONSTRAINT "extension_uninstall_feedbacks_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "extension_installations"("installationId") ON DELETE CASCADE ON UPDATE CASCADE;
