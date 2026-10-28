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
`meta.key='broadcast_groups'`); 60 ≤ min ≤ max ≤ 3600 s (painel: 1–60 min inteiros; padrão 2–5 min). Config e destinos gravam numa transação. Os destinos usados no
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
2. Bootstrap: GET `/afiliados/linkbuilder` (redirect manual, até 3 saltos, Set-Cookie mesclado) → cookies temporários (`_csrf`, `_d2id`, `_mldataSessionId`). Redirect para login = `AFFILIATE_CREDENTIAL_REJECTED`. **Nunca** `/affiliate-program/link-builder`: responde 404 sem `_csrf` (incidente 2026-10-28)
3. Se tag não foi passada, resolve via GET `/affiliate-program/api/v2/stripe/user/tags` (campo `in_use`)
4. POST `/affiliate-program/api/v2/affiliates/createLink` com `{ urls, tag }`, headers `Origin`, `Referer: /afiliados/linkbuilder` e `X-Requested-With` → `{ urls: [{ short_url }] }`. Item sem `short_url` traz `error_code` (100 URL inválida, 1001 tipo, 1004 fechado, 1008 condição): vira `code: ML_<n>` no log
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

- `DRAFT → SENDING → SENT | FAILED`; envio `QUEUED → SENDING → SENT | FAILED | SKIPPED | CANCELLED`.
- **Reload / navegador fechado não interrompe**: a fila vive no banco e quem envia é o worker. O painel só assiste (polling de 3 s enquanto `SENDING`/`PAUSED`; id da oferta aberta persistido).
- **Pausar / retomar / parar** (`OfferSendControlUseCases.ts`, `POST /:id/pause|resume|cancel`): `SENDING ⇄ PAUSED`, `SENDING|PAUSED → CANCELLED` (final; reenviar = nova oferta). Pausar não mexe nos envios: `claimDue` ignora oferta que não está `SENDING`. Retomar reagenda os `QUEUED` a partir de agora com o intervalo da configuração atual, na mesma ordem (`rescheduleQueued`) — sem rajada pelo tempo parado. Parar cancela só os `QUEUED` (`cancelQueued`). Envio já `SENDING` no worker **sempre termina**; se era o último, `finalizeIfDone` fecha a oferta `PAUSED` como `SENT`/`FAILED`. Estado errado → 409 `OFFER_INVALID_STATE`; o painel recarrega a oferta em vez de mostrar erro. Parar pede confirmação com quantos grupos ficam de fora.
- **Início agendado** (`Offer.scheduledAt`, `domain/offerSchedule.ts`): escolhido no card de geração ou no card "Envio" do rascunho (`PATCH scheduledAt`, `null` remove). Futuro e até 30 dias (422 `scheduledAt`). No disparo, o 1º envio recebe `notBefore = scheduledAt` e os demais encadeiam o intervalo; vencido = começa agora. **Não há status `SCHEDULED`**: a oferta fica `SENDING` com fila futura — worker, pausar e parar funcionam sem caso especial; retomar antes do horário mantém o agendamento. O painel deriva "agendado" de `scheduledAt` futuro + nenhum envio concluído. Enquanto agendada, a oferta trava "+ Novo" (uma oferta ativa por vez): várias ofertas simultâneas dependem de fila por sessão encadeada (`arquitetura-escala.md` 3.6), senão duas ofertas intercalam no mesmo grupo.
- **Layout**: sem oferta = card de geração + estado vazio; com oferta = prévia (`OfferResultPanel`) e envio (`OfferSendPanel` no rascunho, `OfferDispatchProgress` depois) lado a lado. "+ Novo" reabre a geração sem descartar a oferta atual até outra ser gerada.
- Tick de 2 s, `claimDue` com `FOR UPDATE SKIP LOCKED` + `claimToken`; `touchClaim` antes de enviar; `releaseStale` só sem `chatMessageId`; timeout 60 s → `SEND_TIMEOUT`.
- **Marcar todos**: participantes via `getGroupParticipants`; `mentions` leva o `jid` de cada um **como o grupo o endereça** (`@lid` em grupo com privacidade de número — padrão no Baileys 7 —, senão `@s.whatsapp.net`). Menção por JID de telefone em grupo LID é ignorada pelo WhatsApp (bug até 0.34.0). Menção oculta: o texto não precisa de `@`.
- **Foto do grupo**: `avatarUrl` nos grupos da configuração e da busca vem de `chat_conversations.groupAvatarUrl` (alimentado pelo listener de avatar do chat); grupo sem conversa não tem foto → iniciais do nome (`groupInitials`, pula emoji inicial) ou ícone.
- **Várias sessões** (`OfferGeneratorConfigSession`, `dispatchOrder`): a configuração guarda as sessões que disparam, na ordem escolhida (entitlement `whatsapp_sessions` limita quantas; `sessionLimit` no `GET /config`). Cada grupo sai pela sessão a que pertence. Um envio por vez; o **mesmo intervalo** vale entre quaisquer dois envios consecutivos, dentro ou entre sessões. Ordem (`orderDispatchTargets`, regra pura): `SEQUENTIAL` = todos os grupos da 1ª sessão, depois a 2ª…; `INTERLEAVED` = um grupo de cada sessão por vez (quem acaba sai da rodada). Sessão desconectada bloqueia o disparo inteiro (envio parcial silencioso esconderia grupos sem oferta). `sessionId` na tabela é legado = 1ª sessão.
- **Passo Grupos**: busca em todas as sessões (uma chamada por sessão, em paralelo), filtro por sessão (chips), campo "Excluir" (palavras separadas por vírgula, sem acento/caixa, só no painel) e etiqueta "via <sessão>" em cada cartão quando há mais de uma. Passo Confirmar: `DispatchOrderPicker` (rádio com linha do tempo animada; decorativa, some sob `prefers-reduced-motion`).
- **Grupos disponíveis** (`GET /campaigns/offers/config/groups?sessionId&search`): vêm do WhatsApp via `IMessagingEngine.listParticipatingGroups` (todos os grupos de que a sessão participa, não só os com mensagem no chat), cruzados com as conversas existentes (`mergeSessionGroups`, regra pura; busca sem acento/caixa). Sessão fora do ar → `partial: true` e só os grupos que o chat conhece. Marcar grupo sem conversa chama `POST …/config/groups/ensure` (só grupo da sessão), que cria a conversa no formato da ingestão (`groupJid` sem `@g.us`); listar nunca cria. Conversa sem mensagem fica no fim da lista do chat (`lastMessageAt` nulls last). Cache de 60 s por sessão no adapter Baileys.
- **Termômetro do intervalo** (`utils/offerConfig.ts#intervalRisk`, só painel): score pela MÉDIA da pausa, curva em raiz, 0 em 1 min e 1 a partir de 10 min de média (`INTERVAL_SAFE_MEAN_SECONDS`); níveis <0,25 alto risco, <0,5 elevado, <0,75 moderado, senão seguro. Renderizado pelo `RangeSlider` (`status`): cor contínua vermelho→âmbar→verde na faixa e rótulo centralizado. Não é regra da API: é orientação de UX.
- **Espera até o próximo envio**: barra de energia (`CooldownBar`) no card "Envio". Janela = `notBefore` do envio anterior → `notBefore` do próximo QUEUED (`utils/dispatchCooldown.ts`), ou seja, o intervalo sorteado entre mínimo e máximo. Relógio do servidor via `X-Server-Time`; zerada mostra "Enviando…" até o polling trazer o novo estado.
- **Simular digitação** (`simulateTyping` + `typingSeconds`, padrão 15 s, 1–30): `ChatOfferMessageSender` manda `sendPresence('composing')` a cada 8 s (o WhatsApp apaga em ~10 s), espera o tempo escolhido, manda `paused` (sempre, mesmo em falha) e envia. O adapter Baileys sobe a conta para `available` no 1º `composing` e volta a `unavailable` no `paused`: o socket conecta com `markOnlineOnConnect: false` (celular segue notificando) e o WhatsApp não exibe o "digitando…" de conta offline — texto ou foto. Em grupo o adapter reenvia o chatstate com `from = me.lid` (`sendNode`): a lib só manda com o JID de telefone, que o grupo LID não exibe. Diagnóstico no log: `typing indicator start` (sender) e `Presence sent` (adapter; `name:false` = sem pushName, a lib ignora `available`). Melhor esforço: falha na presença envia na hora. O worker soma o tempo de digitação ao timeout de 60 s. Teto de 30 s em `campaigns/domain/offerTyping.ts` (o painel espelha em `utils/offerConfig.ts`). Não é entitlement de plano.
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
