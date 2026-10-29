# Página de Ofertas — Tasks

**Design**: `design.md` · **Status**: Draft (revisado contra código, 4 rodadas, 2026-10-29)
Branch: `feature/storefront` a partir de `feature/rebranding-app` (memória: branch de integração).
Gates (`.specs/codebase/TESTING.md`): `quick` = `pnpm test` no app tocado; `full` = typecheck + test nos dois.
Nunca rodar `prisma migrate deploy`/`start:migrate` local (`api/.env` = produção); `prisma migrate dev --create-only` contra Postgres descartável (memória: teste local).

## Plano de execução

```
F1 (seq): T1 → T2 → T3
F2:       T4 T5 T6 T9 em paralelo → depois T7 (T1,T5) e T8 (T4) em paralelo
F3 (seq): T10 → T11 → T12
F4:       T20 T13 T14 T15 T16 T17 em paralelo → depois T18 (T8,T13)
F5 (seq): T19 → T21 → T22
F6:       T23 e T24 em paralelo → depois T25 T26 T27 T28 em paralelo (T23)
F7 (seq): T29 → T30 → T31
```

## Tasks

### T1: sharp como dependência direta
**What**: adicionar `"sharp": "0.34.5"` (mesma do Baileys) em `dependencies` de `api/package.json`, regenerar lockfile, confirmar no Docker. **Where**: `api/package.json`, `pnpm-lock.yaml`, `api/Dockerfile`. **Depends**: — **Req**: STORE-07
**Done when**: `node -e "require('sharp')"` OK dentro do stage runner (`/app`), não só no build; resultado em STATE. **Tests**: none **Gate**: build

### T2: Schema + migration
**What**: modelos de `design.md §3`, `LinkDomain.premiumNames`, backfill de `public_slug_claims` a partir de `link_rotations`. **Where**: `api/prisma/schema.prisma`, `api/prisma/migrations/<ts>_add_storefront_and_public_slug_claims/` (snake_case como as pastas existentes). **Depends**: — **Req**: STORE-03, 06, 10, 14
**Done when**: `migrate dev --create-only` no Postgres descartável aplica e o backfill gera 1 claim por rodízio; SQL revisado (índices, FKs, `onDelete`). **Tests**: none **Gate**: build

### T3: Entitlement + presets
**What**: `ENTITLEMENT_KEYS.STOREFRONT_ENABLED = 'storefront_enabled'`; presets false/true/true; data migration com `false` explícito no Starter + backfill de `tenant_entitlements` para tenants com plano (§3); `catalog.ts`: "Página de Ofertas" em `benefits` + const `PREMIUM_SLUG_OFFER` fora de `PLAN_CATALOG`; `planPresets.test.ts`: trava `storefront_enabled` booleano (false/true/true) no mesmo ponto em que o teste trava as chaves booleanas; nenhum limite numérico novo (limites da vitrine são constantes de domínio). **Where**: `tenants/domain/entitlementKeys.ts`, `planPresets.ts` (+test), migration de dados, `app/src/features/plans/catalog.ts`. **Depends**: T2 **Req**: STORE-01, 05
**Done when**: teste que trava presets × catálogo verde. **Tests**: unit **Gate**: full

### T4 [P]: Domínio storefront
**What**: entidades, enums, `storefrontCategories.ts` (17 chaves + rótulo pt-BR), `storefrontRules.ts` puro (nome 2–60, subtítulo ≤ 80, título ≤ 140, `#RRGGBB`, categorias ⊂ catálogo, limites 200/60, presets de imagem). **Where**: `api/src/modules/storefront/domain/`. **Depends**: T3 **Req**: STORE-06, 07, 10
**Done when**: regras cobertas. **Tests**: unit **Gate**: quick

### T5 [P]: Contratos storefront
**What**: `IStorefrontRepository`, `IStorefrontOfferRepository` (todos com `tenantId`), `IStorefrontImageProcessor`, `IPublicPageRenderer`. **Where**: `storefront/domain/contracts/`. **Depends**: T3 **Req**: STORE-06..12 **Tests**: none **Gate**: quick

### T6 [P]: Erros internos
**What**: `StorefrontErrors.ts` (`STOREFRONT_SLUG_PREMIUM` 409, `STOREFRONT_OFFER_LIMIT`, `STOREFRONT_PUBLISHED_LIMIT` 409, `STOREFRONT_NOT_FOUND` 404, `STOREFRONT_ORDER_INVALID` 400). **Where**: `api/src/shared/errors/internal/`. **Depends**: T3 **Req**: STORE-05, 10, 11 **Tests**: none **Gate**: quick

