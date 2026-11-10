# Gerador de ofertas

Fluxo (v2, 0.22.0): **configurar** (sessão → grupos → confirmar) → **colar o próprio link de afiliado** → cupom e
público-alvo → texto por IA → prévia, editar ou gerar novamente → marcar todos (opcional) → disparar nos grupos, espaçado.
Item 8 do roadmap. Specs: `.specs/features/offer-generator/` (v1) e `.specs/features/offer-generator-v2/spec.md` (Parte C).

## Onde está

| Camada | Caminho |
| --- | --- |
| Domínio (funções puras) | `api/src/modules/campaigns/domain/services/` (`detectMarketplace`, `parseProductRef`, `verifyAffiliateLink`, `parseProductPage`, `buildOfferTextPrompt`, `renderOfferText`, `scheduleDispatches`, `startOfDayInZone`) |
| Use cases | `campaigns/application/use-cases/` (Generate, Update, Regenerate, Send, ProcessDue, Config, Get, Usage) · `application/services/OfferTextComposer.ts` |
| HTTP externo | `campaigns/infrastructure/http/` (`ShopeeAffiliateClient`, `MercadoLivreAffiliateClient`, `SheinAffiliateClient`, `HttpShortLinkExpander`, `HttpProductPageReader`, `HttpOfferImageFetcher`) |
| IA | porta `IAiTextGenerator` via `LazyAiTextGenerator` → `docs/ia-provedores.md` |
| Envio | `ChatOfferMessageSender` → `SendStoredMediaMessageUseCase` (imagem, `imageMode = MEDIA`; WebP do ML sai como JPEG, ver `chat-midias-anexos.md` "Foto WebP") / `SendMessageUseCase` (texto, ou texto + prévia do link com `imageMode = LINK_PREVIEW`), com `mentions` |
| Worker | `campaigns/infrastructure/worker/OfferDispatchWorker.ts`, ligado em `app/server.ts` |
| Tabelas | `offers`, `offer_dispatches`, `offer_destinations`, `offer_generator_configs` |
| Painel | `app/src/features/offers/` (`components/config/` = assistente) · `app/src/pages/offers/OfferGeneratorPage.tsx` · `/offers` |

## Configuração

`GET/PUT /campaigns/offers/config` `{ sessionId, intervalMinSeconds, intervalMaxSeconds, conversationIds }`. Sessão do
tenant; só grupos dessa sessão; total **por canal** (canal do grupo = engine da sessão dele) ≤ `broadcast_groups`
(WhatsApp) / `telegram_broadcast_groups` (ausente = sem limite; `PLAN_LIMIT_REACHED` com `meta.key` do canal); 60 ≤ min ≤ max ≤ 3600 s (painel: 1–60 min inteiros; padrão 2–5 min). Config e destinos gravam numa transação. Os destinos usados no
envio são os grupos da configuração **no momento do envio**. O limite de grupos conta a **união** com os
monitoramentos (sessão + JID distintos; `usage` do GET idem); o envio só checa os próprios alvos.

**Horário** (api 0.61.0, passo "Horário" do assistente): `windowStartMinute`/`windowEndMinute`/`weekdays`
no PUT (ausente = mantém; padrão 0–1440, todos os dias). Sem `scheduledAt`, o disparo e a retomada encaixam
os envios na janela (`fitSlots`) e o claim não reivindica fora dela; `scheduledAt` explícito ignora a janela.
Ver [`grupos-de-disparo-e-horario.md`](grupos-de-disparo-e-horario.md).

## Link do usuário e verificação de dono

O link colado **é** o link de afiliado (o sistema não gera mais link). Após expandir (allowlist por salto):

| Loja | Prova | Regra |
| --- | --- | --- |
| Amazon | `tag=` | ≠ credencial → `OFFER_LINK_NOT_OWNED`; sem `tag` → `OFFER_LINK_NOT_AFFILIATE` |
| Mercado Livre | `matt_word` ou `/social/<etiqueta>` (`meli.la`) | idem (comparação sem caixa) |
| Shopee | — | sem verificação (aviso fixo no painel); `attributionVerified=false` |
| Shein | `url_from=affiliate_koc_<memberId>` | ≠ ID da conta conectada → `OFFER_LINK_NOT_OWNED`; sem afiliação e com conta → link gerado pela sessão (`attributionVerified=true`); sem afiliação e sem conta → `OFFER_LINK_NOT_AFFILIATE` |

