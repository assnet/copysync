# Página de Ofertas

Vitrine pública do tenant num link só (`https://<nome>.<domínio de links>`), para a bio de Instagram/TikTok/WhatsApp:
capa, foto, nome, subtítulo, filtro de categorias e cards de oferta com link de afiliado. Roadmap item 12.
Specs: `.specs/features/storefront/` (`spec`, `design`, `context`, `tasks`). Termo de produto: **Página de Ofertas**.
Nome técnico: `storefront` (módulo `api/src/modules/storefront/`, painel `app/src/features/storefront/`).

## Planos

- Entitlement booleano **`storefront_enabled`**: Starter `false`, Profissional `true`, Business `true`
  (`tenants/domain/planPresets.ts`, travado no teste contra `features/plans/catalog.ts`). Data migration grava `false`
  **explícito** no Starter: o sync só faz upsert do que existe, então ausência não desligaria tenant rebaixado.
- **Ausente = bloqueado** (diferente dos limites numéricos, onde ausente = ilimitado). Gate só com
  `getBoolean(...) === true` (`requireStorefrontEnabled`).
- Sem o entitlement, toda rota `/api/storefront/*` → `403 PLAN_FEATURE_UNAVAILABLE`. O painel redireciona para
  `/plans?feature=storefront` só nesse código (`features/storefront/planGate.ts`; `PLAN_LIMIT_REACHED` também é 403 e
  não redireciona) e `/plans` mostra o aviso (`PlansFeatureNotice`). Menu visível para todos com selo "Profissional".
- Limites (200/60/rate limit) são **constantes de domínio**, não entitlement.

## Namespace compartilhado com o rodízio

Rodízio e página usam o mesmo `LinkDomain` (Render só tem 2 domínios custom). Dono único de `<slug>.<domínio>`:
**`PublicSlugClaim`** (`public_slug_claims`, unique `(domainId, slug)`, `kind` `LINK_ROTATION | STOREFRONT`, exatamente
um de `linkRotationId`/`storefrontId` por CHECK). Unicidade no banco, não na aplicação.

- Porta `IPublicSlugRegistry` (link-rotation, `PrismaPublicSlugRegistry`): `check`, `claim`, `move`, `release`. Sempre
  dentro de `runInSlugTransaction` (UnitOfWork). `P2002` é capturado **fora** da tx e vira `409 LINK_SLUG_TAKEN` com
  sugestões.
- `check` devolve 6 estados, decididos pela função pura `decideSlugAvailability` (ordem: formato → reservados →
  claim → rodízio sem claim → reserva de outro tenant → premium sem grant):

  | Estado | Painel |
  | --- | --- |
  | `AVAILABLE` | "Disponível" |
  | `OWNED` | "É seu" (o próprio tenant já usa) |
  | `TAKEN` | "Em uso" + até 5 sugestões |
  | `RESERVED` | "Indisponível" (nome bloqueado do domínio ou largado por outro tenant há < 30 dias) |
  | `PREMIUM` | "Comprar": banner do nome especial, Salvar bloqueado (`409 STOREFRONT_SLUG_PREMIUM`) |
  | `INVALID` | regra do formato (`slugRules.ts`: 3–50, `[a-z0-9-]`, sem hífen nas pontas) |

- Troca de nome ou exclusão: o antigo fica reservado 30 dias ao mesmo tenant (`link_slug_reservations`), no domínio
  antigo. Apagar dono chama `release` na mesma tx, antes do delete; o Cascade da FK é só rede.
- Rodízio também passa pelo registry em create/rename/delete. No rodízio: `OWNED` → `LINK_SLUG_TAKEN`, `PREMIUM` →
  `LINK_SLUG_RESERVED` (nome especial é da página).
- Rede da janela de deploy: `check` também olha `link_rotations` sem claim. Backfill idempotente
  (`ON CONFLICT DO NOTHING`) na migration `20261029030000_add_storefront_and_public_slug_claims`; rodar de novo após o
  deploy (T31).
- `DeleteLinkDomainUseCase` conta claims + grants: domínio em uso → `409 LINK_DOMAIN_IN_USE`.

### Nomes especiais

- `LinkDomain.premiumNames` (máx. 1000, editado na tela admin de domínios, mesmo padrão de `reservedNames`).
- Super-admin concede com `POST /api/admin/link-domains/:id/premium-grants` `{tenantId, slug, expiresAt?}`
  (`GrantPremiumSlugUseCase`, `source = MANUAL`, `AuditLog`); lista/revoga em `GET`/`DELETE .../premium-grants/:grantId`.
  Um grant por nome e domínio (já concedido → 409; revogar antes). Painel: `PremiumGrantsDialog`.
