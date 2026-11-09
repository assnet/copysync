-- Entrega D (MQ-19): LID do WhatsApp no contato, para resolver menção/citação sem a engine.
-- Aditiva: coluna nula, sem backfill; a chave única continua (tenantId, phone).

-- AlterTable
ALTER TABLE "chat_contacts" ADD COLUMN     "lid" TEXT;

-- CreateIndex
CREATE INDEX "chat_contacts_tenantId_lid_idx" ON "chat_contacts"("tenantId", "lid");
