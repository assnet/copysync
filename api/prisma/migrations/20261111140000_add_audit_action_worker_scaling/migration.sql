-- Ações de auditoria da escala dos workers (configuração e pedido de escala). Sozinha na migration:
-- ADD VALUE de enum não pode ser usado na mesma transação em que foi criado.
ALTER TYPE "AuditAction" ADD VALUE 'WORKER_SCALING_SETTINGS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'WORKER_SCALE_REQUESTED';