- Com grant, o nome é `AVAILABLE` para o tenant e `TAKEN` para os demais depois do uso. Grant expirado não tira a
  página do nome (sem job de liberação na v1).
- **Compra ainda é placeholder**: `PREMIUM_SLUG_OFFER` em `features/plans/catalog.ts` (texto de vitrine, fora de
  `PLAN_CATALOG`), `checkoutUrl: null` → botão "Em breve" desabilitado. Hub não tem add-on; quando tiver, o evento cria
  `PremiumSlugGrant(source = BILLING)`.

## Imagens

| Tipo | Entrada | Saída |
| --- | --- | --- |
| Foto (`avatar`) | JPEG/PNG/WebP ≤ 2 MiB, mín. 200×200 | WebP 320×320, recorte quadrado |
| Capa (`cover`) | JPEG/PNG/WebP ≤ 4 MiB, mín. 1200×400 | WebP 1500×500, recorte 3:1 |
| Oferta | baixada do marketplace (`IOfferImageFetcher`, ≤ 5 MiB, `image/*`) | WebP lado maior 600 px |

- Na página pública, com capa a faixa é 3:1 limitada a 320 px de altura; sem capa vira faixa baixa (120 px
  celular / 160 px desktop) na cor principal, nunca um bloco 3:1 vazio.
- Upload de foto/capa por `chunkedUpload` → `PUT /api/storefront/images/:kind {uploadId}` (`SetStorefrontImageUseCase`
  consome a sessão de upload direto, sem gravar o bruto).
- `SharpStorefrontImageProcessor` (`sharp` é dependência direta da API): formato pelo **conteúdo**, nunca pelo mime
  declarado; `limitInputPixels` 40 MP; WebP q80 sem EXIF. Erros: `413 MEDIA_TOO_LARGE`, `415 UNSUPPORTED_MEDIA_TYPE`,
  `422 MEDIA_PROCESSING_FAILED` (com dimensão mínima no `meta`).
- `StorefrontMediaStore` grava `storefront-<uuid>.webp` e só apaga objeto com nome nesse padrão. Trocar/remover foto,
  capa ou oferta apaga o arquivo anterior.
- **`S3_PUBLIC_URL` é obrigatório para a imagem aparecer na página pública**: o template só aceita URL https da mesma
  origem; fora disso cai no fallback (iniciais / sem imagem). Com `MEDIA_STORAGE_DRIVER=local` a página não mostra
  imagens: validar em dev com bucket.
- Falha na imagem da oferta não impede o rascunho.

## Extração de oferta

`POST /api/storefront/offers {url, category?}` → oferta `DRAFT` no fim dos rascunhos (`ExtractStorefrontOfferUseCase`).

- Mesma regra do gerador, via `ResolveAffiliateProductUseCase` (campaigns, extraído de `GenerateOfferUseCase`):
  allowlist (Shopee, Mercado Livre, Amazon), expansão de link curto revalidando cada salto (anti-SSRF), dono do link.
- Link sem produto (vitrine/loja) → `OFFER_URL_UNSUPPORTED` ("use o link do PRODUTO"). Exceção herdada: ML
  `meli.la`/`/social/` aceito, produto vem do 1º card.
- Link de outro afiliado → `OFFER_LINK_NOT_OWNED` / `OFFER_LINK_NOT_AFFILIATE`. ML com cookies gera o link do tenant.
  Amazon sem `?tag=` → `OFFER_LINK_NOT_AFFILIATE`.
- **Shopee diverge do gerador**: com credencial (appId + secret) gera o link do tenant via
  `BuildTenantAffiliateLinkUseCase` (`attributionVerified = true`); sem credencial, credencial recusada ou falha →
  grava o link colado com `attributionVerified = false` e o painel mostra "comissão não verificada".
- Não usa `GenerateOfferUseCase`: não grava `Offer`, não compõe texto e não consome a cota diária do gerador.

## Limites