Dados do produto (título, preços, foto) e foto no store: `ResolveProductDataUseCase` (api 0.41.0, extraído do
`GenerateOfferUseCase` para o monitoramento reaproveitar). Vitrine social ML (`/social/<etq>?…&ref=…`) é perfil,
não produto: `HttpProductPageReader` usa `parseMercadoLivreSocialPage` (1º `polycard`: `title.text`,
`price.current_price/previous_price.value`, `pictures[0].id` + `picture_template` → `D_NQ_NP_2X_<id>-F.webp`).

Sem credencial cadastrada da loja e com tag presente: passa como não verificado. Hosts aceitos
(`detectMarketplace.ts`, subdomínio entra por sufixo): `shopee.com.br`, `shope.ee`, `shp.ee` (`br.shp.ee`, encurtador
atual do app/painel Shopee BR), `shoope.top` (encurtador de **terceiro**, DivulgaLinks; não é da Shopee e só vale se o
redirect cair em `shopee.com.br` — encurtador de terceiro novo entra assim, com teste de redirect para fora), `mercadolivre.com.br`, `mercadolivre.com`, `mercadolibre.com`, `meli.la`,
`amazon.com.br`, `amzn.to`, `a.co` (Compartilhar do app Amazon), `link.amazon` (gTLD da Amazon, salta por `amzlinks.in`)
e `amzlinks.in`; encurtador só vale se o redirect cair em `amazon.com.br`. Shein: `br.shein.com`, `m.shein.com` (só `/br/`) e
`onelink.shein.com` (nunca `shein.com` inteiro); o `onelink` é lido por GET e o `input#url` do HTML vira a URL final sem
abrir a página do produto. `link.amazon` responde 404 ao HEAD: o expansor
repete com GET sempre que o HEAD vier ≥ 400.
Encurtadores que vão à rede (`isShortLink`): os mesmos curtos + `mercadolivre.com/sec|social` + `click1.mercadolivre.com.br`
(rastreio). Pesquisa de variantes 2026-11-02: `collshp.com` (coleção Shopee, vários itens), `invl.io` (rede Involve Asia),
`lista.`/`ofertas.mercadolivre` (busca/ofertas, ML proíbe afiliar), `amzn.eu` (Europa) ficam fora de propósito.
Link curto que cai em página sem produto (ex.: `s.shopee.com.br/…` → `shopee.com.br/m/cupom-de-desconto`) é
"não suportado" de propósito: não há item para afiliar. Host novo entra nos dois lugares + teste.

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

## Shein

Sem API oficial: link e dados vêm de uma chamada ao endpoint interno `detailNew` com a sessão sincronizada pela
extensão (`SheinAffiliateClient`). Gate na ordem plano (`marketplace_shein_enabled`, só MAX, checado antes de
expandir) → credencial → aceite do aviso de risco → chamada. Sem plano: `PLAN_FEATURE_UNAVAILABLE`; conta conectada
sem aceite: `MARKETPLACE_RISK_NOT_ACCEPTED`. A página de produto Shein **nunca** é lida (`HttpProductPageReader`
devolve `null`). Detalhes, riscos e o que não fazer: [`afiliado-shein.md`](afiliado-shein.md).

## Dados do produto

- Shopee: Affiliate Open API (`productOfferV2`) quando há credencial com secret; erro na API cai para a leitura da página.
- ML / Amazon: `HttpProductPageReader` — UA de navegador, 8 s, HTML cortado em 2 MB, só `text/html`, até 5 redirects
  revalidados; lê `og:*`, JSON-LD, `product:price:amount`, `andes-money-amount` (ML), `#productTitle`/`a-offscreen` (Amazon).
  ML é lido pela URL canônica (`canonicalMercadoLivreProductUrl`: `/p/MLB…` sem slug/query; `sourceUrl` não muda).
  Redirect para `/gz/account-verification`/captcha (`isMercadoLivreChallengeUrl`) = página ausente; título de
  verificação ("Segurança — Mercado Livre") é genérico em `isGenericSiteTitle`. Não fazer: gravar título dessa página,
  contornar a verificação, usar `api.mercadolibre.com` sem token (401/403).
- **Sessão da extensão (ML)**: se o tenant sincronizou a sessão pela extensão, a leitura vai com `Cookie: ssid=…` (só para
  `*.mercadolivre.com.br`; token validado contra injeção de cookie). Mesmo mecanismo das extensões do mercado: requisição
  logada é bloqueada bem menos. Rotas não documentadas do ML podem mudar sem aviso.
