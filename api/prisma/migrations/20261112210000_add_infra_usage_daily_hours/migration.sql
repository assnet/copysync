-- Horas somadas na linha de banda do dia: o resumo conta as horas sem banda (aviso bandwidth_missing_hours).
-- Build (regrava o dia) fica com 0. Coluna nova com DEFAULT constante: sem reescrita da tabela.
ALTER TABLE "infra_usage_daily" ADD COLUMN "hours" INTEGER NOT NULL DEFAULT 0;
