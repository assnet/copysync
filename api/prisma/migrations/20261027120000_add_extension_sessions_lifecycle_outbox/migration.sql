-- CreateEnum
CREATE TYPE "ExtensionInstallationStatus" AS ENUM ('ACTIVE', 'UNINSTALLED', 'INFERRED_GONE', 'REPLACED');

-- CreateEnum
CREATE TYPE "HubOutboxEventStatus" AS ENUM ('PENDING', 'SENT', 'DEAD');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'AFFILIATE_SESSION_ACCOUNT_RESET';

-- AlterTable
ALTER TABLE "affiliate_credentials" ADD COLUMN "sessionInvalidAt" TIMESTAMP(3),
ADD COLUMN "sessionAccountHash" TEXT,
ADD COLUMN "sessionAccountKeyVersion" INTEGER;

-- CreateTable
CREATE TABLE "extension_installations" (
    "installationId" TEXT NOT NULL,
    "extensionId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "deviceId" TEXT,
    "userId" TEXT,
    "version" TEXT NOT NULL,
    "status" "ExtensionInstallationStatus" NOT NULL DEFAULT 'ACTIVE',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "installedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHeartbeatAt" TIMESTAMP(3),
    "lastSiteSeenAt" TIMESTAMP(3),
    "uninstalledAt" TIMESTAMP(3),
    "previousInstallationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "extension_installations_pkey" PRIMARY KEY ("installationId")
);

-- CreateTable
CREATE TABLE "extension_sessions" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prevTokenHash" TEXT,
    "prevValidUntil" TIMESTAMP(3),
    "userId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "mlTenantId" TEXT NOT NULL,
    "extVersion" TEXT NOT NULL,
    "mlConsentAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "absoluteExpiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "extension_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extension_lifecycle_events" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "channel" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extension_lifecycle_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hub_outbox_events" (
    "id" TEXT NOT NULL,
    "clientKey" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "installationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "HubOutboxEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hub_outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hub_outbox_sequences" (
    "clientKey" TEXT NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "hub_outbox_sequences_pkey" PRIMARY KEY ("clientKey")
);

-- CreateIndex
CREATE INDEX "extension_installations_deviceId_extensionId_idx" ON "extension_installations"("deviceId", "extensionId");

-- CreateIndex
CREATE INDEX "extension_installations_userId_idx" ON "extension_installations"("userId");

-- CreateIndex
CREATE INDEX "extension_installations_status_lastSeenAt_idx" ON "extension_installations"("status", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "extension_sessions_tokenHash_key" ON "extension_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "extension_sessions_prevTokenHash_idx" ON "extension_sessions"("prevTokenHash");

-- CreateIndex
CREATE INDEX "extension_sessions_mlTenantId_idx" ON "extension_sessions"("mlTenantId");

-- CreateIndex
CREATE INDEX "extension_sessions_absoluteExpiresAt_idx" ON "extension_sessions"("absoluteExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "extension_sessions_userId_installationId_key" ON "extension_sessions"("userId", "installationId");

-- CreateIndex
CREATE UNIQUE INDEX "extension_lifecycle_events_installationId_dedupeKey_key" ON "extension_lifecycle_events"("installationId", "dedupeKey");

-- CreateIndex
CREATE INDEX "extension_lifecycle_events_occurredAt_idx" ON "extension_lifecycle_events"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "hub_outbox_events_clientKey_seq_key" ON "hub_outbox_events"("clientKey", "seq");

-- CreateIndex
CREATE INDEX "hub_outbox_events_status_nextAttemptAt_idx" ON "hub_outbox_events"("status", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "extension_installations" ADD CONSTRAINT "extension_installations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extension_sessions" ADD CONSTRAINT "extension_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extension_sessions" ADD CONSTRAINT "extension_sessions_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "extension_installations"("installationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extension_sessions" ADD CONSTRAINT "extension_sessions_mlTenantId_fkey" FOREIGN KEY ("mlTenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extension_lifecycle_events" ADD CONSTRAINT "extension_lifecycle_events_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "extension_installations"("installationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data migration: marketplace_extension presets
INSERT INTO "plan_entitlement_presets" ("id", "planSlug", "key", "value")
VALUES
  (gen_random_uuid()::text, 'COPYSYNC_STARTER', 'marketplace_extension', 'true'),
  (gen_random_uuid()::text, 'COPYSYNC_PROFISSIONAL', 'marketplace_extension', 'true'),
  (gen_random_uuid()::text, 'COPYSYNC_BUSINESS', 'marketplace_extension', 'true')
ON CONFLICT ("planSlug", "key") DO NOTHING;