- Faltou título, preço ou foto → `needsManualData: true` e o painel pede os campos.
- Shein: título, preço, preço cheio e foto vêm do `detailNew` (mesma chamada do link). Sem conta conectada: preenchimento manual.
- Fotos: `*.susercontent.com`, `*.shopee.com.br`, `*.mlstatic.com`, `*.media-amazon.com`, `*.ssl-images-amazon.com`, `*.ltwebstatic.com` (Shein).
- Foto gravada (`MediaOfferStore.saveImage`, fetch/upload/foto do produto): JPEG lado ≤ 600 px, q75, sem metadados.

## Texto

`STANDARD` = modelo fixo (título, de/por, desconto, cupom, link). Outros públicos (`MOMS`, `PET`, `BEAUTY_FASHION`, `MEN`,
`FITNESS`, `HOME_KITCHEN`) → IA com prompt por público; dados do produto vão delimitados e o system manda ignorar
instruções vindas deles. Se a IA omitir o link, ele é anexado. Erro de IA, resposta vazia ou longa demais → modelo fixo e
`aiFallback: true`. `POST /:id/regenerate` gera outra versão (não conta no limite de ofertas; conta no da IA).
**Uma vez por oferta**: o uso fica em `offers.textRegeneratedAt` (null = disponível) e o DTO expõe `canRegenerate`;
a 2ª chamada é recusada com 409 `OFFER_REGENERATE_USED` antes da IA. O painel desabilita botão e público quando
`canRegenerate === false` (campo ausente = disponível). Depois do uso, só edição manual ou oferta nova.

## Rotas (`/api/campaigns/offers`, `authHook` + `tenantHook`)

| Método | Path | Faz |
| --- | --- | --- |
| POST | `/` | `{ url, coupon?, audience? }` → 201 `{ offer, needsManualData, aiFallback, aiErrorCode? }` |
| GET | `/usage` | `{ used, limit }` |
| GET / PUT | `/config` | configuração (acima) |
| GET | `/:id` | oferta + `dispatches` |
| PATCH | `/:id` | título, preços, texto, `imageUploadId`, `coupon`, `audience`, `mentionAll`. Só `DRAFT` |
| POST | `/:id/regenerate` | `{ audience? }` → `{ offer, aiFallback }`; 409 `OFFER_CHANGED` se a oferta foi editada durante a geração; 409 `OFFER_REGENERATE_USED` se o uso único já foi gasto |
| POST | `/:id/send` | 202; um envio por grupo, espaçado pelo intervalo da configuração |

Ordem de checagem do envio: oferta (409 `OFFER_CHANGED` se `mentionAll` mudou durante a checagem) → `PLAN_FEATURE_UNAVAILABLE` (marcar todos sem `mention_all_enabled`) →
`OFFER_CONFIG_MISSING` → `SESSION_NOT_CONNECTED` → `OFFER_NO_DESTINATIONS` → `PLAN_LIMIT_REACHED` (plano rebaixado).

## Limite diário

Entitlement `offer_generations_per_day`: LITE 5, PRO 20, MAX ilimitado (decisão 2026-11-04; fora da vitrine).
`null` ou ausente = ilimitado. Dia de `America/Sao_Paulo`, recontagem sob `pg_advisory_xact_lock` na gravação.

- MAX grava **JSON null explícito** (`planPresets.ts` → `entitlementJsonValue` → `Prisma.JsonNull`): o sync de plano só
  faz upsert das chaves do preset, então chave omitida deixaria o upgrade PRO→MAX com o `20` antigo.
- Não usar fallback `'false'` na escrita do entitlement: apagaria o ilimitado.

## Envio (worker)