### T7 [P]: Processador e store de imagem
**What**: `StorefrontMediaStore` (`save` → `storefront-<uuid>.webp`; `remove` só com nome nesse padrão, teste) e `SharpStorefrontImageProcessor` (presets avatar/cover/offer, formato pelo conteúdo, `limitInputPixels`, WebP q80 sem EXIF, erro traduzido). **Where**: `storefront/infrastructure/adapters/`. **Depends**: T1, T5 **Req**: STORE-07
**Done when**: testes com buffers gerados (PNG pequeno → 415/422, dimensão mínima, saída WebP no tamanho). **Tests**: unit **Gate**: quick

### T8 [P]: Template público
**What**: `renderStorefrontPage(model)` puro (§4.6), escape total, cores validadas, `allowedMediaUrl`, OG, chips CSS, modo preview com exemplos. **Where**: `storefront/presentation/templates/`. **Depends**: T4 **Req**: STORE-08, 12
**Done when**: testes: "Ver oferta" com `target="_blank" rel="nofollow sponsored noopener"`; `<script>` em título sai escapado; cor inválida não entra; preview mostra selo; público sem exemplos; HTML+CSS < 60 KB com 60 ofertas. **Tests**: unit **Gate**: quick

### T9 [P]: Extrair `ResolveAffiliateProductUseCase`
**What**: mover passos 2–4 de `GenerateOfferUseCase` (`:101-135`) + privados `checkOwnership`/`generateMlAffiliateLink` (`:182-209`) para use case próprio, com `ResolveProductDataUseCase` injetado; sem `storeImage`; gerador passa a usá-lo. **Where**: `campaigns/application/use-cases/`. **Depends**: — **Req**: STORE-09
**Done when**: testes atuais do gerador verdes sem mudar expectativa + testes novos do resolve. **Tests**: unit **Gate**: quick

### T10: `IPublicSlugRegistry` + Prisma
**What**: contrato e impl (`check`, `claim`, `move`, `release`) conforme §4.1 (impl construída com tx via `UnitOfWork`; porta sem tipo Prisma). **Where**: `link-rotation/domain/contracts/`, `infrastructure/repositories/PrismaPublicSlugRegistry.ts`, função pura `decideSlugAvailability` em `domain/services/`. **Depends**: T2 **Req**: STORE-03, 04, 14
**Done when**: ordem dos 6 estados coberta na função pura. **Tests**: unit **Gate**: quick

### T11: Rodízio usa o registry
**What**: `PrismaLinkRotationRepository` aceita `PrismaClient | TransactionClient` e, com tx, não aninha `$transaction` em `update`/`replaceGroups`/`incrementClick`; create/rename/delete de rodízio passam por `claim`/`move`/`release` na mesma `runInTransaction`; `requireAvailableSlug` delega a `check` com mapeamento `OWNED`→TAKEN, `PREMIUM`→RESERVED (§4.1). **Where**: `CreateLinkRotationUseCase.ts`, `RenameLinkRotationUseCase.ts`, `DeleteLinkRotationUseCase.ts`, `linkRotationRules.ts`, repo. **Depends**: T10 **Req**: STORE-03
**Done when**: testes do rodízio verdes; novos: slug de página → rodízio `LINK_SLUG_TAKEN`; nome premium → `LINK_SLUG_RESERVED`; rename com troca de domínio reserva no domínio antigo. **Tests**: unit **Gate**: quick

### T12: Admin premiumNames + grants
**What**: `premiumNames` no create/update de domínio (máx. 1000, mesma parse de `reservedNames`); `Grant/RevokePremiumSlugUseCase` com `AuditLog` (primeiro audit do admin de domínios; precedente `UpdateTenantStatusUseCase.ts:30`); migration `<ts2>_add_premium_slug_audit_actions` (design §3, depois da principal) com `PREMIUM_SLUG_GRANTED`/`PREMIUM_SLUG_REVOKED` no enum `AuditAction` (schema `:50`) + espelho em `shared/audit/IAuditLogRepository.ts:5`; rotas admin com `[authHook, superAdminHook]` e corpo de §4.7; aba na tela admin de domínios. **Where**: `link-rotation/application/use-cases/admin/`, `presentation/{schemas,routes}/linkDomainAdmin.*`, tela admin no `app/`. **Depends**: T10 **Req**: STORE-14 **Tests**: unit **Gate**: full

### T13 [P]: Get + CheckSlug
**What**: `GetStorefrontUseCase`, `CheckStorefrontSlugUseCase` com gate `storefront_enabled`. **Where**: `storefront/application/use-cases/`. **Depends**: T4–T6, T10 **Req**: STORE-01, 04 **Tests**: unit **Gate**: quick

