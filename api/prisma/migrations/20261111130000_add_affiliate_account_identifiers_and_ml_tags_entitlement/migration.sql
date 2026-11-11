-- Etiquetas da conta de afiliado (docs/integracoes-credenciais-afiliado.md, planPresets.ts).
-- accountIdentifiers: etiquetas da conta vistas na última sincronização da extensão.
-- linkedIdentifiers: vinculadas além da principal (publicIdentifier), em ordem.
-- AlterTable
ALTER TABLE "affiliate_credentials" ADD COLUMN     "accountIdentifiers" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "linkedIdentifiers" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Data migration: limite de etiquetas do Mercado Livre por plano (LITE 1, PRO 2, MAX 10).
-- DO NOTHING: não sobrescreve preset já ajustado à mão.
INSERT INTO "plan_entitlement_presets" ("id", "planSlug", "key", "value")
VALUES
  (gen_random_uuid()::text, 'COPYSYNC_LITE', 'mercado_livre_affiliate_tags', '1'),
  (gen_random_uuid()::text, 'COPYSYNC_PRO', 'mercado_livre_affiliate_tags', '2'),
  (gen_random_uuid()::text, 'COPYSYNC_MAX', 'mercado_livre_affiliate_tags', '10')
ON CONFLICT ("planSlug", "key") DO NOTHING;

-- Backfill para tenants com plano (o sync de entitlements só roda em webhook do billing).
-- Filtrado pela chave nova: sem o filtro copiaria todos os presets e mudaria chaves ausentes de outros recursos.
INSERT INTO "tenant_entitlements" ("id", "tenantId", "key", "value")
SELECT gen_random_uuid()::text, t."id", p."key", p."value"
FROM "tenants" t
JOIN "plan_entitlement_presets" p ON p."planSlug" = t."planSlug"
WHERE p."key" = 'mercado_livre_affiliate_tags'
ON CONFLICT ("tenantId", "key") DO NOTHING;
