-- Índice parcial: só sessões excluídas (soft delete), que acumulam para sempre.
-- Usado pelo claim da fila de envio (NOT IN de sessão excluída) e pelo lote
-- `skipForDeletedSessions` (docs/fila-de-envio.md §2.2.2). O Prisma 5 não declara índice
-- parcial no schema: fica só aqui, com comentário no model Session. `migrate diff` ignora.
CREATE INDEX "sessions_deleted_partial_idx" ON "sessions"("id") WHERE "deletedAt" IS NOT NULL;
