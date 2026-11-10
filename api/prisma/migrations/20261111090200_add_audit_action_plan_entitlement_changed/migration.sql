-- Super admin alterou um entitlement de plano. Migration própria: ADD VALUE não pode ser usado na transação que o cria.
ALTER TYPE "AuditAction" ADD VALUE 'PLAN_ENTITLEMENT_CHANGED';
