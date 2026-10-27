# Monitoramento de grupos (`group-monitoring`)

Item 4 do [`produto-roadmap.md`](produto-roadmap.md). Depende da **fila de envio por sessão**
([`fila-de-envio.md`](fila-de-envio.md), implementada): a captura enfileira como o
`SendOfferUseCase` (`scheduleDispatches` → `laneTails` → `appendToLanes` → `startSending` com
`sessionId` e `gapSeconds`), e o claim garante a série por sessão. `Offer.origin`/`expiresAt` e o
`SKIPPED/OFFER_EXPIRED` no worker **já existem**. Escuta grupos de concorrentes, captura a oferta,
troca o link pelo link de afiliado **do tenant** e reposta nos grupos do tenant, respeitando
horário de operação, intervalo entre envios e validade da oferta.

Status: **plano (2026-10-27). Nada implementado ainda.** Tudo abaixo descreve trabalho novo,
salvo onde diz "existe".

Termos: **sessão** (nunca instância), **grupo monitorado** (origem), **grupo de disparo** (destino),
**oferta capturada**.

---

## 1. Decisões de arquitetura

| Decisão | Escolha | Por quê |
|---|---|---|
| Módulo API | `api/src/modules/automation/` (feature `group-monitoring`), prefixo `/automation/group-monitoring` | AGENTS.md §5 prevê `automation/`; roadmap aponta `automation/group-monitoring` |
| Disparo | Oferta capturada vira `Offer` com `origin = MONITORING` e reutiliza `OfferDispatch`, `OfferDispatchWorker`, pausar/retomar/parar, `CooldownBar` | Zero duplicação de worker/claim; painel reaproveita `OfferDispatchProgress` |
| Captura | Listener em `MESSAGE_RECEIVED` (`isGroup && !fromMe`), igual ao `ChatIncomingMessageListener` (existe, `api/src/app/server.ts:223`); decide por consulta ao banco (índice `sessionId+groupJid`), **nada em memória** | `arquitetura-escala.md` §6; o listener roda no processo que tem a engine |
| Processamento | Sem `setInterval` novo. `ProcessPendingCapturedOffersUseCase` roda **dentro do tick do `OfferDispatchWorker` existente**, encaixado no `tick` composto de `server.ts:164` (composto devolve `{ processed }` como exige `OfferDispatchWorker.ts:4,64`: `execute = async () => ({ processed: await safe(dispatches) + await safe(captures) })`, **try/catch por use case** devolvendo 0 em erro, erro de um não aborta o outro). Claim próprio em `CapturedOffer` (`claimToken`, `FOR UPDATE SKIP LOCKED`), **batch 3 por tick, timeout 20 s por item** (o mesmo valor vale em §3.1) (rede: expansão de link + client ML/Shopee) para não atrasar a cadência de envio (`runTick` pula ticks sobrepostos, `OfferDispatchWorker.ts:55`). Fase 2 da escala: vira fila BullMQ `monitoring.inbound` (§3.6) | Exceção única e explícita à regra de `arquitetura-escala.md:278`: reusa o worker já aceito, não cria outro |
| Config | `GroupMonitorConfig` **por sessão** (modelo novo, 1 linha por `tenantId+sessionId`). Diferente do gerador, cujo `OfferGeneratorConfig` é 1 por tenant com junção `OfferGeneratorConfigSession` | Horário/intervalo/grupos variam por sessão (nicho) |
| Destinos | `BroadcastGroup` próprio (por sessão, com `conversationId`), **não** reusa `OfferDestination` (lista única por tenant do gerador) | Listas independentes; gerador continua intacto |
| Limites | Entitlements `monitored_groups` (constante nova ao lado de `BROADCAST_GROUPS`, `OfferGeneratorConfigUseCases.ts:11`) e `broadcast_groups`; erro `PlanLimitReachedError` (existe, `shared/errors/internal/PlanErrors.ts`) | roadmap L40-43 |
| Link | Só texto + link afiliado do tenant nesta fase; imagem = a mesma mídia da mensagem monitorada; reescrita IA e "imagem original/gerada" ficam para fase 2 | Pedido do produto |

