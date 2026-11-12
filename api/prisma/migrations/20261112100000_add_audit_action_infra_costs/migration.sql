-- Ação de auditoria da configuração de custos da infraestrutura. Sozinha na migration:
-- ADD VALUE de enum não pode ser usado na mesma transação em que foi criado.
ALTER TYPE "AuditAction" ADD VALUE 'INFRA_COST_SETTINGS_CHANGED';