| Limite | Valor | Erro |
| --- | --- | --- |
| Ofertas no total | 200 | `409 STOREFRONT_OFFER_LIMIT` |
| Publicadas | 60 | `409 STOREFRONT_PUBLISHED_LIMIT` |
| Nome 2–60 · subtítulo ≤ 80 · título da oferta ≤ 140 · cores `#RRGGBB` · categorias ⊂ catálogo de 17 | — | 400 de validação |
| Checar nome (`storefrontSlug`) | 30/min por tenant | 429 `RATE_LIMITED` |
| Preview (`storefrontPreview`) | 60/min por tenant | 429 |
| Extração (`storefrontExtract`) | 60/h por tenant (conta a requisição) | 429 |

Rate limit por tenant: `perTenantRateLimit` (`shared/http/rateLimitPresets.ts`), hook `preHandler` depois do
`authHook`, chave `tenantId`. Store em memória por instância (ver pendências).
Ordem: `PUT /offers/order` exige o conjunto exato de ids da aba, senão `400 STOREFRONT_ORDER_INVALID`. Categoria
removida da página deixa as ofertas dela "Sem categoria".

## Página pública

Mesmo hook por Host do rodízio (`publicLink.routes.ts`), **sem rota pública nova**. Despacho por fallback: com
`match.kind === 'slug'` o resolver do rodízio roda como antes; só no `not_found` chama
`pageRenderers.STOREFRONT` (`RenderPublicStorefrontUseCase`, injetado em `app.ts` via `createPublicLinkDeps`).
Link-rotation não importa storefront. Apex segue a landing; página não existe no apex.

| Situação | HTTP | Página |
| --- | --- | --- |
| Sem página nem rodízio | 404 | 404 da marca |
| Tenant não `ACTIVE` | 503 | indisponível |
| `PAUSED_BY_PLAN` | 200 | "pausada" |
| `ACTIVE` sem publicadas | 200 | "em breve" |
| `ACTIVE` com publicadas | 200 | vitrine, `Cache-Control: public, max-age=60` |

- HTML **sem JS** (`renderStorefrontPage`, template puro, tudo escapado); filtro de categorias por CSS `:checked`.
- CSP por resposta com o `sha256` do `<style>` renderizado (as cores mudam o hash); `img-src` = `S3_PUBLIC_URL` +
  assets da marca. Hash inválido → 503.
- Só a vitrine com ofertas é cacheável e indexável; o resto vai com `no-store` + `noindex`.
- Card: "Ver oferta" com `target="_blank" rel="nofollow sponsored noopener"`; link só http(s). OG tags com capa ou
  foto. Rodapé com `APP_NAME`.
- Preview do painel: `POST /api/storefront/preview` renderiza o **mesmo** template com o rascunho (`isPreview`, sem OG,
  3 ofertas de exemplo marcadas quando não há publicadas); painel mostra em `<iframe sandbox srcdoc>`. A página pública
  nunca mostra exemplos.

## Rotas (`/api/storefront`, auth + tenant + gate)

| Método | Rota | Use case |
| --- | --- | --- |
| GET | `/` | `GetStorefrontUseCase` (página, ofertas, `publicUrl`, catálogo de categorias) |
| GET | `/slug-availability?slug=&domainId=` | `CheckStorefrontSlugUseCase` |
| PUT | `/` | `SaveStorefrontUseCase` (cria com claim ou atualiza com move) |
| PUT / DELETE | `/images/:kind` (`avatar`, `cover`) | `SetStorefrontImageUseCase` / `RemoveStorefrontImageUseCase` |
| POST | `/preview` | `PreviewStorefrontUseCase` (`text/html`) |
| POST | `/offers` | `ExtractStorefrontOfferUseCase` |
| PATCH | `/offers/:id` | `UpdateStorefrontOfferUseCase` (título, preço, preço "de", categoria; link não muda) |
| POST | `/offers/:id/status` | `SetStorefrontOfferStatusUseCase` (publicar vai para o fim da aba) |
| PUT | `/offers/order` | `ReorderStorefrontOffersUseCase` |
| DELETE | `/offers/:id` | `DeleteStorefrontOfferUseCase` (apaga a imagem) |

Admin de nomes especiais: `/api/admin/link-domains/:id/premium-grants` (super-admin), ver acima.

## Efeitos de plano

`integrations/billing/applyPlanSideEffects.ts` roda no mesmo client/tx que gravou os entitlements
(`SyncTenantEntitlementsUseCase` e `ApplyBillingEventUseCase`): primeiro `applyLinkRotationPlanLimits`, depois
`ApplyPlanToStorefrontUseCase`. Sem `storefront_enabled === true` → página `PAUSED_BY_PLAN` (dados e nome mantidos);
volta → `ACTIVE` sem ação do tenant. Sequencial: tx interativa não paraleliza.