---

## 2. Banco (migration `20261028100000_create_group_monitoring`, snake_case como as existentes)

```prisma
enum CapturedOfferStatus { PENDING PROCESSING QUEUED SENT SKIPPED FAILED }
enum CapturedOfferSkipReason { NO_LINK UNSUPPORTED_MARKETPLACE CREDENTIAL_MISSING LINK_RESOLVE_FAILED EXPIRED DUPLICATE MONITOR_DISABLED NO_BROADCAST_GROUPS }
enum OfferOrigin { GENERATOR MONITORING }

model GroupMonitorConfig {
  id, tenantId, sessionId        @@unique([tenantId, sessionId])
  enabled             Boolean @default(false)
  windowStartMinute   Int @default(0)      // 0..1440
  windowEndMinute     Int @default(1440)   // start=0 && end=1440 = sem restrição; end < start = cruza meia-noite (22:00–06:00)
  intervalMinSeconds  Int @default(120)    // 60..3600, igual ao gerador
  intervalMaxSeconds  Int @default(300)
  startDelaySeconds   Int @default(0)      // 0..7200: espera após a captura
  maxOfferAgeMinutes  Int @default(180)    // sem cupom: descarta se for enviar depois disso
  couponMaxAgeMinutes Int @default(60)     // com cupom: janela menor (validação: <= maxOfferAgeMinutes)
  mentionAll          Boolean @default(false)
  typingSeconds       Int @default(15)     // limites em campaigns/domain/offerTyping.ts
  aiRewriteEnabled    Boolean @default(false) // fase 2
  createdAt, updatedAt
}

model MonitoredGroup {   // origem
  id, tenantId, sessionId, configId
  conversationId String   // ChatConversation via ISessionGroupDirectory.ensureConversation (existe)
  groupJid String         // cópia para o listener não fazer join
  enabled Boolean @default(true)
  keywords String[]       // opcional: só captura se contiver uma delas
  createdAt
  @@unique([tenantId, sessionId, groupJid]) @@index([sessionId, groupJid])
}

model BroadcastGroup {   // destino
  id, tenantId, sessionId, configId
  conversationId String   // obrigatório: OfferDispatch.conversationId (schema.prisma:786)
  position Int
  @@unique([tenantId, sessionId, conversationId])
}

model CapturedOffer {
  id, tenantId, sessionId, monitoredGroupId
  sourceExternalMessageId String   @@unique([sessionId, sourceExternalMessageId])
  sourceText String, sourceMediaUrl?, sourceMimeType?   // mediaUrl = URL do media store local (ver §3.0)
  marketplace AffiliateProvider?
  originalUrl?, resolvedUrl?, affiliateUrl?
  coupon String?                   // via normalizeCoupon (existe, offerCoupon.ts)
  finalText?                       // texto com link trocado
  status CapturedOfferStatus, skipReason?, errorCode?
  offerId? (FK Offer)              // preenchido ao enfileirar
  capturedAt, expiresAt, processedAt?
  claimToken?, claimedAt?          // mesmo padrão do OfferDispatch
}
```

`Offer.origin`/`expiresAt` **já existem** (fila de envio, migration
`20261028010000_add_send_queue_lanes`). Nome/foto do grupo vêm de `ChatConversation` (`groupName`, `groupAvatarUrl`), não se
duplica.

---

## 3. Pipeline de captura (`automation/application/use-cases/`)

### 3.0 Pré-requisito de mídia (achado da revisão)

`MESSAGE_RECEIVED.mediaUrl` é URL do **media store local**, gerada por `downloadBaileysMedia`
(`BaileysMessagingEngineAdapter.ts:1716-1729`), e só existe se
`ChatConversation.autoDownloadMedia` do grupo estiver ligado (`shouldAutoDownloadGroupMedia`,
`:1384-1405`). O sender (`SendStoredMediaMessageUseCase.acquireLocalFile`, `:144-146`) exige URL do
media store (local ou S3); URL remota falha com `MediaNotFoundError`.

