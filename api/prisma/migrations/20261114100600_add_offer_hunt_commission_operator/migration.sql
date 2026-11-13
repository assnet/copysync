-- Filtro de comissão de 1ª compra com operador (maior que / igual ou maior que / menor que) sobre `minCommissionPercent`.
CREATE TYPE "HuntCommissionOperator" AS ENUM ('GT', 'GTE', 'LT');

ALTER TABLE "offer_hunts" ADD COLUMN "commissionOperator" "HuntCommissionOperator";

-- Backfill: o mínimo de antes era "igual ou maior que".
UPDATE "offer_hunts" SET "commissionOperator" = 'GTE' WHERE "minCommissionPercent" IS NOT NULL;

-- A faixa da fonte (`commRate`) filtra a comissão de RECOMPRA: o caçador não a usa mais. Grava ANY (5) para
-- refletir o que a execução faz (ela já ignora a coluna).
UPDATE "offer_hunts" SET "commissionBand" = 5 WHERE "commissionBand" IS DISTINCT FROM 5;
