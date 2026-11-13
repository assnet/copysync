# Página de Ofertas

Vitrine pública do tenant num link só (`https://<nome>.<domínio de links>`), para a bio de Instagram/TikTok/WhatsApp:
capa, foto, nome, subtítulo, filtro de categorias e cards de oferta com link de afiliado. Roadmap item 12.
Specs: `.specs/features/storefront/` (`spec`, `design`, `context`, `tasks`). Termo de produto: **Página de Ofertas**.
Nome técnico: `storefront` (módulo `api/src/modules/storefront/`, painel `app/src/features/storefront/`).

## Planos

- Entitlement booleano **`storefront_enabled`**: LITE `false`, PRO `true`, MAX `true`
  (`tenants/domain/planPresets.ts`, travado no teste contra `features/plans/catalog.ts`). Data migration grava `false`
  **explícito** no LITE: o sync só faz upsert do que existe, então ausência não desligaria tenant rebaixado.
- **Ausente = bloqueado** (diferente dos limites numéricos, onde ausente = ilimitado). Gate só com
  `getBoolean(...) === true` (`requireStorefrontEnabled`).
- Sem o entitlement, toda rota `/api/storefront/*` → `403 PLAN_FEATURE_UNAVAILABLE`. O painel redireciona para
  `/plans?feature=storefront` só nesse código (`features/storefront/planGate.ts`; `PLAN_LIMIT_REACHED` também é 403 e
  não redireciona) e `/plans` mostra o aviso (`PlansFeatureNotice`). Menu visível para todos com selo "PRO".
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

- Troca de nome (página ou rodízio) e exclusão de rodízio: o antigo fica reservado 30 dias ao mesmo tenant
  (`link_slug_reservations`), no domínio antigo. Apagar dono chama `release` na mesma tx, antes do delete; o
  Cascade da FK é só rede.
- Exclusão da **página** é a exceção: `releaseWithoutReservation`, nome livre na hora (ver "Excluir a página").
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
  allowlist (Shopee, Mercado Livre, Amazon, Shein), expansão de link curto revalidando cada salto (anti-SSRF), link
  sempre do tenant (api 0.81.0; regra e erros em [`gerador-de-ofertas.md`](gerador-de-ofertas.md), "Link do tenant").
- Link sem produto (vitrine/loja) → `OFFER_URL_UNSUPPORTED` ("use o link do PRODUTO"). Exceção herdada: ML
  `meli.la`/`/social/` aceito, produto vem do 1º card.
- Link de outro afiliado ou limpo → recriado com a credencial do tenant nos 4 marketplaces; link curto oficial já do
  tenant é mantido. Sem credencial utilizável → `AFFILIATE_CREDENTIAL_REQUIRED`; loja não gerou →
  `OFFER_LINK_REBUILD_FAILED`. O item nasce sempre `attributionVerified = true`.
- Sem troca própria da Shopee (até a 0.80.0 a vitrine chamava `BuildTenantAffiliateLinkUseCase` e gravava o colado
  com `attributionVerified = false` quando falhava; removido). `storefrontContainer` não injeta mais o builder.
- Resposta da criação: `data: { ...item, linkRebuilt }` (só no `POST`; listagem não envia). O painel mostra
  `LinkRebuiltNotice` ao adicionar e `ConnectStoreAction` ("Conectar <loja>", `returnTo`) nos erros de credencial.
- Publicar item legado com `attributionVerified = false` → `409 STOREFRONT_OFFER_LINK_UNVERIFIED`
  (`SetStorefrontOfferStatusUseCase`); o selo "comissão não verificada" fica só para esses itens.
- Página pública e prévia só listam `PUBLISHED` **e** `attributionVerified = true` (`publicStorefrontOffers`); legado já publicado some sem mudar o status gravado.
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
| POST | `/delete` | `DeleteStorefrontUseCase` (corpo `{ password }`, 204; sem gate do plano) |

`GET /` devolve também `canDelete` (admin do tenant ou super admin): o painel só mostra a zona de perigo com `true`.

