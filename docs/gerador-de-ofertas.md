# Gerador de ofertas

Fluxo (v2, 0.22.0): **configurar** (sessão → grupos → confirmar) → **colar o próprio link de afiliado** → cupom e
público-alvo → texto por IA → prévia, editar ou gerar novamente → marcar todos (opcional) → disparar nos grupos, espaçado.
Item 8 do roadmap. Specs: `.specs/features/offer-generator/` (v1) e `.specs/features/offer-generator-v2/spec.md` (Parte C).

## Onde está

| Camada | Caminho |
| --- | --- |
| Domínio (funções puras) | `api/src/modules/campaigns/domain/services/` (`detectMarketplace`, `parseProductRef`, `verifyAffiliateLink`, `parseProductPage`, `buildOfferTextPrompt`, `renderOfferText`, `scheduleDispatches`, `startOfDayInZone`) |
| Use cases | `campaigns/application/use-cases/` (Generate, Update, Regenerate, Send, ProcessDue, Config, Get, Usage) · `application/services/OfferTextComposer.ts` |
| HTTP externo | `campaigns/infrastructure/http/` (`ShopeeAffiliateClient`, `HttpShortLinkExpander`, `HttpProductPageReader`, `HttpOfferImageFetcher`) |
| IA | porta `IAiTextGenerator` via `LazyAiTextGenerator` → `docs/ia-provedores.md` |
| Envio | `ChatOfferMessageSender` → `SendStoredMediaMessageUseCase` (imagem) / `SendMessageUseCase` (texto), com `mentions` |
| Worker | `campaigns/infrastructure/worker/OfferDispatchWorker.ts`, ligado em `app/server.ts` |
| Tabelas | `offers`, `offer_dispatches`, `offer_destinations`, `offer_generator_configs` |
| Painel | `app/src/features/offers/` (`components/config/` = assistente) · `app/src/pages/offers/OfferGeneratorPage.tsx` · `/offers` |

## Configuração

`GET/PUT /campaigns/offers/config` `{ sessionId, intervalMinSeconds, intervalMaxSeconds, conversationIds }`. Sessão do
tenant; só grupos dessa sessão; total ≤ entitlement `broadcast_groups` (ausente = sem limite; `PLAN_LIMIT_REACHED` com
`meta.key='broadcast_groups'`); 5 ≤ min ≤ max ≤ 120 s. Config e destinos gravam numa transação. Os destinos usados no
envio são os grupos da configuração **no momento do envio**.

## Link do usuário e verificação de dono

O link colado **é** o link de afiliado (o sistema não gera mais link). Após expandir (allowlist por salto):

| Loja | Prova | Regra |
| --- | --- | --- |
| Amazon | `tag=` | ≠ credencial → `OFFER_LINK_NOT_OWNED`; sem `tag` → `OFFER_LINK_NOT_AFFILIATE` |
| Mercado Livre | `matt_word` ou `/social/<etiqueta>` (`meli.la`) | idem (comparação sem caixa) |
| Shopee | — | sem verificação (aviso fixo no painel); `attributionVerified=false` |

Sem credencial cadastrada da loja e com tag presente: passa como não verificado. Hosts aceitos: `shopee.com.br`,
`shope.ee`, `mercadolivre.com.br`, `mercadolivre.com`, `mercadolibre.com`, `meli.la`, `amazon.com.br`, `amzn.to`.

## Geração automática de link ML (F4)

Quando o link colado é um produto ML **sem** `matt_word` ou `/social/` e o tenant tem sessão da extensão sincronizada:

1. `MercadoLivreAffiliateClient.createAffiliateLinks(cookies, [url], etiqueta)` chama a API interna do programa de afiliados
2. Bootstrap: GET `/affiliate-program/link-builder` → cookies temporários (`_csrf`, `_d2id`, `_mldataSessionId`)
3. Se tag não foi passada, resolve via GET `/affiliate-program/api/v2/stripe/user/tags` (campo `in_use`)
4. POST `/affiliate-program/api/v2/affiliates/createLink` com `{ urls, tag }` → `{ urls: [{ short_url }] }`
5. `short_url` vira o `affiliateUrl` da oferta, com `attributionVerified: true`

Degradação graciosa: API indisponível, sessão expirada ou rate limit → `OFFER_LINK_NOT_AFFILIATE` como antes. O tenant
pode sempre colar seu próprio link de afiliado — a geração automática é fallback, não obrigação.

Rotas não documentadas do ML podem mudar sem aviso. Nunca logar cookies, body ou headers.

## Dados do produto

- Shopee: Affiliate Open API (`productOfferV2`) quando há credencial com secret; erro na API cai para a leitura da página.
- ML / Amazon: `HttpProductPageReader` — UA de navegador, 8 s, HTML cortado em 2 MB, só `text/html`, até 5 redirects
  revalidados; lê `og:*`, JSON-LD, `product:price:amount`, `andes-money-amount` (ML), `#productTitle`/`a-offscreen` (Amazon).
