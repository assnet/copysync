-- Credencial recusada pela loja (monitoramento pausa a loja até o usuário reconfigurar) e índice para
-- "lojas com captura CREDENTIAL_MISSING recente" por tenant.

-- AlterTable
ALTER TABLE "affiliate_credentials" ADD COLUMN "rejectedAt" TIMESTAMP(3), ADD COLUMN "rejectedCode" TEXT;

-- CreateIndex
CREATE INDEX "captured_offers_tenantId_status_capturedAt_idx" ON "captured_offers"("tenantId", "status", "capturedAt");