Regras:
- Ao adicionar grupo monitorado: `ensureConversation` + `autoDownloadMedia = true` na conversa.
  `ISessionGroupDirectory` hoje só devolve o id e não toca a flag nem no ramo "já existe"
  (`ChatSessionGroupDirectory.ts:18-31`): **adicionar método `enableAutoDownloadMedia(conversationId,
  tenantId)` à porta**, implementado via `UpdateConversationUseCase` (existe,
  `chat/application/use-cases/UpdateConversationUseCase.ts`), chamado nos dois ramos. Ao remover
  o grupo não desliga (o usuário pode ter ligado antes; dizer no tooltip).
- Captura só aceita imagem: `msgType === IMAGE` e `mimeType ∈ {image/jpeg, image/png, image/webp}`
  (`IMAGE_EXT` em `SendStoredMediaMessageUseCase.ts:51`; `image/jpg` vira `.jpg` e é rejeitado,
  então normalizar para `image/jpeg` antes; `IMAGE_EXT` é indexado por MIME e rejeita
  `image/jpg` com `UnsupportedMediaTypeError`, `:73-74`). Vídeo/GIF/documento → oferta segue
  **só texto** (`sourceMediaUrl = null`), nunca com mídia errada.
- `mediaUrl` nulo (download desligado/falhou) → só texto; `CapturedOffer` registra
  `errorCode = IMAGE_UNAVAILABLE` para o feed mostrar.

### 3.1 Passos

1. **`RegisterCapturedMessageUseCase`** (listener): filtra `isGroup && !fromMe && externalMessageId`;
   busca `MonitoredGroup` ativo por `(sessionId, groupJid)`; sem match → retorna. Grava
   `CapturedOffer PENDING` (dedup pela unique). Nada de rede aqui.
