-- Espelha o estado de arquivamento do WhatsApp na conversa do painel.
ALTER TABLE "chat_conversations" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;

-- A listagem sempre filtra por arquivadas ou não arquivadas dentro do tenant.
CREATE INDEX "chat_conversations_tenantId_archived_idx" ON "chat_conversations"("tenantId", "archived");
