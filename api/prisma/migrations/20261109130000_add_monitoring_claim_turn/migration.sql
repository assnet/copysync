-- Seleção justa de capturas do monitoramento (.specs/features/monitoring-queue-isolation, entrega C).
-- Aditiva: coluna nullable sem backfill (null = nunca atendido, vem primeiro) e sequência do turno.
-- Lacunas da sequência (rollback) não afetam a ordem. Rollback de código mantém as duas.

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "monitoringClaimTurn" BIGINT;

-- CreateSequence (manual: o Prisma não modela sequência fora de @default)
CREATE SEQUENCE IF NOT EXISTS "monitoring_claim_turn_seq" AS BIGINT START WITH 1 INCREMENT BY 1 NO CYCLE;