### T14 [P]: Save
**What**: `SaveStorefrontUseCase` (cria com claim / atualiza com move numa transação; premium sem grant → `STOREFRONT_SLUG_PREMIUM` 409; P2002 capturado fora da tx; limpa categoria órfã). **Depends**: T4–T6, T10 **Req**: STORE-06, 05 **Tests**: unit **Gate**: quick

### T15 [P]: Imagens da página
**What**: `Set/RemoveStorefrontImageUseCase` com `{tenantId, userId, kind, uploadId}`; `IUploadSessionStore` direto: `beginConsume` (só `outcome === 'started'` segue; `in_progress` → `UPLOAD_IN_PROGRESS`, `incomplete` → `UPLOAD_INCOMPLETE`, `consumed`/`not_found` → `UPLOAD_NOT_FOUND`, sem `discard`) → tamanho → `readHead`/`binPath` → sharp → `StorefrontMediaStore.save` → `discard`, `releaseConsume` em erro; anterior via `StorefrontMediaStore.remove` (design §4.3). **Depends**: T5–T7 **Req**: STORE-07 **Tests**: unit **Gate**: quick

### T16 [P]: Extrair oferta
**What**: `ExtractStorefrontOfferUseCase` (limite 200, resolve, Shopee via `BuildTenantAffiliateLinkUseCase` com mapeamento de kinds de design §4.3, imagem `IOfferImageFetcher` → processor `offer` → `StorefrontMediaStore.save` tolerante a falha, `category` validada contra as categorias da página, `DRAFT` no fim). **Depends**: T1, T4–T7, T9 **Req**: STORE-09, 10 **Tests**: unit **Gate**: quick

### T17 [P]: Editar, status, ordem, apagar
**What**: `Update`, `SetStatus` (limite 60), `Reorder` (conjunto exato), `Delete` (+ imagem via `StorefrontMediaStore.remove`). **Depends**: T4–T7 **Req**: STORE-10, 11 **Tests**: unit **Gate**: quick

### T18 [P]: Preview + render público
**What**: `PreviewStorefrontUseCase`, `RenderPublicStorefrontUseCase` (só `ACTIVE` + tenant ativo; sem ofertas → "em breve"). **Depends**: T8, T13 **Req**: STORE-08, 12 **Tests**: unit **Gate**: quick

### T19: Plano → status
**What**: `ApplyPlanToStorefrontUseCase` + `integrations/billing/applyPlanSideEffects.ts(client, tenantId)` que chama rodízio e vitrine; substitui as 2 chamadas diretas de `applyLinkRotationPlanLimits` (`ApplyBillingEventUseCase.ts:133` já em tx; `SyncTenantEntitlementsUseCase.ts:23-32` passa a envolver upserts + `applyPlanSideEffects` em `prisma.$transaction(async tx => …)`, como `ApplyBillingEventUseCase.ts:125-133`). Repo da vitrine aceita client/tx. **Depends**: T4, T5, T20 **Req**: STORE-02 **Tests**: unit **Gate**: quick

### T20 [P]: Repositórios + mappers Prisma
**What**: `PrismaStorefrontRepository`, `PrismaStorefrontOfferRepository`, mappers. **Where**: `storefront/infrastructure/`. **Depends**: T2, T5 **Req**: STORE-06, 10 **Tests**: unit (mappers) **Gate**: quick

### T21: Rotas + schemas + presenters
**What**: rotas §4.7 com schema Fastify, handlers finos, rate limits por tenant conforme §4.7 (presets novos em `rateLimitPresets.ts`, `hook: 'preHandler'`, `keyGenerator` = `tenantId`). **Where**: `storefront/presentation/`, `storefrontContainer.ts`. **Depends**: T13–T20 **Req**: STORE-01..11 **Tests**: none (smoke) **Gate**: full

### T22: Despacho no hook público + `app.ts`
**What**: despacho por fallback de §4.2 (`pageRenderers` em `PublicLinkDeps`, só `match.kind === 'slug'`), helper de envio da vitrine (CSP com hash por resposta, cache 60 s); mover `if (!salt)` de `ResolvePublicLinkUseCase.ts:77` para depois de `findPublicByHost`; registrar rotas em `app.ts`. **Where**: `link-rotation/presentation/routes/publicLink.routes.ts`, `link-rotation/infrastructure/publicLinkComposition.ts`, `api/src/app/app.ts`. **Depends**: T18, T21 **Req**: STORE-12, 03
**Done when**: `publicLink.routes.test.ts` atual verde + casos novos via `inject`: Host de página → HTML da vitrine com CSP contendo o hash do `<style>`; Host de rodízio → igual a hoje (`no-store`); apex → landing. **Tests**: unit (inject) **Gate**: full

