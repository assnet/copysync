-- Auditoria da exclusão da Página de Ofertas (docs/pagina-de-ofertas.md). Sozinha na migration:
-- ADD VALUE de enum não pode ser usado na mesma transação em que foi criado.
ALTER TYPE "AuditAction" ADD VALUE 'STOREFRONT_DELETED';
