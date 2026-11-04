-- seq do evento da central é BIGINT (autoincrement global): Int 32 bits estoura em 2^31-1
ALTER TABLE "tenants" ALTER COLUMN "lastBillingEventSeq" SET DATA TYPE BIGINT;
ALTER TABLE "billing_event_receipts" ALTER COLUMN "seq" SET DATA TYPE BIGINT;
