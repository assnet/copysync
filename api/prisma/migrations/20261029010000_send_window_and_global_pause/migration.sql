-- Janela de operação em todo envio + pausa global de envios (docs/fila-de-envio.md). Aditiva.

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "sendingPausedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "group_monitor_configs" ADD COLUMN     "captureOutsideWindow" BOOLEAN NOT NULL DEFAULT true;

