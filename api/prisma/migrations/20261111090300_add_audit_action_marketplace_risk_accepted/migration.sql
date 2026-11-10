-- Tenant aceitou o aviso de risco de um marketplace. Migration própria: ADD VALUE não pode ser usado na transação que o cria.
ALTER TYPE "AuditAction" ADD VALUE 'MARKETPLACE_RISK_ACCEPTED';
