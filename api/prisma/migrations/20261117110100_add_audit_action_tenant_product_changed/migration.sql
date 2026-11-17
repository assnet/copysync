-- Auditoria da concessão/alteração de produto do tenant. Sozinha na migration:
-- ADD VALUE de enum não pode ser usado na mesma transação em que foi criado.
ALTER TYPE "AuditAction" ADD VALUE 'TENANT_PRODUCT_CHANGED';
