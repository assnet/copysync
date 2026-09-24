-- Reações em mensagens do chat.
-- Uma linha por (mensagem, autor). Remoção vira tombstone (emoji NULL), não DELETE: eventos
-- fora de ordem precisam do carimbo da remoção para comparar (last-write-wins em reactedAt).
-- O índice em chat_messages atende a busca da mensagem alvo por id externo.
-- Aditiva: nenhuma coluna existente muda.

-- CreateTable
CREATE TABLE "chat_message_reactions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "emoji" TEXT,
    "reactorKey" TEXT NOT NULL,
    "reactorPhone" TEXT,
    "reactorName" TEXT,
    "fromMe" BOOLEAN NOT NULL DEFAULT false,
    "externalId" TEXT,
    "reactedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_message_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_message_reactions_tenantId_messageId_idx" ON "chat_message_reactions"("tenantId", "messageId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_message_reactions_messageId_reactorKey_key" ON "chat_message_reactions"("messageId", "reactorKey");

-- CreateIndex
CREATE INDEX "chat_messages_tenantId_externalMessageId_idx" ON "chat_messages"("tenantId", "externalMessageId");

-- AddForeignKey
ALTER TABLE "chat_message_reactions" ADD CONSTRAINT "chat_message_reactions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_message_reactions" ADD CONSTRAINT "chat_message_reactions_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

