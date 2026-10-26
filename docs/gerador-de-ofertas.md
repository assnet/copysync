# Gerador de ofertas

Cola o link do produto → oferta montada com o link de afiliado do tenant → revisar → enviar aos
destinos pré-selecionados, espaçado. Item 8 do roadmap. Spec, design e tasks em
`.specs/features/offer-generator/`.

## Onde está

| Camada | Caminho |
| --- | --- |
| Domínio (funções puras) | `api/src/modules/campaigns/domain/services/` (`detectMarketplace`, `parseProductRef`, `buildAffiliateUrl`, `renderOfferText`, `scheduleDispatches`, `startOfDayInZone`) |
| Use cases | `api/src/modules/campaigns/application/use-cases/` |
| HTTP externo | `campaigns/infrastructure/http/` (`ShopeeAffiliateClient`, `HttpShortLinkExpander`, `HttpOfferImageFetcher`) |
| Envio | `campaigns/infrastructure/adapters/ChatOfferMessageSender.ts` → `chat/.../SendStoredMediaMessageUseCase.ts` (imagem) ou `SendMessageUseCase` (texto) |
| Worker | `campaigns/infrastructure/worker/OfferDispatchWorker.ts`, ligado em `app/server.ts` |
| Composição | `campaigns/infrastructure/offersContainer.ts` |
| Tabelas | `offers`, `offer_dispatches`, `offer_destinations` · migration `20261026160000_create_offers_and_dispatches` |
| Painel | `app/src/features/offers/` · `app/src/pages/offers/OfferGeneratorPage.tsx` · rota `/offers` |

## Marketplaces

| Marketplace | Link | Dados do produto |
| --- | --- | --- |
| Shopee | `generateShortLink` na Affiliate Open API (`open-api.affiliate.shopee.com.br/graphql`, header `SHA256 Credential=…, Timestamp=…, Signature=sha256(appId+ts+body+secret)`) | `productOfferV2(shopId,itemId)`: título, foto, preço, desconto |
| Amazon | `https://www.amazon.com.br/dp/{ASIN}?tag={id}` | operador preenche |
| Mercado Livre | URL canônica + `?matt_word={etiqueta}` (**atribuição não confirmada**; o painel avisa) | operador preenche |

- A Shopee exige acesso liberado à Open API no painel do afiliado (erro `10035` → `AFFILIATE_API_ACCESS_DENIED`). Suporte: webform citado no `AGENTS.md`.
- **Não verificado** contra conta real: campos de `productOfferV2`, formato de preço (decimal em BRL) e `priceDiscountRate` (percentual), códigos `10031–10034`. O mapper tolera campo ausente. Conferir no primeiro smoke com AppID real.
- ML e Amazon bloqueiam scraping de IP de datacenter (403/500/captcha), e a PA-API 5 foi descontinuada (Creators API exige 10 vendas em 30 dias). Dados automáticos desses dois ficam para P3 (extensão lendo o DOM).

## Segurança do link colado (SSRF)

- Só `https`, sem porta, userinfo ou IP literal; host exato ou subdomínio da allowlist (`detectMarketplace`).
- Link curto (`s.shopee.com.br`, `shope.ee`, `amzn.to`, `mercadolivre.com/sec|social`) é seguido com `redirect: 'manual'`, até 5 saltos, 8 s no total, **revalidando cada `Location` antes de requisitar**.
- Foto: só `*.susercontent.com` / `*.shopee.com.br`, `image/*`, ≤ 5 MB, `redirect: 'error'`.

## Rotas

Prefixo `/api/campaigns/offers`, `authHook` + `tenantHook`, envelope `{ success, data }`.

| Método | Path | Faz |
| --- | --- | --- |
| POST | `/` | `{ url }` → 201 `{ offer, needsManualData }` |
| GET | `/usage` | `{ used, limit }` (`limit: null` = ilimitado) |
| GET / PUT | `/destinations` | lista / substitui `{ conversationIds }` (máx. 200, só conversas do tenant) |
| GET | `/:id` | oferta com `dispatches` |
| PATCH | `/:id` | título, preços (centavos), texto, `imageUploadId` (upload por `chunkedUpload`). Só `DRAFT` |
| POST | `/:id/send` | 202; cria um envio por destino com `notBefore` espaçado (8–15 s aleatório) |

