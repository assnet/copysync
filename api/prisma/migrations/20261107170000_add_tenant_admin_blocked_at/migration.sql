-- Marcador explícito de bloqueio pelo super-admin: webhook de cobrança e reconciliação nunca mudam o status enquanto preenchido.
ALTER TABLE "tenants" ADD COLUMN "adminBlockedAt" TIMESTAMP(3);

-- Backfill idempotente: tenant hoje não-ACTIVE cuja ÚLTIMA auditoria de status veio do super-admin,
-- levou ao status atual e é posterior (ou igual) ao suspendedAt atual. O webhook de cobrança não grava
-- auditoria de status: sem essas duas condições, um bloqueio antigo do admin seguido de reativação e corte
-- por cobrança seria marcado como bloqueio do admin e o tenant nunca voltaria sozinho.
UPDATE "tenants" t
   SET "adminBlockedAt" = COALESCE(t."suspendedAt", CURRENT_TIMESTAMP)
 WHERE t."status" <> 'ACTIVE'
   AND t."adminBlockedAt" IS NULL
   AND EXISTS (
     SELECT 1
       FROM (
         SELECT a."meta"->>'origin' AS origin, a."meta"->>'newStatus' AS new_status, a."createdAt" AS created_at
           FROM "audit_logs" a
          WHERE a."tenantId" = t."id" AND a."action" = 'TENANT_STATUS_CHANGED'
          ORDER BY a."createdAt" DESC, a."id" DESC
          LIMIT 1
       ) last
      WHERE last.origin = 'SUPER_ADMIN'
        AND last.new_status = t."status"::text
        AND (t."suspendedAt" IS NULL OR last.created_at >= t."suspendedAt")
   );
