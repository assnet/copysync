-- Janela de operação em todo envio + pausa global de envios (docs/fila-de-envio.md). Aditiva.

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "sendingPausedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "offers" ADD COLUMN     "monitorConfigId" TEXT;

-- AlterTable
ALTER TABLE "group_monitor_configs" ADD COLUMN     "captureOutsideWindow" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "offers_monitorConfigId_idx" ON "offers"("monitorConfigId");

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_monitorConfigId_fkey" FOREIGN KEY ("monitorConfigId") REFERENCES "group_monitor_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

