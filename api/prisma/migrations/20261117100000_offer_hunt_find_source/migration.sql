-- Origem do achado: item do ranking reaproveitado ("Fora do corte") não conta no teto
-- `offer_hunter_finds_per_day` nem no `sentCount` da execução. Linhas existentes = execução normal.
ALTER TABLE "offer_hunt_finds" ADD COLUMN "fromRanking" BOOLEAN NOT NULL DEFAULT false;
