-- Estados da conversa exibidos no painel.
-- pinned e mutedUntil espelham o WhatsApp; favorite e manuallyUnread são do painel,
-- porque o protocolo não expõe equivalentes.
ALTER TABLE "chat_conversations" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "chat_conversations" ADD COLUMN "mutedUntil" TIMESTAMP(3);
ALTER TABLE "chat_conversations" ADD COLUMN "favorite" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "chat_conversations" ADD COLUMN "manuallyUnread" BOOLEAN NOT NULL DEFAULT false;

-- Fixadas vão para o topo da listagem, sempre dentro do tenant.
CREATE INDEX "chat_conversations_tenantId_pinned_idx" ON "chat_conversations"("tenantId", "pinned");