### T23 [P]: Painel — serviço, tipos, strings, lógica pura
**What**: `storefrontApi.ts`, `types.ts`, `strings.ts`, `storefrontForm.ts`, `reorder.ts`. **Where**: `app/src/features/storefront/`. **Depends**: T21 **Req**: STORE-04..11 **Tests**: unit **Gate**: quick

### T24 [P]: Gate + aviso em /plans + menu
**What**: trocar placeholder (`pages/modules/index.tsx:34-43`, `AppRoutes.tsx:19`) pela feature; campo `badge` no item de menu existente (`AppLayout.tsx:59`) com selo "Profissional" (render e chave em design §4.8); rótulo unificado "Página de Ofertas" (hoje "Página de ofertas", `AppLayout.tsx:59`); redirect só em `code === 'PLAN_FEATURE_UNAVAILABLE'`; aviso `feature=storefront` em `/plans`. **Where**: `app/src/app/AppLayout.tsx`, `AppRoutes.tsx`, `pages/modules/index.tsx`, `features/plans/`. **Depends**: T21 **Req**: STORE-01 **Tests**: unit (aviso) **Gate**: quick

### T25 [P]: Form de configuração
**What**: `StorefrontConfigCard`, `SlugField`, `PremiumSlugBanner`, `SubtitleField`, `CategoryChips`, `ColorField`, `ImagePicker` (`chunkedUpload`). **Depends**: T23 **Req**: STORE-04..07 **Tests**: unit (SlugField estados, banner) **Gate**: quick

### T26 [P]: Preview
**What**: `StorefrontPreview` (iframe `sandbox=""` + `srcdoc`, debounce, Mobile/Desktop, borrar). **Depends**: T23 **Req**: STORE-08, 15 **Tests**: unit (debounce/toggle) **Gate**: quick

### T27 [P]: Ofertas
**What**: `AddOfferCard`, `OfferTabs`, `OfferRow` (arrastar com `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`, novos em `app/package.json`, + mover por teclado ▲▼), `EditOfferDialog`, apagar via `ConfirmDialog`, ícones via `AppIcon`; selo "comissão não verificada" (`attributionVerified = false`) com atalho para credenciais em `OfferRow`. **Depends**: T23 **Req**: STORE-09..11 **Tests**: unit (abas/contadores) **Gate**: quick

### T28 [P]: Privacidade
**What**: tela `storefront` em `privacyFlags.ts` com 6 flags (uma por tipo, design §4.8); `Blurred` nos pontos; "Telas cobertas" em `docs/padrao-ui-painel.md`. **Depends**: T23 **Req**: STORE-15 **Tests**: unit **Gate**: quick

### T29: `StorefrontPage` + header + persistência
**What**: montar a página (header com copiar/abrir endereço), `usePersistedState` nos estados de trabalho, escuro/claro/sistema. **Depends**: T24–T28 **Req**: STORE-13, 15 **Tests**: none (smoke) **Gate**: full

### T30: Documentação e versão
**What**: `docs/pagina-de-ofertas.md` (o que fazer/não fazer, namespace compartilhado, limites, imagens, premium), linha no `AGENTS.md`, `docs/rodizio-de-links.md` (registry), roadmap item 12, `docs/planos.md`, `CHANGELOG.md`, versões `api/` `app/` (minor). **Depends**: T29 **Req**: STORE-16 **Tests**: none **Gate**: full

### T31: QA visual + smoke
**What**: após deploy, rodar de novo o backfill idempotente de claims (janela de deploy, design §3); agent-browser em claro/escuro, mobile/desktop; smoke: criar página, foto/capa, 3 ofertas, publicar, ordenar, abrir subdomínio; rodízio existente intacto; Starter redirecionado. **Depends**: T30 **Req**: todos **Gate**: smoke

## Validação

| Check | Resultado |
| --- | --- |
| Granularidade (1 entregável por task) | ✅ T12 e T25 agrupam peças pequenas do mesmo fluxo |
| Diagrama × `Depends` | ✅ |
| Testes × matriz (`use-cases`/`mappers`/puras = unit; rotas/páginas = smoke) | ✅ T22 usa `inject` (precedente `linkRotation.routes.test.ts`) |
| Cobertura STORE-01..16 | ✅ 16/16 mapeados |