Admin de nomes especiais: `/api/admin/link-domains/:id/premium-grants` (super-admin), ver acima.

## Excluir a página

`POST /api/storefront/delete` com `{ "password": string }` (1–200) → `204`. É POST e não DELETE porque o corpo leva
segredo. Corpo exato: campo extra ou tipo errado → `400` (`assertExactDeleteStorefrontBody` no `preValidation`; o Ajv
do Fastify removeria o campo em silêncio). Limite de rota por tenant (`rateLimitPresets.lifecycle`).

Ordem do `DeleteStorefrontUseCase` (cada passo só roda se o anterior passou):

1. **Papel** (D2): `ADMIN` do tenant ou super admin (`canDeleteStorefront`). `OPERATOR` → `403 FORBIDDEN`.
2. **Página existe**: senão `404 STOREFRONT_NOT_FOUND`. Não exige `storefront_enabled`: vale com `PAUSED_BY_PLAN`.
3. **Senha do usuário logado** (D3), via `ConfirmUserPasswordUseCase` (módulo `auth`, ver
   [`seguranca-login.md`](seguranca-login.md)): super admin usa a própria. Errada → `401 INVALID_CREDENTIALS`
   (mesmo erro do login; o painel não trata esse código como token vencido). 5 erradas em 15 min → `429
   PASSWORD_CONFIRMATION_LOCKED` com `meta.retryAfterSeconds` e `meta.retryAt` (ISO; vira o header
   `Retry-After`), por 15 min. Cada POST conta uma tentativa.
4. **Transação** (`runInSlugTransaction`): **trava a linha da página** (`storefronts.lockForUpdate`, `SELECT …
   FOR UPDATE`), relê a página, coleta as imagens (ofertas + foto + capa), `slugs.releaseWithoutReservation`,
   `storefronts.delete` (ofertas e claim em cascade) e auditoria `STOREFRONT_DELETED` com
   `{ slug, domainId, offers, images, bySuperAdmin }` (`images` = **quantas** imagens o passo 5 deve remover;
   nunca nome de arquivo). Auditoria que falha desfaz tudo.
5. **Depois do commit**: `media.remove` de cada imagem, 10 por vez. Nunca lança; o resultado vira log
   estruturado `{ tenantId, images, failed }` (`info` com `failed: 0`, `warn` se alguma falhou), sem nome de arquivo.

**Corrida com criação de oferta e troca de foto/capa.** A trava do passo 4 vem antes de listar. Quem escreve na
página no meio espera o commit e falha por página inexistente, apagando a imagem que acabou de gravar:
`POST /offers` (o INSERT espera pela FK; `PrismaStorefrontOfferRepository.create` traduz `P2003` em
`STOREFRONT_NOT_FOUND` e o `ExtractStorefrontOfferUseCase` remove a imagem) e `PUT /images/:kind` (o `update`
não acha a linha e o use case já removia a imagem nova). Quem gravou antes da trava entra na lista da exclusão.
Não trocar a trava por checagem fora da transação nem listar antes dela (teste de integração da corrida em
`DeleteStorefrontUseCase.int.test.ts`).

**Risco aceito: imagem órfã.** O passo 5 é melhor esforço e fica fora da transação (storage não participa de
commit). Se o processo cair entre o commit e a remoção, ou o storage falhar, os arquivos ficam no storage sem
linha no banco. Não há job de limpeza nem fila para isso (decisão: volume baixo, arquivo pequeno, sem dado
pessoal além da arte da oferta). Rastro: a auditoria `STOREFRONT_DELETED` guarda `images` e o log guarda
`failed`; auditoria com `images > 0` sem log correspondente indica queda no meio. Não guardar nome de arquivo
na auditoria.

