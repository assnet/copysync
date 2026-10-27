-- Envio com a sessão fora do ar volta para a fila (docs/fila-de-envio.md). Aditiva.

-- AlterTable
ALTER TABLE "offer_dispatches" ADD COLUMN     "waitingSessionSince" TIMESTAMP(3);