2. **`ProcessPendingCapturedOffersUseCase`** (no tick do worker, claim, timeout 20 s por item):
   - config desligada → `SKIPPED/MONITOR_DISABLED`; sem grupos de disparo → `NO_BROADCAST_GROUPS`.
   - `extractUrls(text)` (domínio puro, novo) → `isSupportedProductUrl` (existe,
     `detectMarketplace.ts:36`, é a barreira da allowlist) → expande curtos com
     `HttpShortLinkExpander` (existe) → `detectMarketplace` (existe). Nenhum link suportado →
     `NO_LINK` / `UNSUPPORTED_MARKETPLACE`.
   - **Link do tenant** via `ResolveAffiliateCredentialUseCase` (existe, `integrations/`):
     - Mercado Livre: credencial é a **sessão decifrada** (`usesSession: true`,
       `affiliateProviderFields.ts:27`); gera link com `MercadoLivreAffiliateClient` usando
       `cred.session.cookies` + `publicIdentifier`, como `GenerateOfferUseCase.ts:190-196`.
       Sem credencial → `CREDENTIAL_MISSING`. `SecretCipherFailedError` (sessão corrompida,
       `ResolveAffiliateCredentialUseCase.ts:49-51`) e qualquer erro dos clients →
       `SKIPPED/LINK_RESOLVE_FAILED` com `errorCode`; **todo caminho de erro sai de
       `PROCESSING`** (catch global no processor → `FAILED`).
     - Shopee: `ShopeeAffiliateClient` (existe).
     - Amazon: não há client; só troca/insere `?tag=` do tenant.
     - Parâmetros de afiliado da origem: `stripAffiliateParams(url, provider)` (puro, **novo**,
       em `automation/domain/services/`) com **lista própria** por marketplace: Amazon `tag`;
       ML `matt_word`, `matt_tool` e caminho `/social/<etiqueta>`; Shopee `af_siteid`,
       `af_click_lookback`, `utm_*` e `uls_trackid`. `affiliateIdentifiersOf` (existe,
       `verifyAffiliateLink.ts:35-44`) **não serve**: só lista `tag`, `matt_word` e
       `/social/<etiqueta>`, sem `matt_tool` e com Shopee vazio. Teste cobre cada parâmetro. **Nunca repassa o id da
       origem.**
   - `rewriteOfferLinks(text, map)` (domínio puro, novo): troca cada URL pelo link do tenant.
   - Cupom: `detectCoupon(text)` (puro, novo) + `normalizeCoupon`/`OFFER_COUPON_MAX` (existem,
     `offerCoupon.ts`).
   - Validade: `expiresAt = capturedAt + (coupon ? couponMaxAge : maxOfferAge)`.
   - **Agendamento**: `resolveStartWithinWindow(capturedAt + startDelay, window, zone)` (puro,
     novo; precisa exportar `wallClock`/`offsetAt` de `startOfDayInZone.ts` ou criar
     `minuteOfDayInZone`). Zona fixa `America/Sao_Paulo` como o gerador (não há timezone por
     tenant). Janela que cruza meia-noite é suportada. `start >= expiresAt` → `SKIPPED/EXPIRED`.
   - Cria `Offer` com **todos os obrigatórios**: `provider`, `sourceUrl` (resolvido),
     `affiliateUrl`, `text = finalText`, `imageUrl = sourceMediaUrl`, `coupon`, `mentionAll`,
     `simulateTyping/typingSeconds`, `origin = MONITORING`, `expiresAt`.
   - Enfileira como o `SendOfferUseCase.ts:80-90`: `dispatchStartAt(start, now)` →
     `scheduleDispatches(count, startAt, {minMs,maxMs}, rand)` (assinatura real:
     `scheduleDispatches.ts:14-19`, recebe `count`, não lista) → `dispatches.startSending(offerId,
     tenantId, {mentionAll}, items)` (`IOfferDispatchRepository.ts:24`). Sem `startSending` a
     oferta fica `DRAFT` e `claimDue` (só `SENDING`) nunca a pega. `startSending` devolve `null`
     se a oferta não estiver `DRAFT` → `FAILED/errorCode=START_SENDING_REJECTED`. Sucesso → marca
     `CapturedOffer QUEUED`.
   - **Janela só ancora o início.** `scheduleDispatches` não conhece janela: com N destinos ×
     intervalo, envios podem passar de `windowEndMinute`. Aceito nesta fase por desenho (o
     `expiresAt` limita o dano); texto da tela diz "os envios começam dentro da janela". Recorte
     por janela no worker fica para a fase 2 (junto com BullMQ).
3. Worker existente envia (digitando…, marcar todos, cooldown). Status do envio = `OfferDispatch`.
   **Validade no envio** (já existe): `ProcessDueOfferDispatchesUseCase.processOne` marca
   `SKIPPED/OFFER_EXPIRED` quando `offer.expiresAt <= now`, depois do claim e antes do send.

Regras de domínio em `automation/domain/services/` como funções puras com teste:
`extractUrls`, `rewriteOfferLinks`, `detectCoupon`, `resolveStartWithinWindow`, `offerExpiry`.

Flag: `GROUP_MONITORING_ENABLED` em `shared/config/env.ts` (padrão `false`; só na Render), mesmo
padrão de `OFFER_DISPATCH_WORKER_ENABLED` (`env.ts:105-108`, `server.ts:163`). **Gate**: o
worker sobe se qualquer uma das duas flags estiver ligada; cada use case do tick só entra com a
própria flag (log diz qual). Listener registra sempre (só grava `PENDING`); local, com as flags
desligadas, só acumula `PENDING` sem rede.

---

## 4. Rotas (`/automation/group-monitoring`, registrar em `api/src/app/routes.ts`)

