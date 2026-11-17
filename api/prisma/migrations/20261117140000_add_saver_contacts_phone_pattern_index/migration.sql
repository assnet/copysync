-- Filtro por DDI/DDD da base de contatos da plataforma: `phone LIKE '<ddi><ddd>%'`.
-- O índice único de `phone` usa a collation do banco e não atende busca por prefixo; `text_pattern_ops` atende.
-- Aditiva. Sem CONCURRENTLY: o migrate roda em transação.
CREATE INDEX IF NOT EXISTS "saver_contacts_phone_pattern_idx" ON "saver_contacts" ("phone" text_pattern_ops);
