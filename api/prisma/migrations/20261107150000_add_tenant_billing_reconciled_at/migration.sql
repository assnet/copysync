-- Rodízio da reconciliação de assinaturas com a central (lote por passada)
ALTER TABLE "tenants" ADD COLUMN "billingReconciledAt" TIMESTAMP(3);
