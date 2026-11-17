-- Saver (.specs/features/saver/design.md §3). Só tabelas novas: nenhuma coluna em tabela existente.
-- `saver_contacts` é a base da PLATAFORMA (sem tenantId, de propósito); unicidade de phone/lid é do banco.
-- Sessão excluída é lógica (`sessions.deletedAt`): as FKs para `sessions` não são o mecanismo de limpeza.

-- CreateTable
CREATE TABLE "saver_configs" (
    "tenantId" TEXT NOT NULL,
    "namePrefix" TEXT,
    "excludeAdminsByDefault" BOOLEAN NOT NULL DEFAULT false,
    "defaultFormat" TEXT NOT NULL DEFAULT 'CSV',
    "autoRefresh" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saver_configs_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "saver_groups" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT,
    "groupJid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "phoneCount" INTEGER NOT NULL DEFAULT 0,
    "lidOnlyCount" INTEGER NOT NULL DEFAULT 0,
    "lastScannedAt" TIMESTAMP(3),
    "lastScanStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "saver_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saver_contacts" (
    "id" TEXT NOT NULL,
    "phone" TEXT,
    "lid" TEXT,
    "name" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saver_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saver_group_memberships" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "name" TEXT,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "firstExtractedAt" TIMESTAMP(3) NOT NULL,
    "lastExtractedAt" TIMESTAMP(3) NOT NULL,
    "lastExtractionId" TEXT,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "saver_group_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saver_export_grants" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grantedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saver_export_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saver_extractions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT,
    "requestedByUserId" TEXT,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "totalGroups" INTEGER NOT NULL DEFAULT 0,
    "doneGroups" INTEGER NOT NULL DEFAULT 0,
    "failedGroups" INTEGER NOT NULL DEFAULT 0,
    "membersFound" INTEGER NOT NULL DEFAULT 0,
    "newContacts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "saver_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saver_extraction_items" (
    "id" TEXT NOT NULL,
    "extractionId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "saver_extraction_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saver_session_states" (
    "sessionId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nextScanAt" TIMESTAMP(3) NOT NULL,
    "pausedUntil" TIMESTAMP(3),
    "pauseReason" TEXT,

    CONSTRAINT "saver_session_states_pkey" PRIMARY KEY ("sessionId")
);

-- CreateIndex
CREATE INDEX "saver_groups_sessionId_idx" ON "saver_groups"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "saver_groups_tenantId_groupJid_key" ON "saver_groups"("tenantId", "groupJid");

-- CreateIndex
CREATE UNIQUE INDEX "saver_contacts_phone_key" ON "saver_contacts"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "saver_contacts_lid_key" ON "saver_contacts"("lid");

-- CreateIndex
CREATE INDEX "saver_contacts_lastSeenAt_idx" ON "saver_contacts"("lastSeenAt");

-- CreateIndex
CREATE INDEX "saver_group_memberships_contactId_idx" ON "saver_group_memberships"("contactId");

-- CreateIndex
CREATE INDEX "saver_group_memberships_tenantId_contactId_idx" ON "saver_group_memberships"("tenantId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "saver_group_memberships_groupId_contactId_key" ON "saver_group_memberships"("groupId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "saver_export_grants_tenantId_userId_key" ON "saver_export_grants"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "saver_extractions_tenantId_createdAt_idx" ON "saver_extractions"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "saver_extractions_status_idx" ON "saver_extractions"("status");

-- CreateIndex
CREATE INDEX "saver_extraction_items_sessionId_status_nextAttemptAt_idx" ON "saver_extraction_items"("sessionId", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "saver_extraction_items_extractionId_status_idx" ON "saver_extraction_items"("extractionId", "status");

-- CreateIndex
CREATE INDEX "saver_extraction_items_tenantId_createdAt_idx" ON "saver_extraction_items"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "saver_extraction_items_groupId_idx" ON "saver_extraction_items"("groupId");

-- CreateIndex
CREATE INDEX "saver_session_states_tenantId_idx" ON "saver_session_states"("tenantId");

-- AddForeignKey
ALTER TABLE "saver_configs" ADD CONSTRAINT "saver_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saver_groups" ADD CONSTRAINT "saver_groups_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saver_groups" ADD CONSTRAINT "saver_groups_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saver_group_memberships" ADD CONSTRAINT "saver_group_memberships_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saver_group_memberships" ADD CONSTRAINT "saver_group_memberships_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "saver_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saver_group_memberships" ADD CONSTRAINT "saver_group_memberships_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "saver_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saver_export_grants" ADD CONSTRAINT "saver_export_grants_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saver_export_grants" ADD CONSTRAINT "saver_export_grants_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "user_tenants"("userId", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saver_extractions" ADD CONSTRAINT "saver_extractions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saver_extractions" ADD CONSTRAINT "saver_extractions_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saver_extraction_items" ADD CONSTRAINT "saver_extraction_items_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "saver_extractions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saver_extraction_items" ADD CONSTRAINT "saver_extraction_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saver_extraction_items" ADD CONSTRAINT "saver_extraction_items_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saver_extraction_items" ADD CONSTRAINT "saver_extraction_items_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "saver_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saver_session_states" ADD CONSTRAINT "saver_session_states_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saver_session_states" ADD CONSTRAINT "saver_session_states_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Item pendente é único por grupo (SAVER-10). Parcial: só em SQL cru (Prisma 5 não declara); não remover.
CREATE UNIQUE INDEX "saver_extraction_items_pending_group_key" ON "saver_extraction_items"("groupId")
  WHERE "status" IN ('QUEUED', 'RUNNING');
