-- Ações de auditoria das liberações de nome premium (storefront T12). Sozinha na migration:
-- ADD VALUE de enum não pode ser usado na mesma transação em que foi criado.
ALTER TYPE "AuditAction" ADD VALUE 'PREMIUM_SLUG_GRANTED';
ALTER TYPE "AuditAction" ADD VALUE 'PREMIUM_SLUG_REVOKED';
