-- Filtro de comissão de 1ª compra com operador (maior que / igual ou maior que / menor que) sobre `minCommissionPercent`.
CREATE TYPE "HuntCommissionOperator" AS ENUM ('GT', 'GTE', 'LT');

ALTER TABLE "offer_hunts" ADD COLUMN "commissionOperator" "HuntCommissionOperator";

-- Backfill: o mínimo de antes era "igual ou maior que". O teto do campo caiu de 100 para 50: clamp para a
-- caçada legada abrir válida no painel. `commissionBand` fica como está (a execução já ignora a coluna).
UPDATE "offer_hunts"
   SET "commissionOperator" = 'GTE', "minCommissionPercent" = LEAST("minCommissionPercent", 50)
 WHERE "minCommissionPercent" IS NOT NULL;