- `DRAFT → SENDING → SENT | FAILED`; envio `QUEUED → SENDING → SENT | FAILED | SKIPPED | CANCELLED`.
- **Reload / navegador fechado não interrompe**: a fila vive no banco e quem envia é o worker. O painel só assiste (polling de 3 s enquanto `SENDING`/`PAUSED`; id da oferta aberta persistido).
- **Pausar / retomar / parar** (`OfferSendControlUseCases.ts`, `POST /:id/pause|resume|cancel`): `SENDING ⇄ PAUSED`, `SENDING|PAUSED → CANCELLED` (final; reenviar = nova oferta). Pausar não mexe nos envios: `claimDue` ignora oferta que não está `SENDING`. Retomar reagenda os `QUEUED` a partir de agora com o intervalo da configuração atual, na mesma ordem (`rescheduleQueued`) — sem rajada pelo tempo parado. Parar cancela só os `QUEUED` (`cancelQueued`). Envio já `SENDING` no worker **sempre termina**; se era o último, `finalizeIfDone` fecha a oferta `PAUSED` como `SENT`/`FAILED`. Estado errado → 409 `OFFER_INVALID_STATE`; o painel recarrega a oferta em vez de mostrar erro. Parar pede confirmação com quantos grupos ficam de fora.
- **Início agendado** (`Offer.scheduledAt`, `domain/offerSchedule.ts`): escolhido no card de geração ou no card "Envio" do rascunho (`PATCH scheduledAt`, `null` remove). Futuro e até 30 dias (422 `scheduledAt`). No disparo, o 1º envio recebe `notBefore = scheduledAt` e os demais encadeiam o intervalo; vencido = começa agora. **Não há status `SCHEDULED`**: a oferta fica `SENDING` com fila futura — worker, pausar e parar funcionam sem caso especial; retomar antes do horário mantém o agendamento. O painel deriva "agendado" de `scheduledAt` futuro + nenhum envio concluído. Enquanto agendada, a oferta trava "+ Novo" (uma oferta ativa por vez): várias ofertas simultâneas dependem de fila por sessão encadeada (`arquitetura-escala.md` 3.6), senão duas ofertas intercalam no mesmo grupo.
- **Layout**: sem oferta = card de geração + estado vazio; com oferta = prévia (`OfferResultPanel`) e envio (`OfferSendPanel` no rascunho, `OfferDispatchProgress` depois) lado a lado. "+ Novo" reabre a geração sem descartar a oferta atual até outra ser gerada.
- Tick de 2 s, `claimDue` com `FOR UPDATE SKIP LOCKED` + `claimToken`; `touchClaim` antes de enviar; `releaseStale` só sem `chatMessageId`; timeout 60 s → `SEND_TIMEOUT`.
- **Marcar todos**: participantes via `getGroupParticipants`; `mentions` leva o `jid` de cada um **como o grupo o endereça** (`@lid` em grupo com privacidade de número — padrão no Baileys 7 —, senão `@s.whatsapp.net`). Menção por JID de telefone em grupo LID é ignorada pelo WhatsApp (bug até 0.34.0). Menção oculta: o texto não precisa de `@`.
- **Marcar todos travado pelo plano** (api 0.71.1 / app 0.88.1): `GET /config` devolve `mentionAllEnabled` (entitlement `mention_all_enabled`; só `false` explícito trava; API antiga sem o campo = liberado). Sem o recurso (LITE), o card "Envio" mostra a chave desligada e desabilitada, cadeado + `mentionAllUnavailable`, tooltip `mentionAllLocked` e link "Ver planos" (`AFFILIATE_PLANS_PATH`) — mesmo padrão do monitoramento. Oferta com `mentionAll: true` de antes (downgrade) aparece desligada e o envio manda `mentionAll: false` no PATCH que precede o `send`, sem falhar. O 403 `PLAN_FEATURE_UNAVAILABLE` no envio continua travando a chave (rede de segurança). Não: deixar a chave ligável e só avisar depois do erro.
- **Foto do grupo**: `avatarUrl` nos grupos da configuração e da busca vem de `chat_conversations.groupAvatarUrl` (alimentado pelo listener de avatar do chat); grupo sem conversa não tem foto → iniciais do nome (`groupInitials`, pula emoji inicial) ou ícone.
- **Várias sessões** (`OfferGeneratorConfigSession`, `dispatchOrder`): a configuração guarda as sessões que disparam, na ordem escolhida (limite **por canal**: `whatsapp_sessions` / `telegram_sessions`; `PLAN_LIMIT_REACHED` com a key do canal).
`GET /config` devolve `limits.{whatsapp,telegram}.{sessions,broadcastGroups}` e `usage.{whatsapp,telegram}.{sessions,broadcastGroups}`
(uso da config salva); `sessionLimit`/`groupLimit` = WhatsApp (legado). Cada grupo sai pela sessão a que pertence. Um envio por vez; o **mesmo intervalo** vale entre quaisquer dois envios consecutivos, dentro ou entre sessões. Ordem (`orderDispatchTargets`, regra pura): `SEQUENTIAL` = todos os grupos da 1ª sessão, depois a 2ª…; `INTERLEAVED` = um grupo de cada sessão por vez (quem acaba sai da rodada). Sessão desconectada bloqueia o disparo inteiro (envio parcial silencioso esconderia grupos sem oferta). `sessionId` na tabela é legado = 1ª sessão. **2+ sessões do mesmo canal exigem `cross_session_dispatch`** (api 0.42.0; por canal desde os limites por canal): salvar sem a feature é 403 `PLAN_FEATURE_UNAVAILABLE` (`crossSessionDispatch` no `GET /config`; o assistente bloqueia o passo com aviso e link `/plans`); WhatsApp + Telegram juntos sempre podem; plano rebaixado depois de salvar → só a 1ª sessão de cada canal dispara. Grupos acima do limite do canal no envio → `PLAN_LIMIT_REACHED`.
- **Passo Grupos**: busca em todas as sessões (uma chamada por sessão, em paralelo), filtro por sessão (chips), campo "Excluir" (palavras separadas por vírgula, sem acento/caixa, só no painel) e etiqueta "via <sessão>" em cada cartão quando há mais de uma. Passo Confirmar: `DispatchOrderPicker` (rádio com linha do tempo animada; decorativa, some sob `prefers-reduced-motion`). O Confirmar também resume o horário de postagem (faixa e dias) com `postingWindowSummary` (`app/src/components/`), o mesmo texto da pílula do `PostingWindowField`; não duplicar a formatação. O catálogo de grupos de disparo (`useBroadcastGroups`) é buscado só no `OfferConfigWizard` e chega ao `ConfigGroupsStep` pela prop `catalog` (null = conta só a seleção); o passo não chama o hook.
- **Grupos disponíveis** (`GET /campaigns/offers/config/groups?sessionId&search`): vêm do WhatsApp via `IMessagingEngine.listParticipatingGroups` (todos os grupos de que a sessão participa, não só os com mensagem no chat), cruzados com as conversas existentes (`mergeSessionGroups`, regra pura; busca sem acento/caixa). Sessão fora do ar → `partial: true` e só os grupos que o chat conhece. Marcar grupo sem conversa chama `POST …/config/groups/ensure` (só grupo da sessão), que cria a conversa no formato da ingestão (`groupJid` sem `@g.us`); listar nunca cria. Conversa sem mensagem fica no fim da lista do chat (`lastMessageAt` nulls last). Cache de 60 s por sessão no adapter Baileys. Cada grupo traz `canPost` + `postBlockedReason` (`ADMINS_ONLY` = WhatsApp `announce`/Telegram envio banido sem a sessão ser admin; `CHANNEL_READONLY` = canal do Telegram): o passo de grupos o esconde (switch "ocultar") e o `ensure` (sempre `purpose: 'send'`) o recusa com 422 `GROUP_NOT_POSTABLE`. `GET /config` anota `groups[]` com `canPost: boolean | null`/`postBlockedReason` pela lista ao vivo (`loadLiveGroups` + `postabilityOf`; sessão fora → null).
- **Termômetro do intervalo** (`utils/offerConfig.ts#intervalRisk`, só painel): score pela MÉDIA da pausa, curva em raiz, 0 em 1 min e 1 a partir de 10 min de média (`INTERVAL_SAFE_MEAN_SECONDS`); níveis <0,25 alto risco, <0,5 elevado, <0,75 moderado, senão seguro. Renderizado pelo `RangeSlider` (`status`): cor contínua vermelho→âmbar→verde na faixa e rótulo centralizado. Não é regra da API: é orientação de UX.
- **Espera até o próximo envio**: barra de energia (`CooldownBar`) no card "Envio". Janela = `notBefore` do envio anterior → `notBefore` do próximo QUEUED (`utils/dispatchCooldown.ts`), ou seja, o intervalo sorteado entre mínimo e máximo. Relógio do servidor via `X-Server-Time`; zerada mostra "Enviando…" até o polling trazer o novo estado.
- **Simular digitação** (`simulateTyping` + `typingSeconds`, padrão 15 s, 1–30): `ChatOfferMessageSender` manda `sendPresence('composing')` a cada 8 s (o WhatsApp apaga em ~10 s), espera o tempo escolhido, manda `paused` (sempre, mesmo em falha) e envia. O adapter Baileys sobe a conta para `available` no 1º `composing` e volta a `unavailable` no `paused`: o socket conecta com `markOnlineOnConnect: false` (celular segue notificando) e o WhatsApp não exibe o "digitando…" de conta offline — texto ou foto. Em grupo o adapter reenvia o chatstate com `from = me.lid` (`sendNode`): a lib só manda com o JID de telefone, que o grupo LID não exibe. Diagnóstico no log: `typing indicator start` (sender) e `Presence sent` (adapter; `name:false` = sem pushName, a lib ignora `available`). Melhor esforço: falha na presença envia na hora. O worker soma o tempo de digitação ao timeout de 60 s. Teto de 30 s em `campaigns/domain/offerTyping.ts` (o painel espelha em `utils/offerConfig.ts`). Não é entitlement de plano.
- **Formato da imagem** (`Offer.imageMode`, PATCH como `mentionAll`): `MEDIA` (padrão, imagem com legenda) ou
  `LINK_PREVIEW` (texto + cartão de prévia montado com a foto armazenada, sem anexo). Painel: `ImageModePicker` no
  card "Envio" do rascunho (`OfferSendPanel`). Regras, tamanhos e fallback: `docs/mensagens-previa-de-link.md`.