- **Sessão da extensão (ML)**: se o tenant sincronizou a sessão pela extensão, a leitura vai com `Cookie: ssid=…` (só para
  `*.mercadolivre.com.br`; token validado contra injeção de cookie). Mesmo mecanismo das extensões do mercado: requisição
  logada é bloqueada bem menos. Rotas não documentadas do ML podem mudar sem aviso.
- Faltou título, preço ou foto → `needsManualData: true` e o painel pede os campos.
- Fotos: `*.susercontent.com`, `*.shopee.com.br`, `*.mlstatic.com`, `*.media-amazon.com`, `*.ssl-images-amazon.com`.

## Texto

`STANDARD` = modelo fixo (título, de/por, desconto, cupom, link). Outros públicos (`MOMS`, `PET`, `BEAUTY_FASHION`, `MEN`,
`FITNESS`, `HOME_KITCHEN`) → IA com prompt por público; dados do produto vão delimitados e o system manda ignorar
instruções vindas deles. Se a IA omitir o link, ele é anexado. Erro de IA, resposta vazia ou longa demais → modelo fixo e
`aiFallback: true`. `POST /:id/regenerate` gera outra versão (não conta no limite de ofertas; conta no da IA).

## Rotas (`/api/campaigns/offers`, `authHook` + `tenantHook`)

| Método | Path | Faz |
| --- | --- | --- |
| POST | `/` | `{ url, coupon?, audience? }` → 201 `{ offer, needsManualData, aiFallback, aiErrorCode? }` |
| GET | `/usage` | `{ used, limit }` |
| GET / PUT | `/config` | configuração (acima) |
| GET | `/:id` | oferta + `dispatches` |
| PATCH | `/:id` | título, preços, texto, `imageUploadId`, `coupon`, `audience`, `mentionAll`. Só `DRAFT` |
| POST | `/:id/regenerate` | `{ audience? }` → `{ offer, aiFallback }`; 409 `OFFER_CHANGED` se a oferta foi editada durante a geração |
| POST | `/:id/send` | 202; um envio por grupo, espaçado pelo intervalo da configuração |

Ordem de checagem do envio: oferta (409 `OFFER_CHANGED` se `mentionAll` mudou durante a checagem) → `PLAN_FEATURE_UNAVAILABLE` (marcar todos sem `mention_all_enabled`) →
`OFFER_CONFIG_MISSING` → `SESSION_NOT_CONNECTED` → `OFFER_NO_DESTINATIONS` → `PLAN_LIMIT_REACHED` (plano rebaixado).

## Limite diário

Entitlement `offer_generations_per_day` (ausente = ilimitado), dia de `America/Sao_Paulo`, recontagem sob
`pg_advisory_xact_lock` na gravação.

## Envio (worker)

- `DRAFT → SENDING → SENT | FAILED`; envio `QUEUED → SENDING → SENT | FAILED | SKIPPED`.
- Tick de 2 s, `claimDue` com `FOR UPDATE SKIP LOCKED` + `claimToken`; `touchClaim` antes de enviar; `releaseStale` só sem `chatMessageId`; timeout 60 s → `SEND_TIMEOUT`.
- **Marcar todos**: participantes via `getGroupParticipants`; JIDs em `mentions` (menção oculta). Participante só com LID (sem telefone) não é mencionado.
- Flag **`OFFER_DISPATCH_WORKER_ENABLED`** (padrão `false`; ligar só na Render — `api/.env` e `.env.dev` apontam para o banco real).

### Limites conhecidos

- At-least-once: queda entre envio e `markResult` pode repetir o envio após 5 min.
- Falha assíncrona da fila de mídia após enfileirar deixa o envio `SENT`.
- Retry/recuperação de mídia pendente reenvia sem menções.
- Parser de página não validado contra HTML real de ML/Amazon em produção: conferir no smoke.

## O que não fazer

- Buscar URL fora da allowlist ou seguir redirect automático.
- Logar corpo, headers, cookie `ssid`, assinatura ou segredo.
- Gerar link de afiliado sem sessão válida da extensão (a geração automática exige sessão do ML sincronizada).
- Ligar o worker com banco de produção fora da Render.
- Enviar sem passar por `OfferDispatch` com `notBefore`.

## Deploy

1. `prisma migrate deploy` (`20261026160000_create_offers_and_dispatches`, `20261026210000_add_session_phone_ai_providers_offer_config`).
2. Render: `OFFER_DISPATCH_WORKER_ENABLED=true`; `CREDENTIALS_ENCRYPTION_KEY` já existente cifra as chaves de IA.
3. Super admin cadastra um provedor de IA em `/admin/ai`.
4. Smoke: configurar sessão + 2 grupos; colar link próprio de cada loja (inclusive `meli.la`); público com IA; gerar novamente; marcar todos; disparar.
