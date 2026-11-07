-- Marcador explícito de bloqueio pelo super-admin: webhook de cobrança e reconciliação nunca mudam o status enquanto preenchido.
ALTER TABLE "tenants" ADD COLUMN "adminBlockedAt" TIMESTAMP(3);

-- Backfill idempotente: tenant hoje não-ACTIVE cuja última auditoria de status veio do super-admin.
UPDATE "tenants" t
   SET "adminBlockedAt" = COALESCE(t."suspendedAt", CURRENT_TIMESTAMP)
 WHERE t."status" <> 'ACTIVE'
   AND t."adminBlockedAt" IS NULL
   AND (
     SELECT a."meta"->>'origin'
       FROM "audit_logs" a
      WHERE a."tenantId" = t."id" AND a."action" = 'TENANT_STATUS_CHANGED'
      ORDER BY a."createdAt" DESC, a."id" DESC
      LIMIT 1
   ) = 'SUPER_ADMIN';
