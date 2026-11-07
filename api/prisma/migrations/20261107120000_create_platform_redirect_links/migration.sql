-- Links de redirecionamento da plataforma (marketing/suporte). Sem tenantId: recurso global,
-- só super-admin. Aditiva: tabela nova, nada existente muda. Ver docs/redirect-links.md.
CREATE TABLE "redirect_links" (
    "id" TEXT NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "urlA" VARCHAR(2048) NOT NULL,
    "urlB" VARCHAR(2048),
    "percentA" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "hitsA" INTEGER NOT NULL DEFAULT 0,
    "hitsB" INTEGER NOT NULL DEFAULT 0,
    "note" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "redirect_links_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "redirect_links_percentA_check" CHECK ("percentA" >= 0 AND "percentA" <= 100)
);

CREATE UNIQUE INDEX "redirect_links_slug_key" ON "redirect_links"("slug");