- **Telegram como destino**: `groupJid` do Telegram é o peer id negativo (`-<id>` / `-100<id>`), aceito por
  `GROUP_JID_PATTERN` (`offer.schema.ts`) junto do formato do WhatsApp; a conversa nasce com `channel = telegram`.
  Texto/legenda saem em HTML do Telegram (convertido do formato WhatsApp no adapter), `LINK_PREVIEW` vira prévia
  nativa, "Marcar todos" não marca. `TELEGRAM_FLOOD_WAIT` no envio de texto reagenda o envio (`notBefore =
  agora + seconds + 1 s`, mesma vez da sessão) em vez de falhar; espera ≥ 6 h → `FAILED`. Detalhes:
  `sessoes-telegram.md` §5.
- Flag **`OFFER_DISPATCH_WORKER_ENABLED`** (padrão `false`; ligar só na Render — `api/.env` e `.env.dev` apontam para o banco real).
- Flag **`OFFER_WORKER_INDEPENDENT_STAGES_ENABLED`** (padrão `false` = tick sequencial envio → capturas). `true`:
  envio e capturas do monitoramento em slots independentes no mesmo timer de 2 s (envio preso não segura captura);
  `stop()` usa o orçamento restante do shutdown sem invadir a reserva de sockets/flush. Composição pura em
  `api/src/app/offerWorkerComposition.ts`; `http` nunca roda. Ligar só na Render, após o gate de produção da entrega A
  (`.specs/features/monitoring-queue-isolation/validation.md`); rollback = `false` + restart.

