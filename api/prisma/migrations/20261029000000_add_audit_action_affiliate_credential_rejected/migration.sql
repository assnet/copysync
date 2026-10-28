-- Ação de auditoria da credencial recusada. Migration própria: ADD VALUE não pode ser usado na transação que o cria.
ALTER TYPE "AuditAction" ADD VALUE 'AFFILIATE_CREDENTIAL_REJECTED';