**Página pausada pelo plano chega à exclusão.** `GET /api/storefront` sem `storefront_enabled`: sem página
criada segue `403 PLAN_FEATURE_UNAVAILABLE`; **com** página devolve `200` com um resumo e `planLocked: true`
(campo ausente no caso normal): `storefront` com `status: 'PAUSED_BY_PLAN'` (sempre o efetivo, mesmo se a linha
ainda não foi atualizada pelo billing), `slug`/`domainId`, os demais campos da página e `offersCount` (total;
só vem aqui); `publicUrl`; `canDelete`; `offers.drafts/published`, `categories`, `subtitleSuggestions` e
`domains` **vazios**. Nada é editável: salvar, imagens, prévia e ofertas seguem `403`. O formato completo da
página foi mantido de propósito: o painel atual monta o formulário com `page.categories`/`page.title` e
quebraria com um objeto reduzido; com ele, a tela abre, mostra o aviso de pausada e a zona de perigo, e
qualquer edição cai no 403 que leva aos planos. Painel novo deve ler `planLocked` e mostrar só o resumo +
exclusão (usar `storefront.offersCount`, pois as listas vêm vazias). Decisão de produto ainda pendente sobre a
tela; a API já responde do jeito seguro.

Endereço (D1): livre **na hora** para qualquer tenant, sem a reserva de 30 dias (e uma reserva antiga do próprio
tenant para o mesmo nome é apagada junto). Nome especial continua protegido: o próximo dono passa pelo `guardWrite`
do `claim` e precisa de grant; o grant do tenant que excluiu não é revogado. Reservas de nomes **anteriores** da
página (trocas de nome) seguem até vencer. Depois de excluir, o tenant cria página nova pelo fluxo normal, se o
plano permitir. A página pública pode ficar até 60 s em cache (`max-age=60`).

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
- Não excluir a página por cascade direto (`storefronts.delete` solto, apagar tenant à parte): só pelo
  `DeleteStorefrontUseCase`, senão ficam imagens órfãs, sem auditoria e sem senha.
- Não logar, auditar, devolver nem persistir a senha da exclusão (nem em `usePersistedState`).
- Não reservar o endereço na exclusão da página (`release`): é `releaseWithoutReservation`. E não usar
  `releaseWithoutReservation` no rodízio nem na troca de nome.
- Não apagar imagem dentro da transação: storage só depois do commit.

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

- Exclusão: `GET /` exige `storefront_enabled`, então tenant com a página `PAUSED_BY_PLAN` não chega à zona de
  perigo pelo painel (a rota de exclusão aceita). Oferta criada no instante da exclusão pode deixar 1 imagem órfã
  (sem trava na página). Sem job de órfãos.

## Mapa de arquivos

| Camada | Caminho |
| --- | --- |
| Domínio | `storefront/domain/` (`entities/`, `enums/`, `services/storefrontRules.ts`, `storefrontCategories.ts`, `contracts/`) |
| Use cases | `storefront/application/use-cases/` |
| Infra | `storefront/infrastructure/` (`repositories/`, `mappers/`, `adapters/SharpStorefrontImageProcessor`, `StorefrontMediaStore`, `storefrontContainer`) |
| Rotas e template | `storefront/presentation/` (`routes/storefront.routes.ts`, `templates/renderStorefrontPage.ts`, `storefrontPageTemplate.ts`) |
| Namespace | `link-rotation/domain/services/decideSlugAvailability.ts`, `domain/contracts/IPublicSlugRegistry.ts`, `infrastructure/repositories/PrismaPublicSlugRegistry.ts` |
| Erros | `shared/errors/internal/StorefrontErrors.ts`, `LinkRotationErrors.ts`, `MediaErrors.ts`, `PlanErrors.ts` |
| Banco | `20261029030000_add_storefront_and_public_slug_claims`, `20261029040000_add_premium_slug_audit_actions`, `20261116100000_add_audit_action_storefront_deleted` |
| Painel | `app/src/features/storefront/`, `features/plans/` (`catalog.ts`, `PlansFeatureNotice`), `features/linkDomainsAdmin/` (`PremiumGrantsDialog`), `app/NavItemBadge.tsx` |