| Método | Rota | Uso |
|---|---|---|
| GET | `/config?sessionId` | config + grupos monitorados + grupos de disparo (nome/foto via conversa) + limites (`used/max`) |
| PUT | `/config` | salva config da sessão (schema valida faixas; `couponMaxAge <= maxOfferAge`) |
| PUT | `/config/monitored-groups` | substitui lista (`groupJid[]`); `ensureConversation`; entitlement `monitored_groups` |
| PUT | `/config/broadcast-groups` | substitui lista + ordem; entitlement `broadcast_groups` |
| GET | `/captured?sessionId&cursor` | feed, mais recente primeiro, `OpaqueCursor` (existe; offset-based → item novo durante paginação pode repetir; aceitável para feed) |
| POST | `/captured/:id/retry` | reprocessa `SKIPPED` recuperável (`CREDENTIAL_MISSING`, `LINK_RESOLVE_FAILED`, `NO_BROADCAST_GROUPS`) |

Grupos disponíveis: reaproveita `GET /campaigns/offers/config/groups?sessionId&search` (existe).
Pausar/retomar/parar envio: `POST /campaigns/offers/:id/pause|resume|cancel` (existem).

---

## 5. Painel

Pastas: página em `app/src/pages/monitoring/MonitoringPage.tsx`; componentes, hooks e `strings.ts`
em `app/src/features/monitoring/` (mesmo par `pages/offers` + `features/offers`). Substitui o
placeholder `MonitoringPage` de `pages/modules/index.tsx:12`; rota `/monitoring`
(`AppRoutes.tsx:35`) e menu (`AppLayout.tsx:53`) já existem.

```
PageHeader "Monitoramento"  [seletor de sessão ▾]  [+ Conectar nova sessão]
┌ Sessão WhatsApp ┐ ┌ Grupos monitorados n/max ┐ ┌ Grupos de disparo n/max ┐
│ nome, número,   │ │ GroupChip + palavras-chave │ │ GroupChip ordenáveis     │
│ status, ligar   │ │ [Configurar]               │ │ [Adicionar]              │
├ Horário de operação ── RangeSlider 0..1440 (passo 15) com marcas 00/03/…/21/24
├ Envio ── intervalo min–max (RangeSlider 1–60 min) · Digitando (1–30 s) · Marcar todos (Switch)
├ Após a captura ── atraso (0–120 min) · validade sem cupom · validade com cupom
├ Reescrita com IA (Switch desabilitado, "em breve") · Imagem das ofertas (fase 2)
└ Ofertas capturadas ── status, motivo, imagem indisponível, CooldownBar, pausar/parar
```

Componentes (todos novos):
- `useMonitoringConfig(sessionId)` + `services/monitoring.service.ts`.
- `SessionSummaryCard`, `MonitoredGroupsCard`, `BroadcastGroupsCard`.
- `GroupPickerDialog` — busca com `useSessionGroups([sessionId], search)` (existe,
  `features/offers/hooks/useSessionGroups.ts:12`) + `GroupChip`. **Não** usar `AudiencePicker`
  (é público-alvo `OfferAudience`, não grupos).
- `OperatingWindowField` — `RangeSlider` `min=0 max=1440 step=15`, `formatValue` → `HH:MM`
  (`1440` → `24:00`), faixa inteira = "Sem restrição — envio 24h"; `status` = duração da janela.
  Exige **prop nova opcional `marks`** no `RangeSlider` (hoje só rótulos dos extremos,
  `RangeSlider.tsx:196-197`). Cruzar meia-noite: o `RangeSlider` **sempre recebe `lo <= hi`**
  (`clampRange` colapsa faixa invertida, `RangeSlider.tsx:18-25`); o `Switch` "Janela noturna"
  (`ToggleOption`) apenas marca que a janela ativa é o **complemento** da faixa mostrada. O
  campo converte ao salvar: noturna ligada → `windowStartMinute = hi`, `windowEndMinute = lo`.
  Rótulo de status mostra a faixa real ("22:00 → 06:00, 8h"). Sem prop nova além de `marks`.
- `DispatchSettingsCard`, `CaptureDelayCard`, `CapturedOffersList` (`CooldownBar` com
  `serverNow()`).
