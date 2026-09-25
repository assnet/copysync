-- Catálogo de listas de conversa do painel.
-- Antes uma lista era só um nome gravado em chat_conversations.tags: sumia ao tirar a última
-- conversa. chat_lists guarda o nome por tenant (único, sensível a maiúsculas — a API compara
-- sem diferenciar) e é a porta para renomear/excluir com cascata em tags.
-- O GIN em chat_conversations.tags atende `tags @> ARRAY[nome]` nas contagens e cascatas.
-- Aditiva: nenhuma coluna existente muda; dados antigos em tags seguem válidos sem migração.

-- CreateTable
CREATE TABLE "chat_lists" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_lists_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_lists_tenantId_idx" ON "chat_lists"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_lists_tenantId_name_key" ON "chat_lists"("tenantId", "name");

-- CreateIndex
CREATE INDEX "chat_conversations_tags_idx" ON "chat_conversations" USING GIN ("tags");

-- AddForeignKey
ALTER TABLE "chat_lists" ADD CONSTRAINT "chat_lists_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

