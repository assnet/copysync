-- Acesso por produto (docs/acesso-por-produto.md). Só a tabela: sem backfill, sem INSERT.
-- Sem linha: produto legado (AFFILIATES/CHAT) = ativo; produto novo = inativo.
CREATE TABLE "tenant_products" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "planSlug" TEXT,
    "expiresAt" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "inactiveSince" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_products_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_products_tenantId_product_key" ON "tenant_products"("tenantId", "product");

ALTER TABLE "tenant_products" ADD CONSTRAINT "tenant_products_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