- `strings.ts` por feature (padrão do painel até existir lib de i18n, `offers/strings.ts:1-7`);
  tooltips MUI em cada controle.

**Fluxo "Conectar nova sessão" (trabalho novo em `SessionsPage`)**:
1. Monitoramento: `navigate('/sessions?create=1&returnTo=/monitoring')`.
2. `SessionsPage.tsx`: ler `create=1` da query → `createOpen = true` na montagem e **limpar
   `create` da URL** (senão reabre no reload); trocar `handleCreated()` (`:43`) por
   `handleCreated(session: SessionItem)` (tipo já exposto por `CreateSessionWizard.onCreated`,
   `CreateSessionWizard.tsx:25`), guardando a sessão em `ref`; `onCreated` dispara antes do
   fechamento (`CreateSessionWizard.tsx:82`), o usuário fecha o wizard (`:94` do mesmo arquivo) → em `onClose`, com `returnTo` válido (só caminho interno que
   começa com `/`), navegar para `${returnTo}?sessionId=${ref.id}`.
3. Monitoramento lê `sessionId` da query, seleciona, limpa a query.

Persistência: `usePersistedState('monitoring.sessionId', null)` (tab). Rascunho da config:
`usePersistedState('monitoring.config.<sessionId>', initialDraft)` **dentro de um componente
montado com `key={sessionId}`** — o hook lê o storage só no mount e, com key mutável, gravaria o
rascunho de A na chave de B (`usePersistedState.ts:77-89`). `clear()` ao salvar.

Privacidade (`privacyFlags.ts`, bloco `{ id: 'monitoring', label, flags }`): `monitoring.sessionName`,
`monitoring.groupNames`, `monitoring.groupAvatars`, `monitoring.capturedText`,
`monitoring.capturedImages`. Temas sistema/claro/escuro via tokens do tema.

Tipos em `api.types.ts`: `GroupMonitorConfigResponse`, `MonitoredGroupItem`, `BroadcastGroupItem`,
`CapturedOfferItem`, `SaveGroupMonitorConfigRequest`.

---

## 6. Ordem de entrega

1. Prisma (`Offer.origin/expiresAt` + 4 models) + migration + mappers + repositórios.
2. Domínio puro + testes (`extractUrls`, `rewriteOfferLinks`, `detectCoupon`,
   `resolveStartWithinWindow`, `offerExpiry`).
3. Use cases + listener + processor no tick do worker + flag + rotas/schemas + `routes.ts`.
4. Validade no `ProcessDueOfferDispatchesUseCase.processOne`.
5. Painel: serviço, tipos, strings, flags, `RangeSlider.marks`, componentes, página,
   redirecionamento do wizard.
6. Verificação: `tsc --noEmit` api/app, vitest, agent-browser nos 3 temas.
7. `CHANGELOG.md` da **raiz** (é o ativo: `[Unreleased]` já lista api 0.35.0 · app 0.40.0;
   `api/CHANGELOG.md` está parado em 0.24.0 e não é atualizado), versões `api 0.36.0` /
   `app 0.41.0`, roadmap item 4 → 🟡.

---

## 7. O que não fazer

- Repassar link/parâmetro de afiliado do grupo monitorado. Sempre o do tenant.
- Enviar oferta com `expiresAt` vencido; cupom nunca ganha validade maior que oferta sem cupom.
- Anexar mídia que não seja JPEG/PNG/WebP do media store; URL remota não serve.
- Guardar lista de grupos monitorados em memória para decidir captura.
- Criar `setInterval` novo; o processamento vai no tick do `OfferDispatchWorker`.
- Chamar Baileys fora do adapter; usar `raw` do evento.
- Buscar URL fora da allowlist (`isSupportedProductUrl` + `HttpShortLinkExpander`).
- Ligar `GROUP_MONITORING_ENABLED` local (`api/.env` = produção).
- Reescrever texto com IA nesta fase (fase 2, `IAiTextGenerator`).
- Usar o termo "instância" na interface.