### Limites conhecidos

- At-least-once: queda entre envio e `markResult` pode repetir o envio após 5 min.
- Falha assíncrona da fila de mídia após enfileirar deixa o envio `SENT`.
- Retry/recuperação de mídia pendente reenvia sem menções.
- `FLOOD_WAIT` do Telegram na fila de mídia (oferta `MEDIA` com foto) não reagenda: a mensagem fica `FAILED`.
- Parser de página não validado contra HTML real de ML/Amazon em produção: conferir no smoke.

## O que não fazer

- Não liberar "Gerar novamente" de novo na mesma oferta (nem zerar `textRegeneratedAt` em edição): é uso único.

- Buscar URL fora da allowlist ou seguir redirect automático.
- Logar corpo, headers, cookie `ssid`, assinatura ou segredo.
- Gerar link de afiliado sem sessão válida da extensão (a geração automática exige sessão do ML sincronizada).
- Ligar o worker com banco de produção fora da Render.
- Enviar sem passar por `OfferDispatch` com `notBefore`.
- Buscar a página/og:image do produto para montar prévia de link (ver `mensagens-previa-de-link.md`).

## Deploy

1. `prisma migrate deploy` (`20261026160000_create_offers_and_dispatches`, `20261026210000_add_session_phone_ai_providers_offer_config`).
2. Render: `OFFER_DISPATCH_WORKER_ENABLED=true`; `CREDENTIALS_ENCRYPTION_KEY` já existente cifra as chaves de IA.
3. Super admin cadastra um provedor de IA em `/admin/ai`.
4. Smoke: configurar sessão + 2 grupos; colar link próprio de cada loja (inclusive `meli.la`); público com IA; gerar novamente; marcar todos; disparar.
