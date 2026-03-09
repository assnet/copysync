/*
  Warnings:

  - You are about to drop the column `data` on the `session_auth_states` table. All the data in the column will be lost.
  - Added the required column `statePayload` to the `session_auth_states` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `session_auth_states` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "session_auth_states" DROP COLUMN "data",
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'baileys',
ADD COLUMN     "statePayload" JSONB NOT NULL,
ADD COLUMN     "tenantId" TEXT NOT NULL,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "engine" TEXT NOT NULL DEFAULT 'baileys',
ADD COLUMN     "externalRef" TEXT,
ADD COLUMN     "lastConnectedAt" TIMESTAMP(3),
ADD COLUMN     "lastDisconnectedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "session_auth_states_tenantId_idx" ON "session_auth_states"("tenantId");

-- CreateIndex
CREATE INDEX "sessions_tenantId_deletedAt_idx" ON "sessions"("tenantId", "deletedAt");

-- AddForeignKey
ALTER TABLE "session_auth_states" ADD CONSTRAINT "session_auth_states_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
