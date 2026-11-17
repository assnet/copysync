-- Auditoria do uso dos recursos (lista de contas por recurso). Sozinha na migration: valor novo de enum não pode ser usado na mesma transação.
ALTER TYPE "AuditAction" ADD VALUE 'USAGE_METRICS_VIEWED';