`GET /chat/conversations` aceita `isGroup=true|false` (seletor de destinos).

Erros: `OFFER_URL_UNSUPPORTED` 422 · `OFFER_PRODUCT_NOT_FOUND` 404 · `OFFER_NOT_FOUND` 404 · `OFFER_ALREADY_SENT` 409 ·
`OFFER_NO_DESTINATIONS` 422 · `OFFER_INVALID_INPUT` 422 (`meta.field`) · `AFFILIATE_CREDENTIAL_NOT_FOUND` 404 ·
`AFFILIATE_API_ACCESS_DENIED` / `AFFILIATE_CREDENTIAL_REJECTED` 422 · `AFFILIATE_API_RATE_LIMITED` 429 ·
`AFFILIATE_API_UNAVAILABLE` 503 (nada gravado, não conta no limite) · `PLAN_LIMIT_REACHED` 403 (`meta { key, limit }`).

## Limite diário

Entitlement `offer_generations_per_day` em `TenantEntitlement` (lido por `PrismaEntitlementReader`). Ausente ou
`null` = ilimitado. Conta as `Offer` criadas desde a meia-noite de `America/Sao_Paulo`. A gravação reconta sob
`pg_advisory_xact_lock(hashtext(tenantId))` (`createWithinDailyLimit`), então requisições paralelas não passam do limite.

## Envio (worker)

- Estados: `Offer` `DRAFT → SENDING → SENT | FAILED`; `OfferDispatch` `QUEUED → SENDING → SENT | FAILED | SKIPPED`.
- `SendOfferUseCase` troca `DRAFT → SENDING` e cria os envios na **mesma transação**.
- Worker a cada 2 s: `claimDue` (`FOR UPDATE SKIP LOCKED`, `claimToken` por linha) → um envio por vez, `touchClaim` antes de enviar →
  `markResult` exige o token. `releaseStale` devolve à fila o que ficou `SENDING` há > 5 min **sem `chatMessageId`**.
  Timeout de 60 s por envio → `FAILED SEND_TIMEOUT`, sem retry. Varredura fecha ofertas `SENDING` sem envio aberto.
- `SKIPPED`: conversa/sessão inexistente (`OFFER_DESTINATION_UNAVAILABLE`, `NOT_FOUND`, `SESSION_NOT_FOUND`). `FAILED`: o resto, com código interno.
- Cada destino recebe a própria cópia da foto (`acquireLocalFile` → cópia em tmp → `promote`); a foto da oferta nunca é movida.
- Flag **`OFFER_DISPATCH_WORKER_ENABLED`** (padrão `false`). Ligar **só na Render** (variável criada à mão no dashboard). `api/.env` e `api/.env.dev`
  apontam para o banco real: `true` local enviaria ofertas de produção.
- Futuro: fila BullMQ `broadcast.post` (`arquitetura-escala.md` §3.6) substitui o tick sem mudar os use cases.

### Limites conhecidos

- **At-least-once**: queda entre o envio e o `markResult` deixa o envio `SENDING` sem `chatMessageId`; depois de 5 min ele pode sair de novo.
- Falha **assíncrona** da fila de mídia do chat depois de enfileirar deixa o envio `SENT` (a bolha no chat mostra `FAILED`). Reconciliar por `chatMessageId` fica para depois.

## O que não fazer

- Não buscar URL que não passou por `isSupportedProductUrl`, nem seguir redirect automático.
- Não logar corpo, header, assinatura ou segredo da Shopee; `meta` de erro só leva `provider`.
- Não devolver credencial no `OfferDTO` (schema de resposta é fechado).
- Não ligar o worker com banco de produção fora da Render.
- Não enviar em rajada: todo envio passa por `OfferDispatch` com `notBefore`.

## Deploy

1. `prisma migrate deploy` (migration nova, só cria tabelas/enums).
2. Render: `OFFER_DISPATCH_WORKER_ENABLED=true`.
3. Smoke: gerar oferta Shopee com AppID real, conferir campos; dois grupos de teste como destino; enviar e ver ~8–15 s entre as mensagens.