## Painel (fluxo do spec)

Card "Criar minha Página" → form (nome, endereço com checagem de disponibilidade em debounce 400 ms, foto, capa,
subtítulo com 4 sugestões, categorias, 3 cores) → preview Mobile/Desktop → colar link e Extrair → abas Rascunhos /
Publicadas (publicar, arrastar ou ▲▼, editar, apagar com confirmação) → endereço no topo com copiar/abrir.
Estado de trabalho em `usePersistedState` (escopo `tab`, limpo ao salvar). Privacidade: flags `storefront.name`,
`.photo`, `.cover`, `.subdomain`, `.offerTitle`, `.offerImage` em `privacyFlags.ts`; preview inteiro borrado se
qualquer flag ligada.

## O que não fazer

- Não criar tabela/checagem de unicidade paralela: todo subdomínio público passa por `IPublicSlugRegistry` e
  `PublicSlugClaim`, na transação do dono.
- Não criar rota pública nem segundo hook por Host: a vitrine é fallback do hook do rodízio. Não mudar o
  comportamento do rodízio para atender a vitrine.
- Não tratar `storefront_enabled` ausente como liberado; não mover os limites 200/60 para entitlement sem decisão.
- Não chamar `GenerateOfferUseCase` nem duplicar a allowlist/expansão: use `ResolveAffiliateProductUseCase`.
- Não fazer hotlink de imagem do marketplace nem servir arquivo pela API; imagem só do storage (`S3_PUBLIC_URL`).
- Não confiar no mime declarado; não apagar objeto do storage fora do padrão `storefront-<uuid>.webp`.
- Não pôr JS na página pública, `unsafe-inline` na CSP nem cor fora de `#RRGGBB` no CSS.
- Não fazer preview com componente React que imita a página: o preview é o mesmo template.
- Não pôr preço do nome especial no banco nem gateway: texto em `catalog.ts`.
- Não usar o nome do app em código, rota ou chave (white label); marca só via `APP_NAME`.
- Não rodar migration/backfill local contra `api/.env` (produção).

## Pendências e riscos aceitos

- Os 4 tenants de produção estão sem `planSlug` → vitrine bloqueada até evento do hub ou concessão manual.
- Compra do nome especial é placeholder (hub sem add-on); concessão só pelo super-admin.
- Rate limit em memória por instância; store externo quando houver mais de uma instância http
  (`arquitetura-escala.md`).
- Janela de deploy pode criar rodízio sem claim → rodar o backfill idempotente de novo após o deploy (T31).
- `MEDIA_STORAGE_DRIVER=local` não mostra imagens na página pública.
- `catalog.ts` promete "domínio personalizado", fora da v1 (roadmap 15).
- Decisões 4 (link Shopee) e 5 (limites) de `context.md` são propostas a confirmar com o dono.
- Nome de plano rebaixado (ou grant expirado) não é liberado: sem job na v1.
- Fora da v1: cliques por oferta, oferta vinda do gerador/monitoramento, mais de uma página por tenant, tradução da
  página pública.

## Mapa de arquivos

| Camada | Caminho |
| --- | --- |
| Domínio | `storefront/domain/` (`entities/`, `enums/`, `services/storefrontRules.ts`, `storefrontCategories.ts`, `contracts/`) |
| Use cases | `storefront/application/use-cases/` |
| Infra | `storefront/infrastructure/` (`repositories/`, `mappers/`, `adapters/SharpStorefrontImageProcessor`, `StorefrontMediaStore`, `storefrontContainer`) |
| Rotas e template | `storefront/presentation/` (`routes/storefront.routes.ts`, `templates/renderStorefrontPage.ts`, `storefrontPageTemplate.ts`) |
| Namespace | `link-rotation/domain/services/decideSlugAvailability.ts`, `domain/contracts/IPublicSlugRegistry.ts`, `infrastructure/repositories/PrismaPublicSlugRegistry.ts` |
| Erros | `shared/errors/internal/StorefrontErrors.ts`, `LinkRotationErrors.ts`, `MediaErrors.ts`, `PlanErrors.ts` |
| Banco | `20261029030000_add_storefront_and_public_slug_claims`, `20261029040000_add_premium_slug_audit_actions` |
| Painel | `app/src/features/storefront/`, `features/plans/` (`catalog.ts`, `PlansFeatureNotice`), `features/linkDomainsAdmin/` (`PremiumGrantsDialog`), `app/NavItemBadge.tsx` |
