# Changelog

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

---

## [Unreleased]

### Changed — app 0.34.1

- **`OfferGeneratorForm.tsx`** — campo do cupom na mesma linha do toggle "Tem cupom" (revelação horizontal, espaço de 24 px); em tela estreita desce para a linha de baixo.

### Added — app 0.34.0

- **`ToggleOption.tsx`** (`components/`) — linha de configuração com toggle: linha inteira clicável (≥ 44 px), título + texto auxiliar alinhados ao conteúdo, realce sutil quando ligada e controles filhos revelados com `Collapse` (sem animação sob `prefers-reduced-motion`). **`OfferResultPanel.tsx`**: "Marcar todos" e "Simular digitação" (com o contador de tempo como filho) usam o componente.
- **`theme.ts`** — `FormControlLabel` com switch perde o `-11px` de compensação de checkbox: toggles inline ("Tem cupom", consentimento da extensão) alinham pela borda do conteúdo.

### Changed — app 0.33.1

- **`theme.ts`** — Switch menor (36×20, bolinha 16) e ligado em azul primário em vez de verde, para seguir a identidade do painel; doc atualizada.

### Added — campaigns (api 0.32.0 · app 0.33.0)

- **Foto dos grupos nos chips e na lista** — `avatarUrl` (de `chat_conversations.groupAvatarUrl`) em `OfferDestinationView`, no DTO/schema de `/config` e na busca de grupos (`mergeSessionGroups`). Painel: **`GroupChip.tsx`** (`GroupAvatar` + `GroupChip`: foto → iniciais → ícone) usado no resumo, no painel da oferta, no passo "Confirmar" e na lista do passo "Grupos". Seleção do assistente guarda `{ title, avatarUrl }`.

### Changed — campaigns (api 0.31.0 · app 0.32.0)

- **Intervalo entre grupos em minutos** — API aceita 60–3600 s (antes 5–120 s), padrão 120–300 s; painel mostra 1–60 min inteiros (`OfferGeneratorConfigUseCases.ts`, `offerConfig.ts`, `ConfigConfirmStep.tsx`). **Breaking**: `PUT /campaigns/offers/config` com intervalo < 60 s passa a dar 400; configuração salva com valores antigos continua valendo no envio até ser salva de novo (o slider já mostra o valor corrigido).
- **Termômetro de risco no `RangeSlider`** (`status`): cor da faixa e rótulo central animados pela média do intervalo (`intervalRisk`, com teste); "Alto risco" pulsa. Textos de confirmação e contagem regressiva em minutos (`m:ss`).

### Added — app 0.31.0

- **`RangeSlider.tsx`** (`components/`) — faixa mínimo–máximo em barra com dois cursores arrastáveis; valores nos extremos acompanham o arraste, limites da escala abaixo, `minDistance`, teclado e `aria-valuetext`. Regra `clampRange` pura e testada. **`ConfigConfirmStep.tsx`**: intervalo entre grupos usa o slider no lugar de dois campos numéricos.
- **`theme.ts`** — `<Switch>` no padrão iOS em todo o painel (trilho verde ligado, bolinha branca com sombra, sem ripple, foco visível, claro/escuro), via override `MuiSwitch`: nenhuma tela muda.
- **`docs/padrao-ui-painel.md`** — tabela caso → componente (switch, faixa, cooldown, ícone, confirmação) + regra no AGENTS.md.

### Fixed — campaigns (api 0.30.0 · app 0.30.0)

- **Busca de grupos trazia só parte dos grupos** — a configuração do gerador listava `chat_conversations` (50 por página, sem arquivadas): grupo sem mensagem recebida não existia no chat e nunca aparecia. Agora **`IMessagingEngine.listParticipatingGroups`** (adapter Baileys, `groupFetchAllParticipating`, cache 60 s) + **`ISessionGroupDirectory`**/`ChatSessionGroupDirectory` + **`ListSessionGroupsUseCase`**/`EnsureSessionGroupUseCase` + rotas `GET /campaigns/offers/config/groups` e `POST …/config/groups/ensure`. Regra pura **`mergeSessionGroups`** (busca sem acento/caixa; sessão fora → lista parcial). Painel: `useSessionGroups` usa a rota nova; marcar grupo sem conversa cria a conversa na hora (`ConfigGroupsStep`).
- **`PrismaChatConversationRepository.ts`** — conversa sem mensagem (criada como destino) vai ao fim da lista (`nulls: 'last'`), não ao topo.

### Fixed — app 0.30.1

- **`AppLayout.tsx`** — trocar de tenant não recarregava as páginas (dados do tenant anterior ficavam na tela) e erro no clique era engolido. Agora recarrega em `/dashboard` após a troca e mostra aviso em falha; item selecionado vem do estado, não do `localStorage`.

### Fixed — api 0.29.3 (API caindo em loop — causa raiz)

- **`app/onSendHooks.ts`** (novo), **`app.ts`** — os dois hooks `onSend` globais (`X-Server-Time` e `Content-Disposition` do storage) viram **síncronos**. Causa raiz do incidente: com `onSend` async, `reply.send()` devolve antes de a resposta ser escrita; em handler async que envia sem `return reply` (quase todas as rotas) o Fastify chamava `send` de novo, e a 2ª escrita lançava `ERR_HTTP_HEADERS_SENT` dentro de uma promise — rejeição não tratada, processo morto. Com 1 hook async a ordem das microtasks escondia; o 2º hook (0.29.1) fez acontecer em toda requisição, com ou sem extensão. O 0.29.2 corrigiu só um sintoma (hooks da extensão). Reprodução e regressão em **`onSendHooks.test.ts`**.
- **`server.ts`** — `unhandledRejection` loga com stack e mantém o processo (uma requisição não derruba todas as sessões); `uncaughtException` loga com stack e encerra (antes só a 1ª linha do erro chegava ao log do Render).

### Fixed — api 0.29.2 (hotfix: API caindo em loop)

- **`extensionAuthHook.ts`**, **`extensionRequestGuard.ts`** — hooks async respondiam 401/403 com `send` + `return;`. Com `onSend` async, `reply.sent` ainda é false quando o Fastify decide chamar o handler: heartbeat/`/me` rodavam sem sessão (TypeError) e respondiam de novo (`ERR_HTTP_HEADERS_SENT`, exceção não tratada → processo caía). Bug latente desde a F1; o `onSend` do `X-Server-Time` (0.29.1) alongou a escrita e fez a corrida acontecer sempre. Agora `return reply.code(…).send(…)`. Teste de regressão `extensionHooks.test.ts` reproduz a corrida.
- **`RecordLifecycleSignalUseCase.ts`** — sinal de instalação ainda não vinculada (FK `P2003`) virava 500 na rota pública; agora é descartado.

### Added — app 0.29.0

- **Padrão de ícones** — `lucide-react@1.55.0` + **`AppIcon.tsx`** com tokens de tamanho (`inline` 1.25em acompanha o texto em desktop/mobile; `sm`/`md`/`lg` em px). Decisão em **`docs/padrao-icones.md`** e regra no AGENTS.md.
- **`AudiencePicker.tsx`**, **`OfferResultPanel.tsx`** — públicos-alvo com ícone Lucide na mesma linha do nome (antes: emoji acima); mapa `AUDIENCE_ICONS` em `offerConfig.ts`, emoji removido de `strings.ts`.

### Added — app 0.28.0 · api 0.29.1

- **`CooldownBar.tsx`** (`components/`) — barra de energia reutilizável para qualquer cooldown: esvazia até zerar por `requestAnimationFrame` escrevendo `transform` no DOM (React só re-renderiza 1×/s), recalcula pelo relógio a cada quadro (aba em segundo plano retoma no ponto certo), cor contínua verde→laranja→vermelho, células, brilho, pulso na reserva baixa; `role="progressbar"`, `prefers-reduced-motion`, temas claro/escuro.
- **`serverClock.ts`** + **`apiClient.ts`** — relógio do servidor estimado pelo ponto médio da ida e volta (amostra de menor latência); `serverNow()` / `serverToLocal()`.
- **`app.ts`** (api) — header `X-Server-Time` em toda resposta, exposto no CORS.
- **`OfferDispatchProgress.tsx`** + **`dispatchCooldown.ts`** — card "Envio" mostra a espera sorteada até o próximo envio.

### Added — campaigns (api 0.29.0 · app 0.27.0)

- **`IMessagingEngine.sendPresence`** + **`BaileysMessagingEngineAdapter`** — capacidade "digitando…"/"pausado" no motor (Baileys só no adapter).
- **`ChatOfferMessageSender.ts`** — com `simulateTyping`, mostra "digitando…" por `typingSeconds` (renovado a cada 8 s) antes da oferta; falha na presença não segura o envio.
- **`ProcessDueOfferDispatchesUseCase.ts`** — timeout do envio soma o tempo de digitação.
- **`offerTyping.ts`**, **`UpdateOfferUseCase.ts`**, schemas — `typingSeconds` inteiro 1–30, padrão 15.
- **Migration `20261027150000_add_offer_simulate_typing`** — `offers.simulateTyping` (false) e `offers.typingSeconds` (15).
- **`OfferResultPanel.tsx`** — switch "Simular digitação" abaixo de "Marcar todos", com contador −/+ do tempo; **`useOfferGenerator.ts`** grava otimista e ignora respostas fora de ordem.

### Fixed — app 0.26.1 · extension 3.2.0

- **`AppLayout.tsx`** — lista de tenants só era carregada no login; após recarregar a página ficava vazia e o seletor de tenant sumia (super admin preso no tenant atual). Agora carrega ao montar o layout.
- **`index.ts`** (extensão) — clique no ícone foca a aba do painel já aberta em vez de abrir outra. **`webpack.js`** inclui a origem do painel em `host_permissions` (a atualização pede a permissão nova ao usuário).

### Added — extension (api 0.28.0 · app 0.26.0)

- **`extension.routes.ts`** — `DELETE /extension/marketplaces/ml/session`: "Desconectar Mercado Livre" chamava rota inexistente. Revoga o consentimento ML de todas as sessões da extensão do tenant e apaga a sessão cifrada; etiqueta e secreto ficam. `POST /extension/marketplaces/ml/consent` reautoriza a instalação.
- **`ClearAffiliateSessionUseCase.ts`** + **`clearSession`** no repositório — idempotente, audita `AFFILIATE_SESSION_ACCOUNT_RESET`.
- **`IAuditLogRepository.ts`** — espelho TS ganha `AFFILIATE_SESSION_ACCOUNT_RESET` (já existia no enum Prisma).
- **`useExtension.ts`** — "Sincronizar agora" reautoriza a instalação antes do sync; **`ExtensionMlCard.tsx`** mostra erro ao desconectar.

### Fixed — extension (app 0.25.4 · extension 3.1.3)

- **`marketplaceSession.ts`** — captura descartava cookies de sessão do navegador (`!cookie.session`); o status "Logado" não. Com `ssid` de sessão: painel mostrava "Logado", mas o sync falhava com `ml_not_logged` sem chamar a API.
- **`handlers.ts` / `channel.ts`** — `ml.syncSession` escondia falha como `UNCHANGED`; agora `FAILED` + `errorCode`.
- **`useExtension.ts`, `ExtensionMlCard.tsx`, `BrowserSessionCredentialDialog.tsx`** — "Sincronizar agora" mostra erro (antes: rejeição sem `catch`).
- **`extensionApi.ts`** — status ML lia `GET /integrations/affiliate-credentials/MERCADO_LIVRE`, rota inexistente (404 → sempre "Ainda não sincronizada" e sem etiqueta). Agora lê da lista.

### Fixed — extension (api 0.27.1 · extension 3.1.2)

- **`GetExtensionProfileUseCase.ts`** — `GET /extension/me` devolvia `{ id, name, email, tenants[].mlSessionAllowed }`, mas a extensão lê `{ user, mlTenantId, tenants[].permissions }`. Com `/me` respondendo 200, o handshake estourava em `profile.user.id` e o painel mostrava "Extensão não encontrada". **Breaking** do contrato `/me` (único consumidor: a extensão).
- **`handlers.ts`** (extensão) — handshake tolera perfil sem `user`.
- **`guard.ts` / `apiFetch.ts`** (extensão 3.1.1) — ops públicas esperam no máximo 1,2s pela API; `apiFetch` com timeout de 10s.

### Added — extension (api 0.27.0)

- **`extension.routes.ts`** — `PUT /extension/marketplaces/ml/session`: rota que a extensão já chamava e não existia (sync sempre 404). Exige consentimento ML da sessão e entitlement; guarda só `ML_SESSION_COOKIES`, busca a etiqueta ativa no ML e grava via `UpsertAffiliateSessionUseCase`.
- **`extensionAuthHook.ts`** — contexto expõe `mlConsent`.

### Fixed — extension (api 0.26.1)

- **`extension.routes.ts`** — `POST /extension/session` lia `user.id` e `request.tenantId`, que não existem (`request.user.userId` / `request.tenantContext.tenantId`): 403 para todos e depois 500 no Prisma. Rotas agora usam os tipos do Fastify, sem `as any`.
- **`PrismaExtensionSessionRepository.ts`** — `create` → `issue` (upsert por usuário+instalação). Revincular o mesmo navegador violava `@@unique([userId, installationId])` → 500.
- **`lifecycle.ts`** (extensão) — evento sem `channel` obrigatório → 400.

> **Estado do versionamento (2026-09-25)**: `api/package.json` e `app/package.json` estão em
> `0.12.0`, mas a única TAG do repositório é `v0.2.0` e a última seção fechada aqui é `[0.2.0]`.
> Tudo abaixo é trabalho acumulado desde então, atravessando várias versões dos `package.json`
> sem seção nem TAG correspondente — AGENTS.md §31.3 pede os três lugares em sincronia.
>
> Sanar isso exige decidir o recorte das versões intermediárias, o que não dá para inferir do
> histórico com segurança. Duas saídas: criar `release/v0.11.0` distribuindo o conteúdo abaixo
> entre as versões que ele representa, ou assumir `0.11.0` como marco único, fechando a seção
> com tudo. A segunda é mais honesta com o que de fato foi entregue em bloco.
>
> _Remover esta nota ao fechar a primeira seção de versão._

### Added

#### Frontend (`app/`) — Diálogo de credencial ML com wizard da extensão (`0.25.0`)

Substitui o diálogo genérico de etiqueta pelo wizard completo da extensão ao configurar Mercado Livre.

- **`app/src/features/settings/components/BrowserSessionCredentialDialog.tsx`** — novo diálogo para provedores com sessão de navegador; embute `ExtensionSetupWizard` quando extensão não está conectada, exibe status ML (sessão, última sync, etiqueta) quando conectada; botão de sincronizar e link para `/settings/extension`
- **`app/src/pages/settings/AffiliateCredentialsPage.tsx`** — detecta `usesBrowserSession` e abre `BrowserSessionCredentialDialog` ao invés de `AffiliateCredentialDialog` para ML; `onClose` recarrega credenciais

#### API (`api/`) — HubOutboxWorker e ExtensionRetentionJob (F6, `0.26.0`)

Worker de outbox para envio de eventos de extensão ao hub central com assinatura M2M HMAC.

- **`api/src/modules/extension/infrastructure/hub/hmacSigner.ts`** — assinatura M2M canônica (`method\npath\nquery\ntimestamp\nnonce\nsha256(body)`), headers `X-Application-Key`/`X-Timestamp`/`X-Nonce`/`X-Signature`; recalculada a cada tentativa
- **`api/src/modules/extension/domain/contracts/IHubOutboxRepository.ts`** — porta: `claimHeads` (cabeça por `clientKey`, `SKIP LOCKED`), `markSent`, `markDead`, `scheduleRetry`, `purgeSent`, `purgeDead`
- **`api/src/modules/extension/infrastructure/repositories/PrismaHubOutboxRepository.ts`** — implementação Prisma; `claimHeads` bloqueia cliente com evento `DEAD`; `DISTINCT ON (clientKey)` com `FOR UPDATE SKIP LOCKED`
- **`api/src/modules/extension/infrastructure/hub/HubOutboxWorker.ts`** — worker setInterval 5 s, head-of-line por `clientKey`, POST `${hubUrl}/events` com fetch nativo + 8 s timeout; 4xx → DEAD imediato; 5xx/rede → backoff 1 min → 24 h (×2), máx 10 tentativas; `HUB_EVENTS_ENABLED` + `HUB_EVENTS_CONFIGURED` para ligar
- **`api/src/modules/extension/infrastructure/jobs/ExtensionRetentionJob.ts`** — job diário com `pg_try_advisory_lock`; purga outbox SENT > 30 d, DEAD > 90 d, lifecycle events > 365 d, sessões revogadas/expiradas > 30 d
- **`api/src/modules/extension/infrastructure/extensionContainer.ts`** — adicionado `outboxRepository`
- **`api/src/app/server.ts`** — registro do worker e retention job com gate `HUB_EVENTS_ENABLED && HUB_EVENTS_CONFIGURED`; shutdown gracioso
- **`api/src/modules/extension/infrastructure/hub/hmacSigner.test.ts`** — vetor de assinatura M2M: formato canônico, body vazio, query string, uppercase de método, unicidade de nonce
- **`api/src/modules/extension/infrastructure/hub/HubOutboxWorker.test.ts`** — 2xx → SENT, 4xx → DEAD, 5xx → retry com backoff, max attempts → DEAD, network error → retry, backoff cap 24 h

#### API (`api/`) — MercadoLivreAffiliateClient: geração automática de links de afiliado ML (`0.25.0`)

Cliente da API interna do programa de afiliados do Mercado Livre (não documentada; requer sessão de navegador sincronizada pela extensão).

- **`api/src/modules/campaigns/domain/contracts/IMercadoLivreAffiliateClient.ts`** — porta: `createAffiliateLinks` (batch até 20 URLs → short_url), `getActiveTag`
- **`api/src/modules/campaigns/infrastructure/http/MercadoLivreAffiliateClient.ts`** — bootstrap (GET link-builder → cookies temporários `_csrf`, `_d2id`, `_mldataSessionId`), tags (`/affiliate-program/api/v2/stripe/user/tags`), createLink (`POST /affiliate-program/api/v2/affiliates/createLink`). Nunca loga cookies/body/headers. 8s timeout. Validação anti-injeção de cookie

### Fixed

#### Extensão Chrome (`extension/`) — Popup abria localhost em produção (`3.0.1`)

- **`extension/dist/`** — rebuild com `.env` de produção; dist anterior foi gerado com `.env.dev` (localhost:5174). Botão "Abrir painel" agora abre `https://app.copysync.app`

### Changed

- **`api/src/modules/campaigns/application/use-cases/GenerateOfferUseCase.ts`** — quando URL colada é produto ML sem `matt_word` e o tenant tem sessão da extensão, gera link de afiliado automaticamente via `MercadoLivreAffiliateClient`. Degradação graciosa: falha na API ML → `OFFER_LINK_NOT_AFFILIATE` como antes
- **`api/src/modules/campaigns/infrastructure/offersContainer.ts`** — wiring do `MercadoLivreAffiliateClient` no container

---

#### Painel (`app/`) — Feature Extensão: canal, wizard, configurações (`0.24.0`)

Feature completa de gestão da extensão Chrome no painel.

- **`app/src/features/extension/channel/client.ts`** — cliente de canal `chrome.runtime.sendMessage` via `externally_connectable`; tenta IDs de `VITE_EXTENSION_IDS`, cache do ID ativo, timeout 3s
- **`app/src/features/extension/hooks/useExtension.ts`** — hook principal: detecta extensão, handshake, status ML, credencial, connect, sync, disconnect
- **`app/src/features/extension/services/extensionApi.ts`** — chamadas à API de extensão: issueSession, revokeSession, listSessions, getMlCredentialStatus, disconnectMl
- **`app/src/features/extension/strings.ts`** — textos i18n pt-BR (settings, ml, wizard, errors)
- **`app/src/features/extension/components/ExtensionSetupWizard.tsx`** — wizard 4 passos (detectar, vincular, sincronizar, concluir)
- **`app/src/features/extension/components/ExtensionMlCard.tsx`** — card de status ML com sync, desconectar, aviso de expiração
- **`app/src/features/extension/components/ExtensionStatusBadge.tsx`** — chip colorido por status da extensão
- **`app/src/pages/settings/ExtensionSettingsPage.tsx`** — página Configurações › Extensão

### Changed

- **`app/src/features/settings/components/SettingsLayout.tsx`** — adicionado item "Extensão" na navegação de configurações
- **`app/src/routes/AppRoutes.tsx`** — rota `/settings/extension`
- **`app/src/contexts/AuthContext.tsx`** — logout explícito revoga sessão da extensão (`DELETE /api/extension/session`, best-effort)

---

#### Extensão Chrome (`extension/`) — v3.0.0: reescrita para modelo cookie-auth + channel (`3.0.0`)

Reescrita completa da extensão do modelo Bearer-token/password-login para cookie-auth via painel.
A extensão não tem mais tela de login — sessão vem do cookie HttpOnly `__Host-ext_session` definido
pelo painel. Comunicação painel↔extensão via `externally_connectable` channel com envelope versionado.

- **`extension/src/background/channel/`** — pipeline de canal: validação de origem, filtro de envelope (TTL 15s, anti-replay), guard de sessão/permissão, handlers para 5 ops v1 (handshake, bridge.identify, session.changed, ml.status, ml.syncSession), `assertNoSecrets` para impedir vazamento de cookies
- **`extension/src/contract/channel.ts`** — contrato do canal (envelope, ops, error codes), copiado identicamente para `app/src/features/extension/contract/channel.ts`
- **`extension/src/background/apiFetch.ts`** — HTTP client com cookie auth (`credentials:'include'`), sem Bearer tokens
- **`extension/src/background/store.ts`** — substitui `authStore.ts`; sem tokens em storage; apenas settings, syncState, installationId, mlCookieHash
- **`extension/src/background/sessionResolver.ts`** — single-flight `GET /api/extension/me` com cache TTL 5min
- **`extension/src/background/lifecycle.ts`** — onInstalled/onStartup, heartbeat 30min, reserve sync 60min, uninstall URL
- **`extension/src/background/constants.ts`** — listas de cookies ML reais (ssid, orguseridp, orgnickp, orguserid) confirmadas pelo spike F0
- **`extension/src/background/marketplaceSession.ts`** — leitura de cookies via `chrome.cookies.getAll` com hash SHA-256 para detecção de mudanças
- **`extension/src/background/syncSession.ts`** — sync via `PUT /api/extension/marketplaces/ml/session` com cookie auth, rate limit 15min
- **`extension/src/background/index.ts`** — SW entry: channel, lifecycle, alarms, `cookies.onChanged` debounce, popup messages
- **`extension/src/popup/`** — popup simplificado: tela "conectar via painel" (sem login) ou status ML + sync; sem tag/tenant/logout
- **`extension/public/manifest.json`** — removido `content_scripts`, `scripting`/`tabs` permissions, hosts `.ar`/`.mx`; adicionado `externally_connectable`
- **`extension/webpack.js`** — removido entry `content`; transforms para `externally_connectable.matches` e `host_permissions` a partir de env; strip `key` em build de loja
- **`extension/scripts/check-contract-sync.mjs`** — verifica paridade `channel.ts` entre extension/ e app/

### Removed

- **`extension/src/content/index.ts`** — content script eliminado (cookies lidos via API `chrome.cookies`)
- **`extension/src/background/authStore.ts`** — substituído por `store.ts` (sem tokens)
- **`extension/src/background/apiClient.ts`** — substituído por `apiFetch.ts` (cookie auth)
- **`extension/src/contract/messages.ts`** — substituído por `contract/channel.ts`
- **`extension/src/contract/api.ts`** — não mais necessário

### Changed

- **`api/src/modules/extension/domain/constants.ts`** — nomes de cookies ML corrigidos de placeholders para nomes reais; TTLs: 7d→30d sliding, 30d→90d absolute

---

#### Backend — M1-B: Hub billing receiver, provisioning, invites, entitlements (`0.20.0`)

- **`api/src/modules/integrations/billing/verifyBillingHmac.ts`** — HMAC verification (sha256, timingSafeEqual, ±5min drift tolerance)
- **`api/src/modules/integrations/billing/ApplyBillingEventUseCase.ts`** — processa eventos do hub: provision (subscription.activated), status changes (renewed/reactivated→ACTIVE, payment_failed→SUSPENDED, canceled/expired→CANCELLED), idempotency via BillingEventReceipt, seq watermark, entitlements sync inline
- **`api/src/modules/integrations/billing/billing.routes.ts`** — POST /integrations/billing/webhook com raw body parser, HMAC auth, sem authHook
- **`api/src/modules/integrations/billing/SyncTenantEntitlementsUseCase.ts`** — sincroniza entitlements do tenant a partir de PlanEntitlementPreset
- **`api/src/modules/integrations/billing/ReconcileSubscriptionsUseCase.ts`** — reconciliação periódica com lease (JobLease), placeholder para M2 hub API
- **`api/src/modules/tenants/application/use-cases/ProvisionTenantUseCase.ts`** — cria Tenant + User + UserTenant(ADMIN) + UserInvite em UoW, email afterCommit
- **`api/src/modules/tenants/application/use-cases/UpdateTenantStatusUseCase.ts`** — muda status, emite TENANT_SUSPENDED para SUSPENDED/CANCELLED
- **`api/src/modules/users/application/use-cases/InviteUserUseCase.ts`** — convite por email com token hash, expiração 7 dias
- **`api/src/modules/users/application/use-cases/AcceptInviteUseCase.ts`** — aceita convite (3 paths: novo user, user existente sem senha, user com senha)
- **`api/src/modules/tenants/presentation/routes/provisioning.routes.ts`** — rotas super-admin: POST /provisioning/tenants, PATCH /:id/status, POST /:id/invite
- **`api/src/modules/auth/presentation/routes/invite.routes.ts`** — GET/POST /auth/invites/:token (public)
- **`api/src/modules/sessions/infrastructure/listeners/TenantSuspendedSessionListener.ts`** — desconecta sessões ativas ao suspender tenant
- **`api/src/shared/database/UnitOfWork.ts`** — UoW pattern com TransactionClient + afterCommit
- **`api/src/shared/events/InternalTeamEvent.ts`** — eventos MEMBER_DEACTIVATED e TENANT_SUSPENDED
- **`api/src/shared/events/InternalEventBus.ts`** — generalizado para InternalEvent = InternalMessagingEvent | InternalTeamEvent
- **`api/src/modules/users/domain/contracts/IUserInviteRepository.ts`** + **`PrismaUserInviteRepository.ts`** — repositório de convites
- **`api/src/modules/integrations/domain/contracts/IEmailSender.ts`** — porta email (NoopEmailSender, SmtpEmailSender, EmailSenderFactory)
- **`api/src/shared/utils/normalizeEmail.ts`** + **`generateInviteToken.ts`** — utilitários de convite
- **`api/prisma/migrations/20261026140000_add_billing_integration_models/`** — TenantEntitlement, PlanEntitlementPreset, BillingEventReceipt, JobLease, planSlug/lastBillingEventSeq em Tenant, mustChangePassword em User

#### Frontend — M1-B: Tela de aceitar convite (`0.19.0`)

- **`app/src/pages/InvitePage.tsx`** — tela pública /invite/:token (info do convite, set password, aceitar)
- **`app/src/services/invite.service.ts`** — service para GET/POST invite API
- **`app/src/i18n/locales/pt-BR/invite.json`** + **`en/invite.json`** — i18n do fluxo de convite

### Changed

- **`api/src/app/routes.ts`** — registro condicional de billingRoutes (BILLING_ENABLED) e provisioningRoutes
- **`api/src/app/server.ts`** — billing reconciliation interval, warning EMAIL_SENDER=noop+BILLING_ENABLED, cleanup no shutdown
- **`api/src/shared/config/env.ts`** — vars BILLING_* e EMAIL_* para billing hub e email sender
- **`api/src/shared/http/hooks/superAdminHook.ts`** — hook de autorização super-admin
- **`api/src/modules/tenants/domain/entities/Tenant.ts`** — adicionado lastBillingEventSeq, isSuspended()
- **`api/src/modules/users/domain/entities/User.ts`** — passwordHash nullable, mustChangePassword, hasPassword()

---

#### Backend — M0 fundação: billing fields, team invites, auth flush, adapter unificado (`0.18.4`)

- **`api/prisma/migrations/20261026120000_add_team_invites_and_billing_fields/migration.sql`** — migration manual (prod DB): `tenants.billingCustomerId` (unique nullable), `tenants.suspendedAt`, `users.passwordHash` DROP NOT NULL, `users.passwordSetAt`, tabela `user_invites` com FK cascade + índice (tenantId, email)
- **`api/prisma/schema.prisma`** — modelo `UserInvite`, campos `billingCustomerId`/`suspendedAt` em Tenant, `passwordHash` nullable + `passwordSetAt` em User
- **`api/src/shared/errors/internal/TeamErrors.ts`** — `TenantSuspendedError` (403) e `UserInactiveError` (403) para rejeição semântica de tenant suspenso/membro inativo
- **`api/src/shared/http/hooks/resolveMembership.ts`** — extração da lógica duplicada de `tenantHook` + `sseAuthHook`; usa `TenantSuspendedError` em vez de `ForbiddenError` genérico
- **`api/src/shared/http/hooks/tenantHook.ts`** — refatorado para usar `resolveMembership`
- **`api/src/shared/http/hooks/sseAuthHook.ts`** — refatorado para usar `resolveMembership`
- **`api/src/modules/auth/application/use-cases/LoginUseCase.ts`** — guard `passwordHash` null → `InvalidCredentialsError` (contas provisionadas via billing sem senha)
- **`api/src/modules/messaging/infrastructure/engines/baileys/BaileysAuthStatePersistence.ts`** — `flushAllAuthStates()` no shutdown (registry `activeFlushers` + `forceFlush`/`dispose` por sessão); elimina perda de auth state no SIGTERM
- **`api/src/app/server.ts`** — shutdown chama `flushAllAuthStates()` antes de `app.close()`; bootstrap usa `getActiveEngine()` em vez de criar 2ª instância do adapter Baileys
- **`api/.env.dev`** — `connection_limit=5` na DATABASE_URL (limita pool Prisma por processo)

#### Docs — billing via API central e plano de lançamento (`0.18.3`)

- **`docs/arquitetura-central-billing.md`** — decisão de 2026-10-26: a API central (`pulsosocial_api`) é o hub de checkout, assinatura, e-mail e créditos; o CopySync só recebe eventos HMAC, provisiona tenant e guarda entitlements. Lista o que implementar aqui, o que não fazer, a ordem, as alternativas descartadas (fork, 2ª instância, checkout próprio, SSO, repo novo, instâncias pelo hub), a carga do CopySync no hub e o que fica para o futuro (checkout para terceiros, cascata de gateway).
- **`.specs/features/service-desk/integracao-api-central.md`** — seção 9 com as decisões (sem fork, sem segunda instância, sem checkout próprio, cascata de gateway conservadora, créditos por flag de aplicação); §6 item 2 marcado como superado.
- **`.specs/features/service-desk/design.md`**, **`context.md`** — D7 marcada como superada; `Tenant.planSnapshot` vira `planSlug`; `origin` tipado em `ProvisionTenantUseCase`/`UpdateTenantStatusUseCase`; `EMAIL_SENDER=noop|smtp|hub`; decisão "não desconectar sessão de tenant suspenso" superada pela integração.
- **`AGENTS.md`**, **`docs/produto-roadmap.md`** — ponteiros para o doc novo.
- **`docs/arquitetura-escala.md`** — escada do Postgres dedicado (256mb dev → 0.5c-1g primeiro cliente → 1c-2g ~50 sessões), região Virginia, `connection_limit=5`, migração a partir do banco compartilhado.
- **`docs/plano-lancamento-hub-copysync.md`** — plano mestre em marcos M0–M4 amarrando hub, escala, produto e billing; rede de segurança S1–S7 para o PulsoSocial (central hoje sem testes/CI/staging); gestão de instâncias fica na infra e no super-admin do CopySync, não no hub.

#### Frontend (`app/`, `settings`) — Redesenho da tela de credenciais de afiliado (`0.18.2`)

- **`features/settings/components/AffiliateConnectionSummary.tsx`** — topo com progresso ("X de 3 marketplaces conectados", só ativas contam), logos com selo de conectado, barra que anima ao montar (sem animação com `prefers-reduced-motion`) e "Como funciona" em 3 passos; aviso de cifragem vira rodapé com cadeado
- **`features/settings/components/AffiliateCredentialCard.tsx`** — cabeçalho próprio (sem `SectionCard`): logo à esquerda do nome e chip de status sob o nome (ao lado, em 3 colunas, sobrepunha o nome); faixa e fundo translúcido na cor da marca; 3 destaques com ícone; CTA "Conectar {marketplace}"; hover com leve elevação
- **`features/settings/components/MarketplaceLogo.tsx`** — bloco branco da logo reaproveitado pelo card e pelo resumo
- **`features/settings/affiliateProviders.ts`** — `brandColor` (cor oficial, só como acento) e `highlights` (ícone + texto) por marketplace; textos em `strings.ts`

#### Frontend (`app/`, `settings`) — Logos dos marketplaces nos cards de credencial (`0.18.1`)

- **`app/public/assets/marketplaces/`** — `shopee.svg`, `amazon.svg` (Simple Icons, CC0, cor da marca) e `mercado-livre.svg` (theSVG, MIT); licenças em `LICENSE.md` da pasta
- **`features/settings/affiliateProviders.ts`** — catálogo troca o ícone genérico do MUI por `logo` (caminho do SVG)
- **`features/settings/components/AffiliateCredentialCard.tsx`** — logo em bloco de fundo branco com borda do tema, legível no claro e no escuro

#### Backend (`api/`, `integrations`) — Credenciais de afiliado (`0.18.0`)

Roadmap item 3. Doc: `docs/integracoes-credenciais-afiliado.md`; spec em `.specs/features/affiliate-credentials/`.

- **`prisma/schema.prisma`** + migration **`20261022135437_add_affiliate_credentials`** — enums `AffiliateProvider` (`SHOPEE`, `MERCADO_LIVRE`, `AMAZON`) e `AffiliateCredentialStatus`, tabela `affiliate_credentials` (`@@unique([tenantId, provider])`, segredo e sessão em colunas `Bytes` cifradas com `keyVersion` próprio, `publicIdentifier` opcional para a linha criada pela extensão) e 3 valores em `AuditAction` (`AFFILIATE_CREDENTIAL_UPSERTED`, `AFFILIATE_CREDENTIAL_DELETED`, `AFFILIATE_SESSION_SYNCED`)
- **`shared/security/AesGcmSecretCipher.ts`**, **`ISecretCipher.ts`**, **`SecretCipherFactory.ts`** — AES-256-GCM com Node `crypto`, AAD `tenantId:provider:campo` (blob trocado de linha/coluna não decifra); chave validada no primeiro uso: ausente/malformada → `SECRET_CIPHER_UNAVAILABLE` (503) só nas gravações que cifram, sem derrubar o boot
- **`shared/config/env.ts`** — `CREDENTIALS_ENCRYPTION_KEY` opcional (vazia = ausente) e carga de `api/.env.local` (gitignored) via `process.loadEnvFile`; **`package.json`** `engines.node >=20.12.0`
- **`app/server.ts`** — loga no boot se a chave está indisponível, sem imprimir o valor
- **`shared/errors/internal/AffiliateCredentialErrors.ts`**, **`SecretCipherErrors.ts`** — `AFFILIATE_CREDENTIAL_INVALID` (422, `meta.field`), `AFFILIATE_CREDENTIAL_NOT_FOUND` (404), `SECRET_CIPHER_UNAVAILABLE` (503), `SECRET_CIPHER_FAILED` (500)
- **`modules/integrations/domain/`** — entidade, contrato `IAffiliateCredentialRepository`, `maskIdentifier` (`••••3128`) e `affiliateProviderFields` (campos e regex permissivas por marketplace, verificadas em T0)
- **`modules/integrations/application/use-cases/`** — `List`, `Upsert` (secret vazio mantém o atual; cifra só quando há segredo), `Delete`, `SetStatus`, `Resolve` (único que decifra para uso; sem rota) e `UpsertAffiliateSession` (sessão da extensão: tag inválida descartada, tag só preenche ID vazio, auditoria só quando o token muda, blob indecifrável regravado sem 500)
- **`modules/integrations/infrastructure/`** — `PrismaAffiliateCredentialRepository` (tudo por `tenantId`; P2002 concorrente repete 1x; preenchimento de tag atômico no `WHERE`) e `PrismaAffiliateCredentialMapper`
- **`modules/integrations/presentation/`** — `GET/PUT/DELETE /integrations/affiliate-credentials[/:provider]`, `PATCH /:provider/status`, `PUT /:provider/session` (contrato da extensão), envelope `{ success, data }`, schema `AffiliateCredentialItem` sem campo secreto; **`app/app.ts`** registra o schema, a tag OpenAPI `Integrations` e `meta` no `ErrorResponse`
- **`shared/audit/IAuditLogRepository.ts`** — 3 ações novas, auditadas sem valor de chave/token

#### Frontend (`app/`, `settings`) — Configurações → Credenciais de afiliado (`0.18.0`)

- **`pages/settings/AffiliateCredentialsPage.tsx`** + rota `/settings/affiliate-credentials` em **`routes/AppRoutes.tsx`** — cabeçalho, aviso, grid 3/1 colunas de cards
- **`features/settings/components/AffiliateCredentialCard.tsx`** — chip Configurado/Não configurado/Inativo, valores só mascarados, switch Ativa, remover com `ConfirmDialog`; Mercado Livre mostra "Sessão sincronizada em …", "ID pendente" e orientação da extensão
- **`features/settings/components/AffiliateCredentialDialog.tsx`** — validação local espelhando o domínio, secret com olho e "mantido se vazio" na edição, mantém valores em erro e marca o campo recusado pela API
- **`features/settings/hooks/useAffiliateCredentials.ts`** — remoção/status otimistas com rollback; salvar não é otimista
- **`features/settings/affiliateProviders.ts`**, **`strings.ts`** — catálogo dos marketplaces e textos centralizados (inclui os de conta/senha migrados de `SettingsAccountPage`, `ChangePasswordForm`, `ChangePasswordPage`)
- **`features/settings/components/SettingsLayout.tsx`** — novo item de submenu; ícone do item agora é renderizado
- **`services/affiliateCredential.service.ts`**, **`types/api.types.ts`** — cliente e tipos do contrato
- **`services/apiClient.ts`** — erro rejeitado carrega `field` de `meta.field` (422)

#### Extensão (`extension/`) — rota de sessão disponível (`2.0.1`)

- **`extension/src/contract/api.ts`**, **`docs/extensao-navegador.md`** — rota `PUT …/session` deixou de ser pendência (T7b); extensão `2.0.1`

#### Deploy — credenciais de afiliado

- Criar **`CREDENTIALS_ENCRYPTION_KEY`** (`openssl rand -base64 32`) no dashboard da Render **antes** do deploy da API; sem ela as gravações que cifram respondem 503. Migration `add_affiliate_credentials` aplicada pelo `prisma:deploy`.

#### Extensão Chrome (`extension/`) — sessão de afiliado do marketplace (`0.17.6`)

Reescrita do legado "Redirect Flow" como projeto próprio (MV3, webpack + TypeScript), white label,
i18n `pt_BR`/`en` e temas sistema/claro/escuro. Doc: `docs/extensao-navegador.md`.

- **`extension/src/background/apiClient.ts`** — único lugar que monta URL (`env.apiUrl` + path): `login`, `refresh`, `syncAffiliateSession` (`PUT /integrations/affiliate-credentials/MERCADO_LIVRE/session` com `Authorization: Bearer` e `X-Tenant-Id`). Em 401 faz um refresh e repete; refresh recusado → limpa auth e `api_unauthorized`. 404 → `api_route_missing`, rede → `api_unreachable`, resto → `api_rejected`. Nunca propaga texto da API (AGENTS §13)
- **`extension/src/background/marketplaceSession.ts`** — único uso de `chrome.cookies` do projeto (cookie `ssid` do domínio do marketplace); acha a aba do marketplace e pede o CSRF ao content script, com fallback `chrome.scripting.executeScript` para aba aberta antes da instalação
- **`extension/src/background/syncSession.ts`** — `runSync('alarm'|'manual')` com mutex; grava `SyncState` (`syncing→ok|error`, `lastSyncAt`, `lastErrorCode`; `lastErrorDetail` só em DEV)
- **`extension/src/background/authStore.ts`**, **`errors.ts`**, **`index.ts`** — `chrome.storage.local` tipado (tenant padrão = primeiro da lista; `auth/select-tenant` valida pertencimento); `SyncError`; alarme `affiliate-session-sync` e `onMessage` com switch exaustivo em `RuntimeRequest`, remetente restrito à própria extensão
- **`extension/src/content/index.ts`** — só responde `page/get-csrf` lendo `meta[name="csrf-token"]`; sem polling, sem log, sem DOM
- **`extension/src/contract/messages.ts`** — `SyncErrorCode` ganha `login_invalid` e `login_no_tenant` (chaves `err_*` já existiam nas locales)
- **`extension/scripts/check-dist.mjs`** — pós-build: versão do manifest = `package.json`, sem `localhost`/IP privado, host de `API_URL` presente no `background.js`, sem `console.log(`/`debugger`, sem `_metadata/` nem `update_url`
- **`extension/scripts/check-cookie-scope.mjs`** — `chrome.cookies.*` só em `marketplaceSession.ts` e com `MARKETPLACE_COOKIE_DOMAIN`
- **`extension/scripts/check-i18n.mjs`** — paridade pt_BR ⇄ en e toda chave usada (`t()`, `data-i18n`, `data-i18n-attr`, `err_<SyncErrorCode>`) existe
- **`extension/README.md`**, **`docs/extensao-navegador.md`**, **`AGENTS.md`** — como rodar, variáveis, fluxo, contrato com a API (a rota `PUT …/session` ainda não existe — pendência de `.specs/features/affiliate-credentials`), sistema de proteção e publicação
- **`extension/src/popup/`** (`popup.html`, `popup.css`, `index.ts`, `view.ts`, `theme.ts`, `relativeTime.ts`) — popup redesenhado: tokens de cor da paleta do painel, tema sistema/claro/escuro (`prefers-color-scheme` + `data-theme` persistido), tooltips `tippy.js`, foco visível, `prefers-reduced-motion`, telas de login e de sessão (status, última sincronização relativa, seletor de espaço, etiqueta de afiliado, sair); só `textContent`/`createElement`, nunca `innerHTML`
- **`extension/public/_locales/{pt_BR,en}/messages.json`**, **`extension/src/core/i18n.ts`** — i18n nativo do Chrome; manifest usa `__MSG_*`; `t()` e `applyI18n()` com `data-i18n`/`data-i18n-attr`
- **`extension/public/manifest.json`** — chave `key` para ID estável (privada em `extension/.keys/*.pem`, ignorada); sem `update_url`; ícones gerados de `app/public/assets/brand/logo-source.png`
- **Revisão pós-implementação** — `apiClient.ts`: refresh recusado (401) limpa auth, refresh falho por rede/5xx não desloga; `API_URL` exige `https:` fora de DEV; `logout` revoga o refresh token em `POST /auth/logout` antes de limpar o storage; `authStore.ts`: escritas serializadas em fila (tema e etiqueta gravavam em paralelo e uma perdia), `applyRenewedAccessToken` não ressuscita sessão após logout/troca de tenant, `syncing` com mais de 5 min vira `idle` (service worker morto no meio); `index.ts`: popup recebe `AuthSummary` sem tokens, content script (`sender.tab`) não fala com o canal, `syncing` resetado em `onStartup`/`onInstalled`; `popup/index.ts`: etiqueta só marca "salva" após resposta ok e mostra erro inline
- **`api/package.json`**, **`app/package.json`** — `0.17.5` → `0.17.6`
- **Pendências** — rota `PUT …/affiliate-credentials/MERCADO_LIVRE/session` na API (T7b da spec), smoke com extensão carregada, nova listagem na Web Store, testes unitários: lista completa em `docs/extensao-navegador.md` → *Pendências*

### Removed

#### Extensão legada (`extension/iiobglifbapgfafnghkcakggkcaddpap/`)

- Pacote baixado da Web Store ("Redirect Flow") sai da pasta `extension/`; cópia preservada em `legadoML/`. Removidos com ele `_metadata/verified_contents.json` (assinatura da loja, inválida após edição) e `update_url` da listagem antiga, que fariam o Chrome auto-atualizar para pacote de terceiro

#### Docs — planos Starter/Profissional/Business e carga por plano (`0.17.5`)

- **`docs/produto-roadmap.md`** — planos reescritos conforme a tabela de venda (Starter R$ 97, Profissional R$ 167, Business R$ 247; limites por canal, Telegram a partir do Profissional, Template Instagram exclusivo do Business); funcionalidades 14-16 (menção a todos, domínio personalizado, níveis de suporte) e entitlements `mention_all_enabled`, `custom_domain_enabled`, `support_tier`; nova seção "Carga por plano" com sessões, msgs/dia e posts/dia por tenant e mix de referência para 1.000 tenants
- **`docs/arquitetura-escala.md`** — meta de dimensionamento recalculada pelos planos (~1.150 sessões WhatsApp + 650 Telegram para 1.000 tenants); gargalo identificado como envio em rajada nas janelas agendadas

#### Docs — estratégia de escala (`0.17.4`)

- **`docs/arquitetura-escala.md`** — novo: diagnóstico do acoplamento a processo único (registry Baileys, lease inexistente, WS/SSE e fila in-memory, mídia em disco), comparação com `legado1`/`legado2`, limites físicos por processo, arquitetura alvo (lease de sessão, shard, `PROCESS_ROLE` http/worker, BullMQ, Redis pub/sub, S3/R2), ordem de entrega em fases e escada de servidores Render × Hetzner+Coolify. Registra o estado da Render (disco em `/var/data`, Postgres compartilhado com o PulsoSocial) e a tabela de planos por faixa de sessões; seção 7 lista o que o adapter Baileys e o módulo `chat` gastam além do que o roadmap de afiliados exige (ingestão 1:1, presença, reações, avatares, blob único de auth state) e a ordem de corte

#### Chat — @menção resolvida (recebimento) e estruturada (envio) (`0.17.0`)

- **`api/src/modules/messaging/infrastructure/engines/baileys/BaileysMessagingEngineAdapter.ts`** — `extractBaileysMessage` passa a capturar `contextInfo.mentionedJid`; novo `resolveMentionsInBody` troca `@<lid>` pelo telefone real via `signalRepository.lidMapping` (mesmo padrão já usado para participante de grupo) antes de persistir/emitir a mensagem recebida. Corrige menção exibida como LID cru em vez do contato
- **`BaileysMessagingEngineAdapter.ts`** (`0.17.3`) — `resolveMentionsInBody` cai no metadata do grupo (`GroupMetadataSnapshot.lidToPhone`, montado de `participants[].id/lid + phoneNumber`) quando `signalRepository.lidMapping` não conhece o LID: o store só mapeia quem já trocou chaves com a sessão, então menção vinda de outro aparelho (WhatsApp Web) a um terceiro do grupo chegava ao painel como `@<LID>`. O metadata já é buscado e cacheado pelo roteamento da própria mensagem — sem ida extra à rede
- **`api/src/modules/messaging/domain/contracts/IMessagingEngine.ts`**, **`BaileysMessagingEngineAdapter.sendTextMessage`** — novo campo `mentions?: string[]` (telefones); convertido para JID e repassado em `socket.sendMessage(jid, { text, mentions })`, habilitando menção estruturada (destaque real no WhatsApp) no envio pelo painel
- **`api/src/modules/chat/application/use-cases/SendMessageUseCase.ts`**, **`chat.schema.ts`**, **`chat.routes.ts`** — `SendMessageInput`/body da rota `POST /conversations/:id/messages` aceitam `mentions` (array de telefones, `additionalProperties: false` mantido)
- **`app/src/features/chat/components/MessageComposer.tsx`** — digitar `@` numa conversa de grupo abre popover de participantes (busca com debounce via `chatService.listGroupParticipants`); selecionar insere `@<telefone>` no texto. `extractMentionPhones` lê o texto final no envio — único ponto que decide o que vira menção, então editar/apagar o `@<telefone>` depois de inserido também remove a menção
- **`app/src/services/chat.service.ts`**, **`app/src/pages/ChatPage.tsx`**, **`app/src/features/chat/components/ChatWindow.tsx`** — `mentions` passado ponta a ponta do composer até a chamada HTTP
- **`app/src/features/chat/strings.ts`** — novas strings em `chatStrings.mention` (popover de autocompletar), seguindo o padrão de chaves semânticas do arquivo
- **`app/src/features/chat/mentions.ts`** (`0.17.2`) — `splitMentions`/`extractMentionPhones` e `MentionNamesContext` (telefone → nome dos participantes da conversa aberta, montado em `ChatPage` como `participantNames` e provido em `ChatWindow`). **`RichMessageText.tsx`** renderiza `@<telefone>` conhecido como `@Nome` em destaque, como o WhatsApp Web; desconhecido segue como número. **`MessageComposer.tsx`** mostra `@Nome` no campo e converte para `@<telefone>` só no envio (`resolveMentionsForSend`) — o texto gravado e o enviado ao WhatsApp seguem com o telefone, que é o formato que todo cliente resolve de volta

#### Login — vídeo ambiente no painel desktop (`0.16.0`)

- **`app/src/pages/login/LoginAmbientVideo.tsx`** — novo: poster + `<video muted loop playsInline>` em loop atrás do overlay navy; montado após o primeiro paint (`requestIdleCallback`), fade de 600 ms no `canplay`, pausa com a aba oculta e retoma ao voltar, `ended` reinicia o loop, `play()` rejeitado cai no poster. Hook `useAmbientVideoAllowed` desliga o vídeo fora do desktop (md+), com `prefers-reduced-motion`, `Save-Data` e rede 2g
- **`app/src/pages/login/LoginShowcasePanel.tsx`**, **`loginContent.ts`** — painel desktop usa o vídeo (`LOGIN_IMAGES.ambient*`); mobile segue com a foto
- **`app/src/pages/login/loginReveal.ts`** — novo: keyframe `loginRise` (sobe 14 px, fade, blur 6 px → 0, 520 ms, ease-out cúbico) e `revealSx(delay)`; estado final = estado natural (sem opacidade 0 fora do keyframe) e `animation: none` em `prefers-reduced-motion`
- **`LoginShowcasePanel.tsx`**, **`LoginMobileBanner.tsx`** — reveal escalonado no load: headline palavra a palavra (70 ms), subtítulo aos 420 ms, índice 01–05 e prova social a partir de 600 ms com 60 ms por item; logo não anima. Mobile só fade/rise da headline curta. Substitui a animação única do bloco
- **`app/public/assets/login/team-ambient.{mp4,webm}`**, **`team-poster.webp`**, **`CREDITS.md`** — clipe Pexels (Ivan S, Pexels License), 12 s com crossfade de loop, 1280×720, ≈ 1 MB cada; comandos de troca em `docs/rebranding-copysync.md`

### Changed

#### Login — índice editorial no lugar das cápsulas (`0.15.1`)

Os 5 benefícios deixam de ser chips e viram um índice numerado que conta o fluxo do produto
em ordem (conectar → contas de afiliado → IA → horário → rodízio), sem fundo nem ícone.

- **`LoginShowcasePanel.tsx`** — `<ol>` com `01`–`05` em fonte tabular (branco α 0,55), rótulo 600, fios de 1 px (α 0,14); hover: número em `primary.light` e fio que cresce da esquerda (240 ms, desligado em `prefers-reduced-motion`); hint via `Tooltip describeChild` + texto só para leitor de tela; itens não focáveis
- **`loginContent.ts`** — `LoginBenefit` vira `{ label, hint }`, ícones removidos
- **`api/package.json`**, **`app/package.json`** — `0.15.0` → `0.15.1`

### Added

#### Login humanizada e premium em proporção áurea (`0.15.0`)

Tela de login com foto real de equipe, prova social e layout em proporção áurea, alinhada ao
propósito do produto (afiliados publicando ofertas). Validada em claro, escuro e mobile.

- **`app/src/pages/login/goldenRatio.ts`** — novo: `PHI`, divisão 61,8/38,2, tipografia 16/26/42 e espaçamentos 8×φⁿ; comentários no código indicam cada aplicação
- **`app/src/pages/login/loginContent.ts`** — novo: copy, `LOGIN_BENEFITS` (ícone + `Tooltip describeChild`) e caminhos das fotos; **`LoginShowcasePanel.tsx`** (desktop) e **`LoginMobileBanner.tsx`** (xs/sm) — novos
- **`LoginPage.tsx`** — grid áureo, card com blur e borda translúcida, reveal único desligado em `prefers-reduced-motion`, `aria-label` no toggle de tema e no olho da senha; `handleSubmit`, `IS_DEV`, `BrandLogo` e `APP_NAME` intactos
- **`app/public/assets/login/`** — `team-hero.webp` (~96 KB, `fetchPriority="high"`, dimensões reservadas) e 3 avatares (~3 KB, lazy), Unsplash License; autores e links em `CREDITS.md`
- **`docs/rebranding-copysync.md`** — subseção *Tela de login* (layout, fotos, como trocar)
- **`api/package.json`**, **`app/package.json`** — `0.14.2` → `0.15.0`

### Changed

#### Logo com fundo transparente (`0.14.2`)

- **`app/public/assets/brand/`** — fonte substituída pela versão com fundo transparente (128×128) e todos os derivados regenerados (favicon 16/32/ico, apple-touch 180, ícones 192/512, `logo-512`). Tamanhos acima de 128 px são ampliados; trocar por fonte maior quando houver
- **`api/package.json`**, **`app/package.json`** — `0.14.1` → `0.14.2`

#### Login alinhado ao posicionamento do produto (`0.14.1`)

O painel esquerdo do login falava em "CRM, chatbots e métricas" (herança do projeto original).
Agora apresenta o que o produto faz: ofertas de afiliado publicadas no automático. Copy produzida
com a skill de copywriting; visual sem roxo, só azuis da marca.

- **`docs/produto-roadmap.md`** — novo: funcionalidades, planos (Básico/Plus/Pro) com limites por tenant, chaves de entitlement sugeridas, ordem de entrega e copy de referência; **`AGENTS.md`** — ponteiro na seção *Marca e domínios*
- **`LoginPage.tsx`** — headline "Suas ofertas de afiliado publicadas no automático", subtítulo e 5 provas em `LOGIN_BENEFITS` (WhatsApp e Telegram, Shopee/Mercado Livre/Amazon, reescrita com IA, horário programado, rodízio de links), cada uma com ícone MUI e `Tooltip describeChild` focável por teclado; gradiente `#0b1a4a → #15307e → primary.main`; brilhos radiais `aria-hidden` no lugar dos círculos sólidos; "Bem-vindo de volta" vira `h1`
- **`api/package.json`**, **`app/package.json`** — `0.14.0` → `0.14.1`

#### Rebranding → CopySync — fase 2, painel (`0.14.0`)

Tela de login, sidebar, título da aba, favicon, apple-touch-icon e manifest PWA passam a usar a
marca CopySync. O nome do produto sai de uma constante única e o logo de um componente, então
nenhuma tela repete a string da marca (white label).

- **`app/src/shared/branding/brand.ts`** — novo: `APP_NAME` e caminhos dos assets de marca
- **`app/src/shared/branding/BrandLogo.tsx`** — novo: logo em tile branco arredondado com borda sutil; o PNG tem fundo branco, o tile mantém contraste igual sobre o gradiente do login e nos temas claro/escuro
- **`app/public/assets/brand/`** — fonte 1254 px e derivados (512, 192, 180, 32, 16, `.ico`) gerados com Pillow; **`app/public/site.webmanifest`** — novo, ícones 192/512 e cores de tema
- **`app/index.html`** — `<title>CopySync</title>`, `favicon.ico` + PNG 32/16, apple-touch-icon, link do manifest; `data-app="copysync"` (o `DomGuardian` valida só a presença do atributo, não o valor)
- **`LoginPage.tsx`** — logo e nome no painel esquerdo, cabeçalho mobile (substitui o tile "W" por `BrandLogo`) e rodapé via `APP_NAME`
- **`AppLayout.tsx`** — logo/nome da sidebar, tooltip de versão e rótulo padrão via `APP_NAME`; chave `localStorage` `waioprime-sidebar-collapsed` → `sidebar-collapsed` (usuário perde só a preferência de sidebar recolhida)
- **`conversations.mock.ts`**, **`resolveMediaUrl.ts`**, **`DomGuardian.ts`** — textos de mock e comentários
- **`app/.env.dev`** — comentário neutro; `VITE_DEV_PROXY_TARGET` segue na API atual com TODO até `api.copysync.app` existir
- **`app/package.json`** — `"name"` → `copysync-app`; **`api/package.json`**, **`app/package.json`** — `0.13.1` → `0.14.0`

### Removed

- **`app/public/assets/logo_waiochat.png`**, **`waioFavicon-256x256.png`**, **`waioLogo-256x256.png`**, **`waiochat-pro*.png`**, **`copysync-logo*.png`** (raiz) — substituídos por `assets/brand/`

#### Rebranding → CopySync — fase 1, documentação (`0.13.1`)

O projeto é cópia do WaioPrime e passa a se chamar **CopySync** (painel `https://copysync.app`,
API `https://api.copysync.app`). Nesta fase só documentação, assets e caminhos de clone mudam;
nenhum identificador de código, banco, Keychain ou container foi renomeado. Plano por fase e lista
do que **não** renomear em `docs/rebranding-copysync.md`.

- **`docs/rebranding-copysync.md`** — novo: identidade, fases 2–4 (painel, API, tooling) com arquivo e troca exata, itens proibidos (banco de produção `waioprime`) e comando de verificação
- **`AGENTS.md`** — seção *Marca e domínios* apontando para o guia
- **`README.md`**, **`api/README.md`**, **`.cursor/MCP_SETUP.md`**, **`.github/MCP_SETUP.md`**, **`api/db.instructions.md`**, **`.specs/features/service-desk/integracao-api-central.md`** — prosa, domínios e caminho do clone (`~/www/copysync`); dump local passa a `copysync-local.sql`
- **`.cursor/plans/rules_skills_mcps_copysync_c5f11ded.plan.md`** — renomeado (era `…_waioprime_…`); nomes propostos de rules/skills `copysync-*`
- **`.cursor/scripts/mcp/waioprime-mcp.zsh`** — alias `cw` abre `~/www/copysync` (caminho antigo não existe); reinstalar com `install-mcp-scripts.sh`
- **`app/public/assets/copysync-logo.png`**, **`copysync-logo-256x256.png`** — logo oficial (ainda não referenciado pelo painel; fase 2)
- **`render.yaml`** — só o comentário de cabeçalho; serviço continua `waioprime`
- **`api/package.json`**, **`app/package.json`** — `0.13.0` → `0.13.1`

### Added

#### Chat — Listas na barra de filtros e emoji no composer (`0.13.0`)

Chip ▾ ao fim da faixa `Tudo · Não lidas · Favoritas · …`, como no WhatsApp Web: abre as listas
do painel (ordem alfabética, com contagem) e "Nova lista". Com uma lista ativa o chip mostra o
nome e a contagem. A lista tem registro próprio no catálogo do tenant (`/api/chat/lists`): pode
ficar vazia, e renomear/excluir alcançam todas as conversas, não só as carregadas no painel.

- **`conversationFilters.ts`** (+ teste) — filtro `list:<nome>` (`listFilter`/`listFilterName`), `collectKnownLists`, `countInList` e `validateListName` (aparado, ≤ 40, sem repetir sem diferenciar maiúsculas); **`types.ts`** — `ConversationFilter` = `ConversationStatusFilter | ConversationListFilter`
- **`ConversationSidebar.tsx`** — chip ▾ (`aria-haspopup="menu"`), menu das listas e diálogo; props `knownLists` e `onCreateList(name, ids)` (sem o callback o chip não aparece)
- **`NewListDialog.tsx`** (+ teste) — nome com validação inline, busca, conversas com checkbox e contador; Criar só com nome válido e ≥ 1 conversa; tela cheia no mobile
- **`ChatPage.tsx`** — `handleCreateList`: otimista + `updateConversationState` em lote (`allSettled`); as que falham voltam e o snackbar avisa; o filtro da lista liga se alguma entrou
- **Editar e excluir lista** — ⋮ em cada item do menu ▾ (`aria-label` "Ações da lista <nome>") e, com uma lista ativa, um ⋮ ao lado do chip abre "Editar lista"/"Excluir lista". Editar reabre o `NewListDialog` em `mode="edit"` (nome e conversas pré-preenchidos; o próprio nome não conta como repetido; Salvar envia o conjunto final). Excluir pede confirmação no **`components/ConfirmDialog.tsx`** (novo, genérico; botão `error`). **`conversationFilters.ts`** — `planListUpdate(conversations, oldName, newName | null, memberIds)` (+ teste): regra pura que devolve só as conversas que mudam; `null` exclui. **`ChatPage.tsx`** — `commitListPlan` reúne o lote otimista + `allSettled` + reversão parcial + snackbar (`lists.updatePartialFailure`) e serve a criar/editar/excluir; `handleUpdateList` troca o filtro `list:antigo` por `list:novo`, `handleDeleteList` volta a Todos. Só as conversas carregadas no painel são regravadas — uma fora dele (outra sessão, arquivada) mantém o nome antigo
- **Catálogo de listas** — o painel passa a usar `GET/POST/PATCH/DELETE /api/chat/lists` em vez de tratar a lista como só o nome gravado em cada conversa. **`chat.api.types.ts`** — `ChatListDto` (`id: string | null`, `name`, `conversationCount`; `id: null` = nome antigo ainda só em `tags`) e `ChatListRef`; **`chat.service.ts`** — `listLists`, `createList`, `renameList(ref, newName)` (por id ou `by-name`), `deleteList(ref)`. **`ChatPage.tsx`** — estado `lists` carregado com as conversas e recarregado após criar/renomear/excluir e após mudar `lists` de uma conversa; `knownLists` = catálogo ∪ conversas carregadas; `handleCreateList` cria no catálogo **antes** de gravar membros (lista vazia persiste); `handleUpdateList` renomeia pela API (cascata em todas as conversas do tenant) e só depois grava a diferença de membros; `handleDeleteList` exclui pela API e espelha localmente. Sem fallback: se a API falhar, nada muda e o snackbar avisa (`lists.errors.*`; 409 → "Já existe uma lista chamada …"). **`conversationFilters.ts`** (+ teste) — `planListUpdate` deu lugar a `planListMembers(conversations, name, memberIds)` (só pertença, nunca renomeia) e aos espelhos `applyListRename`/`applyListRemoval`. **`ConversationSidebar.tsx`** (+ teste) — prop `lists: Array<{ name; count }>`: contagem do ▾, do chip ativo e da confirmação de exclusão vêm do catálogo. **`NewListDialog.tsx`** (+ teste) — criar/editar sem exigir conversa marcada
- **`strings.ts`** — grupo `lists` (+ `errors`, textos de lista vazia)
- **API — catálogo de listas** (`api/`) — migration **`20260925180000_add_chat_lists`**: tabela `chat_lists` (`tenantId`+`name` únicos, FK cascade) e GIN em `chat_conversations.tags`; aditiva, dado antigo em `tags` segue válido. Rotas `/api/chat/lists`: `GET` (catálogo ∪ nomes só em `tags`, com `conversationCount`, ordem alfabética; sem entrada → `id: null`), `POST { name }` (201; repetido → 200), `PATCH /:id { name }` e `PATCH /by-name { name, newName }` (renomeia + cascata em `tags` sem duplicar; colisão → 409 `CONFLICT`), `DELETE /:id` e `DELETE /by-name/:name` (204, cascata). Novos **`ChatList.ts`**, **`IChatListRepository.ts`**, **`PrismaChatListRepository.ts`**, **`chatConversationTagsSql.ts`** (`array_replace`/`array_remove` na transação do catálogo), `normalizeChatListName.ts`, use cases `ListChatLists`/`CreateChatList`/`RenameChatList`/`DeleteChatList` (+ testes de use case e de rota); `replaceTag`/`removeTag` em `IChatConversationRepository`. **`UpdateConversationStateUseCase.ts`** garante a entrada no catálogo de cada nome em `lists` (`ensure`). Doc: `docs/chat-listas.md`
- **`MessageComposer.tsx`** — botão de emoji habilitado: abre o `EmojiPicker` das reações num popover acima do botão, insere na posição do cursor (substitui seleção), mantém o foco no campo e o popover aberto para escolher mais; desabilitado com conversa encerrada ou barra de voz aberta

#### Chat — Anexos e mensagem de voz (`0.12.0`)

O operador envia documento, foto, vídeo (até 180 MB) e mensagem de voz gravada no navegador, em
lote, com legenda, arrastar e colar. O arquivo sobe em partes retomáveis; a mensagem nasce
`PENDING` e vira `SENT` (ou `FAILED`, com reenvio) quando o WhatsApp aceita. Versão `0.11.2` →
`0.12.0` em `api/` e `app/`. Doc: `docs/chat-midias-anexos.md`.

Migration **`20260925120000_add_pending_chat_message_status`** (aditiva: só `ALTER TYPE ... ADD
VALUE 'PENDING'`, no fim do enum). Env novas, todas opcionais (tabela na doc): `MEDIA_UPLOAD_*`,
`MEDIA_DISK_RESERVE_BYTES`, `MEDIA_TMP_RESERVE_BYTES`, `MEDIA_MAX_*`, `MEDIA_SEND_*`,
`MEDIA_PROCESS_CONCURRENCY`, `MEDIA_ECHO_*`, `MEDIA_PENDING_*`, `FFMPEG_PATH`/`FFPROBE_PATH`.
**Na Render: `MEDIA_PENDING_RECOVERY_ENABLED=true`** (padrão `false`: `api/.env` aponta para
produção). ffmpeg/ffprobe vêm do runtime nativo da Render (5.1.9 com `libopus`); `api/Dockerfile`
instala só para o `docker-compose` local.

##### api/

- **`prisma/schema.prisma`**, **`ChatMessageEnums.ts`**, **`IChatMessageRepository.ts`**, **`PrismaChatMessageRepository.ts`** — `PENDING`; `create` com status opcional (texto e recebidas seguem `SENT`); `transitionStatus` condicional (`SENT` tardio não sobrescreve `DELIVERED`) e `failPending` para a recuperação
- **`shared/errors/internal/MediaErrors.ts`** — oito erros de mídia/upload (AGENTS.md §13); **`shared/http/httpResponse.ts`** ganha `accepted` (202)
- **`shared/config/env.ts`** — env de mídia; pasta de upload derivada de `STORAGE_PATH`, fora da raiz estática (`media-uploads/` no `.gitignore`/`.dockerignore`)
- **`modules/media/domain/services/`** — regras puras com teste: `sniffMediaType` (magic bytes), `classifyOutboundMedia`, `sanitizeFileName`, `uploadPlan`, `diskBudget` (limites relativos ao disco), `mediaUploadConfig`, `parseProbeOutput`, `buildWaveform`
- **`media/infrastructure/uploads/DiskUploadSessionStore.ts`**, **`UploadSessionSweeper.ts`** — `.bin` esparso + lateral JSON atômico, mutex por upload; varredura de expirados e alerta de disco baixo
- **`media/application/use-cases/`** (criar, receber parte, consultar, cancelar, config) + **`media/presentation/routes/media.upload.routes.ts`** — `/media/uploads`, com parser `octet-stream` isolado no plugin e sem `bodyLimit` na rota
- **`media/infrastructure/storage/LocalMediaFileStore.ts`** — promoção por `rename` (`EXDEV` → cópia por stream) com a mesma regra de nome do download
- **`media/infrastructure/ffmpeg/`** (`FfmpegMediaProcessor`, `ffmpegArgs`, `runProcess`) — voz Ogg/Opus, probe, miniatura e ondas; `spawn` sem shell, whitelist de protocolo e demuxer, timeout com `SIGKILL`, capacidades detectadas no boot
- **`media/infrastructure/mediaContainer.ts`**, **`chat/infrastructure/chatMediaContainer.ts`** — singletons compartilhados pelas rotas de `media` e `chat`
- **`chat/application/use-cases/SendMediaMessageUseCase.ts`**, **`chat.routes.ts`**, **`chat.schema.ts`** — `POST /conversations/:id/messages/media`: id pré-gerado, classifica, grava `PENDING`, enfileira; 202 (200 se repetida)
- **`chat/infrastructure/queue/InMemoryOutboundMediaQueue.ts`**, **`DispatchOutboundMediaUseCase.ts`**, **`IOutboundMediaQueue.ts`**, **`IMessageStatusPublisher.ts`** — fila serial por conversa (2 por sessão, 2 no total) e despacho em `try/finally`, publicando `SENT`/`FAILED`
- **`RetryOutboundMediaUseCase.ts`** — `POST /messages/:messageId/retry`, reusa o id gravado
- **`FailOrphanPendingMediaUseCase.ts`**, **`ReconcileInterruptedUploadsUseCase.ts`**, **`app/server.ts`** — recuperação de `PENDING` atrás de flag (boot + a cada 5 min), reconciliação de uploads interrompidos, `drain` de 25 s no shutdown
- **`IMessagingEngine.ts`**, **`BaileysMessagingEngineAdapter.ts`**, **`buildBaileysMediaContent.ts`** — `createOutboundMessageId` e `sendMediaMessage` por arquivo (`{ url }`, stream), com duração, dimensões, miniatura, `waveform`, citação pelo mesmo `buildQuoted` do texto e checagem do `maxContentLengthBytes`
- **`isOwnOutboundEcho.ts`**, **`sentMediaCache.ts`** — eco da mídia própria descartado antes do download; `getMessage` responde pedido de reenvio da mídia enviada (grupo sem "Aguardando esta mensagem")

##### app/

- **`services/media.service.ts`**, **`services/chat.service.ts`**, **`types/media.api.types.ts`**, **`types/chat.api.types.ts`**, **`features/chat/types.ts`** — upload (`Content-Type` binário por chamada, `signal`, 120 s por parte), `sendMediaMessage`, `retryMessage`; `PENDING` → `sending`
- **`features/chat/media/chunkedUpload.ts`** — partes com retry exponencial por até ~3 min e retomada
- **`mediaPolicy.ts`**, **`dataTransferFiles.ts`** — espelho da classificação (tipo e tamanho) e arquivos de arrastar/colar
- **`outgoingMediaState.ts`**, **`useOutgoingMedia.ts`**, **`useMediaUploadConfig.ts`** — bolhas otimistas sobrepostas à lista, status antecipado do WS, decisões por `error.code`
- **`components/AttachmentMenu.tsx`**, **`AttachmentPreviewPanel.tsx`**, **`DropZoneOverlay.tsx`** — menu do clipe, prévia do lote com legenda por item, área de soltar
- **`messages/UploadProgressOverlay.tsx`**, **`messages/FailedMessageActions.tsx`**, **`MessageBubble.tsx`** — progresso, cancelar, tentar de novo e descartar na bolha
- **`MessageComposer.tsx`**, **`ChatWindow.tsx`**, **`MessageList.tsx`**, **`pages/ChatPage.tsx`**, **`strings.ts`** — clipe, colar, soltar e prévia integrados; textos centralizados
- **`voiceRecorderMachine.ts`**, **`pickRecorderMimeType.ts`**, **`useVoiceRecorder.ts`**, **`components/VoiceRecorderBar.tsx`** — voz: formato por navegador, ondas, pausar/retomar, pré-escuta e barra no lugar do composer. Microfone só com campo vazio; trocar de conversa gravando vira rascunho da conversa. O gravador vive num provider próprio (**`media/VoiceRecorderProvider.tsx`**), fora do `ChatPage` (o estado por quadro não re-renderiza a lista); soltar arquivo fica bloqueado com a barra aberta
- **`messages/AudioMessage.tsx`**, **`media/audioWaveform.ts`**, **`media/activeAudio.ts`** — bolha de áudio no estilo do WhatsApp Web: avatar do remetente (selo de microfone em nota de voz), play/pause, onda de 44 barras com trecho tocado e cursor arrastável (seek por clique/teclado), tempo corrente e velocidade 1×/1,5×/2×; onda real decodificada por Web Audio ao entrar no viewport (cache por URL) com onda provisória determinística por id enquanto isso (Safari fica na provisória); um áudio toca por vez
- **`messages/DocumentMessage.tsx`**, **`media/useMediaFileSize.ts`** — cartão de documento horizontal compacto: ícone por tipo com a extensão, nome em uma linha, subtítulo `ZIP • 2 MB` (tamanho por `HEAD` sob demanda, cache por URL) e botão de download; PDF/imagem/texto abrem em nova aba, o resto baixa. Download com o nome original: a API está em outra origem e o navegador ignora o `download` de link cross-origin, então o cartão passa `?name=` e a rota estática responde `Content-Disposition` com `filename*` (`app.ts`, `staticMediaPolicy.ts`)

### Fixed

#### Chat — `@Nome` na prévia da lista e resiliente à sessão fora (`0.17.5`)

O balão já exibia `@Nome`, mas a prévia da lista seguia com `@<telefone>` (a lista não tem os
participantes de cada grupo) e, com a sessão desconectada, até o balão voltava ao número porque
`listGroupParticipants` falha sem socket. Portado do `waioprime` e estendido.

- **`api/src/modules/chat/domain/services/resolveMentionNames.ts`** (+ teste) — função pura: `extractMentionPhonesFromText` e `resolveMentionNames` (`@<telefone>` → `@Nome` só com fronteira de espaço)
- **`api/src/modules/chat/application/use-cases/ListConversationsUseCase.ts`** — resolve os telefones mencionados nas prévias de grupo pelo contato do tenant numa única `findByPhones`; o valor gravado segue com o telefone
- **`app/src/features/chat/mentions.ts`** (+ teste) — `applyMentionNames`; **`ConversationListItem.tsx`** aplica na prévia de grupo via `useMentionNames`
- **`app/src/pages/ChatPage.tsx`** — `knownMentionNames` acumula contatos das conversas individuais carregadas + participantes de todo grupo aberto (participante vence no mesmo telefone) e alimenta tanto a `ConversationSidebar` quanto o `ChatWindow`; nomes seguem no balão mesmo sem a lista de participantes
- **`docs/chat-mencoes.md`** — novo: formato canônico, fluxo de recebimento/envio, painel, limites e o que não fazer

#### Sessions — sessão morria após dois deploys seguidos (`0.17.1`)

Sintoma: após o deploy, "Nenhum participante disponível" nos grupos e envio recusado — a única
sessão conectada constava `FAILED` no banco, com `lastConnectedAt` 379 ms antes do `FAILED`.

- **`api/.../baileys/BaileysErrorTranslator.ts`** — `translateDisconnect` passa a devolver `takenOverByAnotherInstance`, verdadeiro só para `connectionReplaced` (440). Só outra instância desta API consegue tomar a sessão com as mesmas credenciais (overlap do deploy na Render, ou API local apontando para o mesmo banco)
- **`api/.../baileys/BaileysMessagingEngineAdapter.ts`** — no `close` com a sessão tomada, o socket perdedor limpa o registro e sai sem gravar status nem emitir `SESSION_DISCONNECTED`. Antes gravava `FAILED` por cima do `CONNECTED` que a instância nova acabara de escrever; o bootstrap do deploy seguinte só reconecta `CONNECTED`, então pulava a sessão e ela ficava morta até reconexão manual. Teste em `BaileysErrorTranslator.test.ts`

#### Chat — Anexos e mensagem de voz (`0.12.0`)

- **`OutboundEchoRegistry.ts`**, **`outboundEchoRegistries.ts`**, **`BaileysMessagingEngineAdapter.ts`** — o registro de eco era por instância do adapter e há duas no processo: com o bootstrap ligado, a reação registrava numa e o eco chegava na outra. Agora é de módulo (`ReactionEchoRegistry.ts` reexporta)
- **`api/src/app/app.ts`**, **`shared/storage/staticMediaPolicy.ts`** — `/api/storage/` servia a raiz inteira: restrita a `media/` com caminho normalizado (`/media/../x` passava), `dotfiles: 'deny'` e `Content-Disposition: attachment` fora da allowlist inline (svg/html/xml abriam na origem da API)
- **`SetMessageReactionUseCase.ts`**, **`MessageBubble.tsx`** — reação recusada (409) em mensagem `PENDING`/`FAILED`: o id pré-gerado existe antes de a mensagem chegar ao WhatsApp. No painel, reagir e responder ficam ocultos em envio/falha
- **Revisão pós-implementação (api)** — `CreateUploadSessionUseCase.ts`/`env.ts`: teto de bytes abertos por usuário e mutex na criação (um operador podia reservar o disco inteiro e negar upload a todos os tenants); `media.upload.routes.ts`: vagas de partes em andamento adquiridas em `onRequest` (PUTs paralelos de 8 MiB podiam esgotar a memória); `DiskUploadSessionStore.ts`/`CancelUploadSessionUseCase.ts`: cancelar durante o consumo marca o upload e responde 409 (antes era ignorado e a mídia saía mesmo "cancelada"); varredura reconfere sob o mutex e nunca apaga `CONSUMING`; reconciliação reabre upload intacto em vez de apagar; `.bin` da voz sai após o consumo; `SendMediaMessageUseCase.ts`: documento não roda probe e probe que falha em foto/vídeo vira documento (antes 422); voz não grava legenda que o WhatsApp não recebe; `PrismaChatMessageRepository.ts`: varredura de pendentes lê a fila depois do `select` (reenvio podia voltar a `FAILED` enquanto era enviado); `sniffMediaType.ts`/`mediaFileExtension.ts`: subtipo declarado e extensão só com caracteres seguros, `ftyp` desconhecido não vira `video/mp4`, `avif`; voz só com ffmpeg **e** ffprobe
- **`ConversationSidebar.tsx`**, **`types.ts`** — filtro **Favoritas** na barra de conversas (a marcação existia no painel lateral e no menu, mas não havia como filtrar por ela)
- **Revisão pós-implementação (app)** — `OutgoingMediaProvider.tsx`/`VoiceRecorderProvider.tsx`/`AppLayout.tsx`: sair da tela do chat cancelava todos os envios e a gravação (providers sobem para o layout; logout/troca de tenant abortam); `messagesMerge.ts`/`ChatPage.tsx`: mídia confirmada com a conversa ainda carregando sumia; resync recarrega a conversa aberta (mídia `PENDING` ficava presa sob o véu); progresso limitado a ~4/s e `MessageBubble` memoizado (a página re-renderizava a cada 1%); `useMediaUploadConfig.ts`: tenta de novo e recarrega ao focar; `mediaSendRunner.ts`: consulta o GET do upload antes de reconfirmar/descartar (resposta perdida podia descartar mídia já enviada ou duplicá-la); `chunkedUpload.ts`: timeout por inatividade (60 s) em vez de 120 s pela parte inteira (uploads lentos nunca terminavam); colar do Office cola o texto; menu vazio some; rascunho de voz não envia em conversa encerrada

#### Chat — Responder volta a citar a mensagem no WhatsApp (`0.11.1`, `0.11.2`)

Regressão: `b45f4e7` ("simplifica adapter — remove grupos, midia, avatares e reply") tirou o
`quoted` do envio; grupos, mídia e avatares voltaram depois, a citação não. O painel continuava
mostrando o bloco citado (vínculo gravado localmente), então a falha só aparecia no celular do
contato. Versão `0.11.0` → `0.11.1` em `api/` e `app/`.

- **`api/.../engines/baileys/buildBaileysQuotedMessage.ts`** — novo, puro: monta a key e o conteúdo mínimo da citada (nunca vazio — `proto` descarta campo vazio e a lib quebra, lição de `dea6c36`). Não cita quando a referência é de outra conversa (viraria "citação de outro chat") nem em grupo sem autor conhecido (o Baileys atribuiria a citação ao próprio grupo). Teste inclui contrato com o `generateWAMessage` real da lib
- **`api/.../engines/baileys/BaileysMessagingEngineAdapter.ts`** — `sendTextMessage` passa `{ quoted }`; a citação nunca derruba o envio (sem citação possível, sai sem ela e loga o motivo)
- **`api/.../messaging/domain/contracts/IMessagingEngine.ts`** — `QuotedMessageRef.participant` (opcional)
- **`api/.../chat/application/use-cases/resolveConversationTarget.ts`** — referência em grupo leva o autor (`fromParticipant`) quando a citada não é nossa; a reação monta o próprio alvo e não muda
- **`api/.../chat/application/use-cases/SendMessageUseCase.ts`** — vínculo só com a citada encontrada **nesta** conversa (antes, id não encontrado ia para o `create`, que resolve também por `externalMessageId` em todo o tenant e podia ligar a resposta a outro chat); citada apagada não vai ao WhatsApp (a linha guarda o id da revogação e nenhum conteúdo — o contato veria citação em branco), mas o vínculo no painel continua. Primeiro teste do use case (`SendMessageUseCase.test.ts`), cobrindo citação e o comportamento de envio mantido
- **`app/src/features/chat/components/MessageBubble.tsx`** — mensagem apagada não oferece "Responder" (botão e menu), como no WhatsApp; primeiro teste do componente (`MessageBubble.test.tsx`)

`0.11.2` — após o primeiro teste em produção (citação de mensagem nossa em grupo não aparecia
no outro aparelho; foco não ia ao campo):

- **`api/.../engines/baileys/BaileysMessagingEngineAdapter.ts`**, **`buildBaileysQuotedMessage.ts`** — em grupo LID (padrão do Baileys), a citação passa a levar o **LID** do autor, como os clientes oficiais: o da sessão para mensagem nossa (o Baileys usaria o número — `TODO: Add support for LIDs` em `Utils/messages.js`) e o do participante via `lidMapping`. Grupo `pn`, LID não resolvido ou consulta lenta (> 3 s) seguem pelo número. Log `Reply quote attached` com autor e tipo citado, para diagnóstico
- **`api/.../messaging/domain/contracts/IMessagingEngine.ts`**, **`resolveConversationTarget.ts`** — referência citada leva `mimeType`, `fileName` e `durationSeconds`: o preview da citação de mídia sai com tipo, nome do documento e duração, em vez de vazio
- **`app/src/features/chat/components/MessageComposer.tsx`** — escolher "Responder" leva o foco ao campo de texto (no quadro seguinte, para não perder para o `Menu`, que devolve o foco ao botão ao fechar); primeiro teste do componente (`MessageComposer.test.tsx`)

### Changed

#### Chat — Anexos e mensagem de voz (`0.12.0`)

- **`shared/storage/mediaFileExtension.ts`** (era `mimeTypeToExt` no adapter) — regra única de nome para download e envio; mídia **recebida** de Office, `video/quicktime`, `text/plain` e `application/octet-stream` passa a gravar extensão curta (`docx`, `mov`, `txt`, `bin`…) em vez do subtipo cru. Arquivos antigos não mudam
- **`chat/domain/services/buildMessagePreview.ts`**, **`IngestIncomingMessageUseCase.ts`** — prévia da última mensagem extraída para o domínio (mesma saída), reusada no envio
- **`IMessagingEngine.ts`** — `MediaType` e o `SendMediaMessageInput` antigos (sem chamador) dão lugar ao contrato por arquivo

### Added

#### Chat — Reações em mensagens

Reagir, trocar e remover reação pelo painel (barra rápida + seletor completo) e receber as do
WhatsApp em tempo real, individual e grupo. Doc: `docs/chat-reacoes-mensagens.md`.

Migration **`20260924120000_add_chat_message_reactions`** (aditiva): tabela `chat_message_reactions`
(unique `messageId+reactorKey`, índice `tenantId+messageId`) e índice `tenantId+externalMessageId`
em `chat_messages`. Env novas (opcionais): `REACTION_ECHO_TTL_MS` (120000),
`REACTION_MAX_PER_MINUTE` (30), `REACTION_MIN_INTERVAL_MS` (700). Dependência nova no app:
`emoji-picker-react` `4.22.2` (versão fixa).

##### api/

- **`api/prisma/schema.prisma`** — model `ChatMessageReaction` (uma linha por mensagem × autor; `emoji` nulo = tombstone de remoção) e back-relations em `ChatMessage`/`Tenant`
- **`api/src/modules/chat/domain/entities/ChatMessageReaction.ts`**, **`.../domain/contracts/IChatMessageReactionRepository.ts`** — entidade pura e contrato com porta única de escrita `apply` (last-write-wins), sem `upsert`/`remove` separados
- **`.../domain/services/decideReactionWrite.ts`** — regra pura: carimbo menor é ignorado, igual conta como ≥, remoção sem estado grava tombstone sem `changed`. Devolve `{ applied, changed }`
- **`.../domain/services/aggregateReactions.ts`** — um cálculo só para `PUT`, `GET` e WS: agrupa por emoji, ordena, resolve nome, corta em 10 autores, marca `isMe`; `revision` = maior `updatedAt` incluindo tombstones (remoção precisa avançar a revisão)
- **`.../infrastructure/repositories/PrismaChatMessageReactionRepository.ts`** + **`.../mappers/PrismaChatMessageReactionMapper.ts`** — `apply` em transação curta com `pg_advisory_xact_lock` por (mensagem, autor); linha de outro tenant → 404; erros transitórios do Prisma → 503; busca em lote numa query só
- **`.../application/use-cases/SetMessageReactionUseCase.ts`** — reação pelo painel: valida emoji por forma (≤ 64 bytes, não só ASCII, sem whitespace/`\p{Cc}`), exige sessão e `externalMessageId`, aplica limite, envia **antes** de gravar (nunca grava sem envio) e publica só se `changed`
- **`.../application/contracts/IReactionSendThrottle.ts`**, **`.../infrastructure/throttle/InMemoryReactionSendThrottle.ts`** — limite por mensagem (700 ms) e por sessão (30/min, janela deslizante), reserva síncrona e `release` quando a engine falha. Reação em volume fora do padrão humano arrisca o número
- **`.../application/contracts/IReactionUpdatePublisher.ts`** — porta de publicação WS, para o use case não depender do publisher concreto
- **`.../application/use-cases/IngestMessageReactionUseCase.ts`** — ingestão da reação recebida; não toca na conversa (sem mexer em `lastMessageAt`, não lidas ou arquivamento); `fromMe` sem eco usa o relógio do servidor
- **`.../infrastructure/listeners/ChatMessageReactionListener.ts`**, **`api/src/app/server.ts`** — consome `MESSAGE_REACTION_UPDATED` e publica `chat.message.reaction.updated` só quando a ingestão devolve resultado
- **`.../application/use-cases/ListMessagesUseCase.ts`** — `reactions` e `reactionsRevision` em cada mensagem, com uma busca de reações e uma de contatos por página
- **`.../presentation/routes/chat.routes.ts`**, **`.../schemas/chat.schema.ts`**, **`.../presenters/ChatPresenter.ts`** — `PUT /chat/messages/:messageId/reaction` (`emoji` obrigatório, `null` remove); throttle em instância única do módulo
- **`.../infrastructure/ws/ChatWebSocketPublisher.ts`** — evento `chat.message.reaction.updated` com o agregado completo
- **`api/src/modules/messaging/domain/contracts/IMessagingEngine.ts`** — `sendReaction` e `ReactionTargetRef`, sem tipo do Baileys
- **`api/src/shared/events/InternalMessagingEvent.ts`** — `MESSAGE_REACTION_UPDATED`, com `reactorKey` crua (`self`/`lid:`/`pn:`) e `isEcho`
- **`.../engines/baileys/BaileysMessagingEngineAdapter.ts`** — `sendReaction` (id pré-gerado, `senderTimestampMs` do servidor) e handler `messages.reaction`
- **`.../engines/baileys/normalizeReactionEvent.ts`** — tradução pura do evento: alvo em `item.key`, autor em `item.reaction.key` (a lib inverte a intuição)
- **`.../engines/baileys/ReactionEchoRegistry.ts`** — ids das reações enviadas, com TTL e teto derivado do limite, para reconhecer o eco e não publicar duas vezes
- **`.../engines/baileys/BaileysErrorTranslator.ts`**, **`api/src/shared/errors/internal/ResourceErrors.ts`** — tradução do erro de envio de reação e `TooManyRequestsError` (429)
- **`api/src/shared/config/env.ts`** — as três env de reação e o teto derivado `REACTION_ECHO_MAX_PER_SESSION`

##### app/

- **`app/src/components/EmojiPicker.tsx`** — `emoji-picker-react` lazy, tema do MUI, emoji nativo (sem CDN), dados em pt e fallback silencioso se o chunk falhar
- **`app/src/features/chat/components/messages/ReactionBar.tsx`** — barra rápida (👍 ❤️ 😂 😮 😢 🙏) + `+`; toggle, setas e `Esc`
- **`app/src/features/chat/components/messages/MessageReactions.tsx`** — chips por emoji com contagem, `aria-pressed` e tooltip de autores ("Você", "Participante")
- **`app/src/features/chat/components/MessageBubble.tsx`**, **`MessageList.tsx`**, **`ChatWindow.tsx`** — botão de reagir no hover/foco e item no menu; oculto em mensagem apagada ou sem `externalMessageId`
- **`app/src/features/chat/reactionsState.ts`** — redutores puros: estado `server` + `pending`, aceita agregado só com `revision` ≥ atual, `selectReactionToSend`
- **`app/src/features/chat/reactionDispatcher.ts`**, **`useReactionDispatcher.ts`** — envio agrupado fora do React (400 ms parado e ≥ 1000 ms desde o último envio; só o último gesto sai); `reset()` no logout e troca de tenant (**`AuthContext.tsx`**, **`TenantContext.tsx`**)
- **`app/src/pages/ChatPage.tsx`** — estado otimista, erro não bloqueante e handler do WS
- **`app/src/features/chat/strings.ts`**, **`types.ts`**, **`app/src/types/chat.api.types.ts`**, **`app/src/services/chat.service.ts`**, **`app/src/hooks/useChatWebSocket.ts`** — textos centralizados, tipos, `setMessageReaction` e evento WS tipado

### Fixed

- **`api/.../presentation/presenters/ChatPresenter.ts`** — o presenter escolhe campo a campo e descartava `reactions`/`reactionsRevision` da listagem e nunca enviava o `externalMessageId` que o painel já declarava no DTO
- **`api/.../listeners/ChatIncomingMessageListener.ts`**, **`.../ws/ChatWebSocketPublisher.ts`** — `chat.message.created` passa a levar `externalMessageId`; sem ele a mensagem recém-chegada não oferecia reagir até recarregar a conversa
- **`api/.../aggregateReactions.ts`**, **`app/src/features/chat/reactionsState.ts`**, **`MessageReactions.tsx`** — a própria reação era identificada por nome e telefone nulos, formato idêntico ao de participante `@lid`: o otimista podia remover o participante no lugar do operador. Cada autor ganha `isMe` (aditivo)

### Changed

- **`api/.../use-cases/SendMessageUseCase.ts`**, **`resolveConversationTarget.ts`** — resolução de destino e da referência externa extraída para função pura com teste de caracterização, reusada pela reação. Refactor sem mudança de comportamento
- **`app/src/services/apiClient.ts`** — erro rejeitado leva `status` e `code` da API (distingue 429 de 409 de sessão); mensagem inalterada
- **`app/src/features/chat/components/MessageBubble.tsx`** — ações de hover (inclusive Responder) também aparecem com foco de teclado

### Added

#### Chat — Estado de conversa sincronizado entre dispositivos e abas

- **`api/src/modules/messaging/infrastructure/engines/baileys/normalizeChatState.ts`** — traduz num único lugar a semântica numérica do Baileys: `unreadCount` 0 é conversa lida, negativo é marcação manual de não lida, positivo é **incremento** e por isso é descartado (o contador do painel vem da ingestão de mensagens; copiar o valor duplicaria a contagem). `pinned` chega como timestamp e `muteEndTime` como epoch, ambos podendo vir como `Long` do protobuf
- **`api/src/shared/events/InternalMessagingEvent.ts`** — `CHAT_ARCHIVE_UPDATED` dá lugar a `CHAT_STATE_UPDATED`, que carrega estado parcial (`read`, `manuallyUnread`, `archived`, `pinned`, `mutedUntil`). Campo ausente significa "o WhatsApp não falou disso", nunca `false` — sem isso, um evento de fixação apagaria o arquivamento persistido
- **`api/.../repositories/PrismaChatConversationRepository.ts`** — `setArchivedByChat` dá lugar a `applyRemoteState`, que lê o estado atual, calcula o diff e grava por compare-and-set. Diff vazio não grava nem publica: é o que impede o eco das ações do próprio painel (que já espelha para o WhatsApp via `chatModify`) de virar gravação e frame de WebSocket. Corrida perdida também não republica, para não emitir valor obsoleto
- **`api/.../listeners/ChatConversationStateListener.ts`** — substitui `ChatArchiveListener` e publica `chat.state.updated` só quando algo mudou. Não chama a engine em nenhum caminho: reagir a evento recebido com chamada de saída fecharia o laço painel ↔ WhatsApp
- **`api/.../ws/ChatWebSocketPublisher.ts`** — evento `chat.state.updated` substitui `chat.archive.updated`, que era publicado sem nenhum consumidor no painel e identificava a conversa por `chatId` em vez de `conversationId`
- **`api/.../routes/chat.routes.ts`** — `PATCH /conversations/:id/state` passa a publicar o estado resultante; antes, arquivar numa aba não chegava às demais nem aos outros operadores do tenant
- **`app/src/hooks/shouldResync.ts`** — decide quando recarregar a lista após o painel ficar sem receber eventos. Janela de 5 s para reconexão (houve perda real de frames) e de 60 s para retomada de aba (alt-tab curto não perde nada; janela curta ali seria polling com outro nome), com 30 s de intervalo mínimo entre dois resyncs
- **`app/src/hooks/useChatWebSocket.ts`** — avisa por `onResync` na reconexão e na volta da aba; o WebSocket não reenvia o que se perdeu durante a queda. Nenhum timer periódico é criado
- **`app/src/pages/ChatPage.tsx`** — trata `chat.state.updated` com merge parcial; arquivamento remoto remove a conversa da visão carregada e ajusta o contador de arquivadas, porque o filtro é do servidor e não da renderização
- **`app/src/features/chat/utils.ts`** — `isUnread` e `countUnread` passam a considerar a marcação manual (conversa marcada vale 1 no total, como no WhatsApp Web), e `byPinnedThenRecent` extrai a ordenação que estava embutida no `ChatPage`
- **`api/.../initialStateFromRemote.ts`**, **`IngestHistorySyncUseCase.ts`**, **`PrismaChatConversationRepository.ts`** — conversa criada pelo history sync nasce com o retrato do aparelho: não lidas, arquivamento, fixação e silenciamento. Os dois caminhos de sincronização rodam fora de ordem — o estado é emitido assim que o lote chega, as mensagens são ingeridas em background — então, para a conversa que ainda não existe, o espelhamento não tem o que atualizar e o estado se perderia. Ela nasceria lida, desarquivada e sem fixação, e nada a corrigiria depois. Vale só na criação, que acontece uma vez e por isso não sofre do problema de lote atrasado
- **`api/.../BaileysMessagingEngineAdapter.ts`** — chat entregue por LID tem o telefone real resolvido via `pnJid` ao montar o retrato, mesma chave que o mapeamento de mensagens usa; sem isso a conversa nascia sem estado em silêncio. Chat LID sem `pnJid` é contado num log debug, em vez de sumir sem rastro
- **`api/src/modules/chat/domain/services/diffRemoteState.ts`** — a regra que decide o que muda ao espelhar estado remoto sai do repositório para o domínio, onde é testável sem banco. O total vindo do history sync só é adotado quando **reduz** o contador: os lotes chegam sem ordem garantida, e um retrato atrasado faria o badge ressuscitar numa conversa recém-lida — inclusive na que está aberta na tela. Para cima quem manda é a ingestão, que reage a cada mensagem e não depende de sincronização
- **`api/.../normalizeChatState.ts`**, **`BaileysMessagingEngineAdapter.ts`** — o contador do `messaging-history.set` passa a ser adotado como **total** do aparelho. É a única fonte absoluta: na sincronização inicial de app-state, conversa já lida chega com `unreadCount: null` (a lib trata "lida" como padrão — `chat-utils.js:707`), então sem essa reconciliação o acumulado anterior à conexão nunca seria corrigido. Em `chats.update` o positivo continua descartado, porque ali é incremento
- **`api/src/test/setup.ts`** — env sintético para os testes da API: `shared/config/env` valida no import e derrubava qualquer teste que alcançasse um módulo com log

### Fixed

- **`app/src/pages/ChatPage.tsx`** — mensagem que chega na conversa aberta não gera mais badge, e a confirmação de leitura é agrupada em uma chamada por 1,5 s: antes, uma rajada de cinco mensagens virava cinco chamadas de saída ao WhatsApp
- **`app/src/pages/ChatPage.tsx`**, **`ConversationListItem.tsx`**, **`ConversationSidebar.tsx`** — marcação manual de não lida deixa de ser simulada com `Math.max(1, unreadCount)` e passa a usar a flag real; a conversa exibe ponto sem número, em vez de um "1" inventado
- **`api/.../MarkConversationAsReadUseCase.ts`**, **`PrismaChatConversationRepository.ts`** — abrir a conversa limpa `manuallyUnread` junto do contador, no banco e nas demais abas; antes a conversa seguia destacada depois de lida

### Changed

- **Contrato de evento interno**: `CHAT_ARCHIVE_UPDATED` deixa de existir. Emissor (adapter Baileys) e consumidor (listener do chat) foram atualizados no mesmo commit
- **Contrato WebSocket**: `chat.archive.updated` removido (sem consumidor); `chat.unread.updated` ganha `manuallyUnread` opcional, aditivo

Sem migration Prisma: `archived`, `pinned`, `mutedUntil` e `manuallyUnread` já existiam em `chat_conversations`.

### Added

#### Testes — Vitest em `api/` e `app/`

- **`api/vitest.config.mts`**, **`app/vite.config.ts`** — o projeto passa a ter runner de testes; antes o único gate automatizado era `tsc --noEmit`, que não pega regra de negócio errada. Escopo deliberado: lógica pura, use cases com dependências injetadas e componentes visuais. Repositórios Prisma, rotas Fastify e páginas com estado grande seguem validados por smoke manual — sem banco de teste, um teste de repositório custa mais do que entrega
- **`app/vite.config.ts`** — a configuração do Vitest do painel fica dentro da config do Vite, não em arquivo separado, para herdar `define`, `resolve.alias` e plugins. Em arquivo separado, os testes rodavam sem `__APP_VERSION__` (qualquer componente que exiba a versão quebraria por `ReferenceError`) e resolviam módulos por um alias paralelo, que silenciosamente divergiria do app. **`app/src/test/appVersion.test.ts`** trava essa regressão
- **`.github/workflows/ci.yml`** — CI rodando `typecheck` e `test` em `api/` e `app/` a cada push e PR para `develop` e `main`; sem isso os gates do AGENTS.md §36 dependiam de alguém lembrar de executá-los
- **`app/package.json`** — `vite` sobe para `^6.4.0`, que é o mínimo exigido pelo Vitest 5; o intervalo anterior (`^6.2.1`) permitia resolver uma versão incompatível com o runner
- **`api/tsconfig.build.json`** — exclui `src/**/*.test.ts` do build, para que nenhum teste vá para `dist/`
- **`app/src/test/setup.ts`**, **`app/src/test/renderWithTheme.tsx`** — setup do Testing Library com limpeza entre testes e helper que renderiza no `ThemeProvider` com o modo (claro/escuro) como parâmetro, já que toda tela precisa funcionar nos dois
- **`api/src/shared/utils/passwordPolicy.test.ts`**, **`app/src/features/chat/utils.test.ts`**, **`app/src/features/chat/components/EmptyConversationState.test.tsx`** — primeiros testes, cobrindo código já existente: política de senha, formatação de telefone/preview de mensagem e render de componente nos dois temas
- **`package.json` (api e app)** — scripts `test` (`vitest run`) e `test:watch`
- **`.specs/codebase/TESTING.md`** — matriz de cobertura por camada, convenções (testes co-locados, imports explícitos do Vitest, consultas por texto/role) e dívidas conhecidas

### Added

#### Interface — Barreiras de cópia e inspeção

- **`app/src/security/uiGuards.ts`**, **`useUiGuards.ts`**, **`AppLayout.tsx`** — módulo global, sem dependência de framework, aplicado uma vez na área autenticada: bloqueia cópia e recorte fora de campos de entrada, o menu de contexto e os atalhos de DevTools e código-fonte no Windows/Linux (`F12`, `Ctrl+Shift+I/J/C`, `Ctrl+U`) e no macOS (`Cmd+Alt+I/J/C`, `Cmd+U`). Campos de entrada seguem funcionando, para não atrapalhar digitação e gerenciadores de senha. **Isso é atrito, não segurança**: as DevTools abrem pelo menu do navegador e o conteúdo aparece na aba de rede — o que não pode vazar não deve chegar ao cliente, que é a razão da paginação por cursor acima
- **`uiGuards.ts`** — o estilo global é marcado com `data-app`, senão o `DomGuardian` o remove como injeção de extensão; e a configuração é resolvida campo a campo, porque espalhar as opções sobrescrevia os padrões com `undefined` e desligava todas as barreiras silenciosamente

#### Chat — Membros paginados, ações do painel e navegação por teclado

- **`OpaqueCursor.ts`**, **`ListGroupParticipantsUseCase.ts`**, **`chat.routes.ts`**, **`chat.schema.ts`** — a rota de participantes deixa de aceitar `limit`/`offset`: o tamanho da página é do servidor e a posição vem num cursor opaco assinado por HMAC, amarrado ao recurso e com validade de 30 minutos. Com `limit` vindo do front, bastava alterar a requisição para puxar a lista inteira — que é dado pessoal de centenas de pessoas. A resposta traz `{ participants, total, nextCursor }`, e um cursor inválido ou expirado é tratado como início da lista
- **`GroupMembersDialog.tsx`**, **`ConversationDetailsPanel.tsx`** — o painel exibe 10 membros e um "Ver todos"; o modal carrega de 10 em 10 sob demanda, com busca, e limpa a lista ao fechar. O botão "Carregar mais" saiu: a próxima página é pedida por `IntersectionObserver` numa sentinela no fim da lista, exigindo rolagem real do usuário e dificultando a coleta automatizada
- **`ConversationDetailsPanel.tsx`** — ações na ordem do WhatsApp Web: Favoritos e Adicionar à lista funcionando; exportar, limpar e sair do grupo visíveis e desabilitadas, com aviso de "em breve"
- **`ChatPage.tsx`** — `Esc` fecha em cascata: busca, depois painel de contexto, depois conversa; diálogos e menus abertos tratam o próprio `Esc`
- **`ChatPage.tsx`** — arquivar e fixar passam a atualizar a lista localmente (remoção da visão atual e reordenação), sem recarregá-la inteira; o recarregamento fica reservado para o caso de falha da chamada
- **`VideoMessage.tsx`** — `preload="metadata"` e clique único para reproduzir; sem os metadados o primeiro clique era gasto carregando

#### Chat — Ações da conversa

- **`schema.prisma`**, **migration `add_conversation_state_flags`** — colunas `pinned`, `mutedUntil`, `favorite` e `manuallyUnread`, mais o índice `(tenantId, pinned)`; as listas reaproveitam o campo `tags`
- **`IMessagingEngine.ts`**, **`BaileysMessagingEngineAdapter.ts`** — `updateChatState` traduz para `chatModify`. `archive` e `markRead` exigem a última mensagem da conversa, que o protocolo usa para localizar o ponto do histórico
- **`UpdateConversationStateUseCase.ts`**, **`chat.routes.ts`** — `PATCH /chat/conversations/:id/state`. A mudança local é persistida antes da sincronização e não é desfeita quando ela falha; o retorno informa em `syncedToWhatsApp` se chegou ao aparelho. Arquivar, fixar, silenciar e marcar como não lida são espelhados no WhatsApp; favoritos e listas ficam no painel, porque a biblioteca não expõe equivalentes
- **`ConversationActionsMenu.tsx`** — os submenus passam de `Menu` para `Popper` com `placement="right-start"` e `flip`: como `Menu` ficavam sobre o próprio item, disparando `mouseleave`/`mouseenter` em ciclo e piscando. Sem espaço à direita abrem à esquerda, e a abertura por hover fica restrita a dispositivos com ponteiro fino
- **`ConversationActionsMenu.tsx`** — os submenus de listas e de silenciar abrem ao passar o mouse, e não só por clique; o menu principal permanece visível ao lado. Sem backdrop, que capturaria o ponteiro, e com atraso curto no fechamento, para o submenu não sumir enquanto o ponteiro atravessa o vão
- **`ConversationActionsMenu.tsx`**, **`ConversationListItem.tsx`**, **`ConversationSidebar.tsx`**, **`ChatPage.tsx`** — chevron no item da lista abre o menu com as seis ações na ordem do WhatsApp Web; o card exibe os indicadores de fixada, silenciada e favorita. Fixadas passam a vir no topo da listagem

#### Chat — Sugestão de contatos ao iniciar conversa

- **`SuggestContactsUseCase.ts`**, **`chat.routes.ts`**, **`IMessagingEngine.ts`** — `GET /chat/contacts/suggest` combina os contatos conhecidos do tenant (nome ou telefone parcial) com a verificação no WhatsApp via `onWhatsApp` quando o texto já é um telefone completo desconhecido, trazendo a foto quando disponível. `checkNumberExists` devolve `null` com a sessão fora do ar, caso em que não se pode afirmar que o número não existe
- **`NewConversationDialog.tsx`** — lista as sugestões enquanto o usuário digita; escolher uma preenche número e, para contato conhecido, o nome

#### Chat — Nova conversa, arquivadas e painel no mobile

- **`NewConversationDialog.tsx`**, **`ConversationSidebar.tsx`**, **`ChatPage.tsx`** — o botão "Nova" era decorativo; abre um diálogo com número, nome opcional e escolha da sessão quando há mais de uma conectada. O número é normalizado para dígitos. O diálogo capturava a lista de sessões antes dela carregar, deixando o botão de confirmar sempre desabilitado — corrigido, com a lista memoizada na página
- **`BaileysMessagingEngineAdapter.ts`** — o estado de arquivamento passa a ser lido também do `messaging-history.set`, único momento em que chega para sessões já pareadas (o `chats.upsert` ocorre apenas na sincronização inicial). Sem isso a seção "Arquivadas" nunca aparecia, porque nenhuma conversa era marcada
- **`ConversationSidebar.tsx`** — a linha "Arquivadas" esticava verticalmente e empurrava a lista para baixo: `ListItemButton` nasce com `flex-grow: 1`, pensado para viver dentro de um `ListItem` em linha, e na coluna da lista ocupava todo o espaço livre
- **`ConversationDetailsPanel.tsx`** — no mobile o painel ganha botão de voltar e título que identifica o conteúdo ("Dados do grupo" / "Dados do contato"), já que ali ocupa a tela inteira

#### Chat — Abrir conversa com um participante

- **`StartConversationUseCase.ts`**, **`chat.routes.ts`** — `POST /chat/conversations` abre a conversa individual com um contato pela sessão indicada, reaproveitando contato e conversa ativa quando já existirem; responde 201 ao criar e 200 ao reaproveitar
- **`ChatPage.tsx`**, **`chat.service.ts`**, **`MessageBubble.tsx`** — a opção "Conversar com" do menu da mensagem, que só funcionava havendo conversa prévia, passa a criar a conversa quando necessário. A lista é recarregada antes da seleção, já que o carregamento descarta o id que ainda não consta nela. A opção só aparece quando o remetente tem telefone válido, evitando criar contato a partir de um LID gravado por mensagens antigas

#### Chat — Acesso aos dados da conversa

- **`ConversationDetailsPanel.tsx`** — largura do painel de contexto de 280 para 322 px (+15 %) no desktop; no mobile segue como sobreposição de tela cheia

- **`ChatHeader.tsx`** — o ícone de informação sai do cabeçalho e vira item do menu de três pontos, com rótulo que acompanha o estado ("Dados do grupo" / "Dados do contato" / "Fechar dados"). O avatar do cabeçalho passa a ser o atalho direto para o painel, com papel de botão, rótulo, foco visível e acionamento por teclado

#### Chat — Busca dentro da conversa

- **`ListMessagesUseCase.ts`**, **`PrismaChatMessageRepository.ts`**, **`chat.routes.ts`** — `GET /chat/conversations/:id/messages` aceita `search`, com `contains` insensitive sobre o conteúdo, ignorando mensagens apagadas e devolvendo do mais recente para o mais antigo. A leitura normal da conversa segue em ordem cronológica, sem mudança de comportamento
- **`IChatMessageRepository.ts`**, **`PrismaChatMessageRepository.ts`**, **`ListMessagesUseCase.ts`** — `findAround` devolve a janela de mensagens ao redor de uma âncora (duas consultas, anteriores em ordem decrescente e seguintes em crescente), exposta por `around` na rota. Permite saltar da busca para um trecho do histórico que não está em nenhuma página carregada
- **`MessageList.tsx`**, **`ChatPage.tsx`** — clicar num resultado rola a conversa até a mensagem e aplica um destaque breve, que some sozinho; se a mensagem não estiver carregada, a janela ao redor é buscada antes
- **`ConversationSearchPanel.tsx`**, **`ChatHeader.tsx`**, **`ChatPage.tsx`** — a lupa do cabeçalho, que não fazia nada, passa a abrir o painel de busca com resultados datados e o termo destacado. A consulta é feita no servidor, para alcançar o histórico que ainda não foi carregado; a digitação é aguardada antes de consultar e a busca começa com dois caracteres. Busca e contexto dividem a mesma coluna, então abrir um fecha o outro

#### Chat — Conversas arquivadas

- **`schema.prisma`**, **migration `add_conversation_archived`** — nova coluna `archived` em `chat_conversations` e índice `(tenantId, archived)`, que é como a listagem sempre filtra
- **`BaileysMessagingEngineAdapter.ts`** — passa a escutar `chats.upsert` (sincronização inicial) e `chats.update` (mudança em qualquer aparelho), emitindo `CHAT_ARCHIVE_UPDATED`. Por ser estado de conversa, e não histórico de mensagens, não depende de `BAILEYS_SYNC_FULL_HISTORY`
- **`ChatArchiveListener.ts`** — persiste o estado e anuncia por WebSocket; conversa desconhecida é ignorada em silêncio, já que o WhatsApp envia o estado de todos os chats do aparelho
- **`chat.routes.ts`**, **`ListConversationsUseCase.ts`** — `GET /chat/conversations` aceita `archived` e devolve `{ conversations, archivedCount }`, evitando uma segunda chamada só para a contagem. O serviço do painel tolera a resposta antiga em array durante a janela entre os deploys
- **`ConversationSidebar.tsx`**, **`ChatPage.tsx`** — linha "Arquivadas · N" acima da lista e visão de arquivadas com botão de voltar



#### Painel — Layout do chat e conformidade de interface

Verificado no navegador em 1440×900 e 390×844, com medições do DOM.

- **`AppLayout.tsx`** — o `main` não tinha `minWidth: 0` e não encolhia abaixo da largura intrínseca do conteúdo: a página esticava para 849 px numa viewport de 390 px, com rolagem horizontal no mobile. O `marginTop` também colapsava com a margem negativa usada pelas páginas para anular o padding do wrapper, jogando o conteúdo para trás da AppBar fixa e escondendo o cabeçalho da conversa — trocado por `paddingTop`
- **`ChatPage.tsx`** — o padding do wrapper era anulado só nas laterais e no rodapé, deixando faixa vazia acima da lista; a altura passa a descontar apenas a barra superior real (56 px no mobile, 52 px no desktop). O painel de contexto passa a iniciar fechado no mobile, onde é sobreposição de tela cheia
- **`MessageBubble.tsx`** — bolha ocupa 85 % da largura no mobile e o número do participante aparece só a partir de `sm`
- **`index.html`**, **`MessageComposer.tsx`**, **`ChatHeader.tsx`** — `theme-color` por esquema de cor, `viewport-fit=cover`, `color-scheme: light dark`, `touch-action: manipulation`, respeito a `prefers-reduced-motion`, área segura no campo de mensagem e `aria-label` nos botões de ícone (eram 13 com apenas 1 rotulado)

#### Chat — Layout responsivo e navegação mobile

- **`ConversationSidebar.tsx`** — a coluna de conversas tinha largura fixa de 320 px e não acompanhava o espaço disponível; passa a ser fluida (tela cheia no mobile, 300/340/380 px conforme o breakpoint)
- **`ChatPage.tsx`**, **`ChatWindow.tsx`**, **`ChatHeader.tsx`** — no mobile, lista e conversa passam a ser telas separadas, como num app de mensagens: selecionar uma conversa substitui a lista pela janela de mensagens e o cabeçalho ganha botão de voltar. O painel de contexto, terceira coluna no desktop, vira sobreposição de tela cheia

#### Sessões/Chat — Avatar ausente e leitura dos cards

- **`app.ts`** — o schema de resposta `SessionItem` não declarava `avatarUrl`, e o serializer do Fastify remove silenciosamente propriedades ausentes do schema: a foto do número conectado nunca chegava ao painel, mesmo com o presenter devolvendo o campo
- **`ConversationListItem.tsx`** — o card passa a exibir nome (ou o telefone formatado, quando o contato não tem nome salvo) e a prévia da última mensagem logo abaixo, com o badge de não lidas ao lado, como no WhatsApp Web; a linha dedicada ao telefone sai
- **`MessageBubble.tsx`** — o canto agudo do balão vai para o topo, do lado de quem fala (a mesma aresta do avatar), e ganha um bico triangular saindo para fora

#### Painel — Versão no menu e navegação

- **`AppLayout.tsx`**, **`vite.config.ts`**, **`vite-env.d.ts`** — a versão do painel passa a aparecer discretamente no rodapé do menu, também no modo compacto; o número é lido do `package.json` em tempo de build e injetado como `__APP_VERSION__`
- **`AppLayout.tsx`** — item ativo ganha indicador lateral (o `selected` do MUI não era evidente no tema escuro), alvo de toque de 44 px no mobile, AppBar mobile mostrando a seção atual em vez do nome do produto e drawer com `keepMounted`
- **`MessageBubble.tsx`** — o balão passa a ser alinhado ao topo, com o avatar do remetente na linha do nome, como no WhatsApp Web

#### Chat — Avatar do remetente nas bolhas de grupo

- **`ChatPage.tsx`**, **`ChatWindow.tsx`**, **`MessageList.tsx`**, **`MessageBubble.tsx`**, **`ConversationDetailsPanel.tsx`** — a bolha só exibia foto quando o remetente tinha contato salvo com avatar (apenas 7 de 1503 contatos têm, porque o sync cobre só quem tem conversa individual). Os participantes passam a ser carregados uma vez pelo `ChatPage` e alimentam tanto o painel quanto um mapa telefone → avatar usado nas bolhas; o painel deixa de fazer requisição própria
- **`DashboardPage.tsx`** — o card de sessão passa a mostrar avatar com o ponto de status sobreposto, nome e número centrados na linha média e o status em chip

#### Sessões — Foto do número conectado

- **`ListSessionsUseCase.ts`**, **`SessionPresenter.ts`**, **`SessionCard.tsx`** — o card exibia sempre a inicial do nome da sessão; passa a mostrar a foto de perfil do número conectado, com a inicial como fallback. Só sessões `CONNECTED` são consultadas e o resultado usa o cache de 6 h do adapter, para a listagem não rebaixar a imagem a cada chamada
- **`ConversationListItem.tsx`**, **`ChatHeader.tsx`**, **`ConversationDetailsPanel.tsx`** — nome e número passam a formar um bloco centrado na linha média do avatar, com espaçamento uniforme entre as linhas

#### Chat — Avatares de contatos, grupos e remetentes

- **`IMessagingEngine.ts`**, **`BaileysMessagingEngineAdapter.ts`** — nova capacidade `fetchProfilePicture`, que baixa a foto e a armazena: a URL do WhatsApp expira em horas, então persisti-la deixaria avatares quebrados; guardamos a imagem e devolvemos uma URL estável
- **`SyncChatAvatarsUseCase.ts`**, **`chat.routes.ts`** — `POST /chat/avatars/sync` varre as conversas sem avatar e emite `CONTACT_AVATAR_UPDATED`/`GROUP_AVATAR_UPDATED`, eventos que os listeners já consumiam mas que **nenhum ponto do sistema emitia** — daí `chat_contacts.avatarUrl` estar nulo em 1503 de 1503 contatos. Trabalha em lotes e devolve quantas faltam
- **`ChatGroupAvatarListener.ts`**, **`ChatWebSocketPublisher.ts`** — passa a publicar `chat.group.avatar.updated` com `groupJid`; casava por `contact.phone`, hoje vazio em grupos de propósito, e a atualização nunca chegaria ao painel
- **`ListMessagesUseCase.ts`**, **`MessageBubble.tsx`** — mensagens de grupo trazem `fromParticipantAvatarUrl`, resolvido em consulta única por página, e a bolha exibe o avatar do remetente ao lado da mensagem, como no WhatsApp Web
- **`ChatPage.tsx`**, **`chat.service.ts`** — o painel dispara o sync ao abrir e acompanha a fila até zerar
- **`chat.api.types.ts`**, **`ChatPage.tsx`**, **`chat.service.ts`** — avatares são persistidos como caminho relativo (`/api/storage/media/...`) e eram usados direto no `src`: em produção o painel é servido por `waioprime.com` e a API por `api.waioprime.com`, então o navegador buscava a imagem no domínio do site estático e recebia 404 (o mesmo arquivo responde 200 na API). O helper `resolveMediaUrl`, que só cobria `mediaUrl` de mensagens, passa a cobrir o avatar do contato, o do remetente nas bolhas, os participantes e os avatares vindos por WebSocket

- **`BaileysMessagingEngineAdapter.ts`**, **`ListGroupParticipantsUseCase.ts`**, **`ConversationDetailsPanel.tsx`** — num grupo de 172 membros só 50 exibiam foto: o limite de 60 consultas deixava 112 sem tentar, e 10 das tentadas falhavam por privacidade do perfil. O limite sobe para 200, as consultas passam a ser feitas em lotes de 8 (172 simultâneas causam timeout no WhatsApp) e um cache por JID com validade de 6 h evita repetir a busca a cada abertura, inclusive para resultados negativos. Participante identificado só pelo número deixa de exibir a inicial "5" e passa a usar o ícone de pessoa

#### Chat — Participantes do grupo

- **`IMessagingEngine.ts`**, **`BaileysMessagingEngineAdapter.ts`** — nova capacidade `getGroupParticipants`, com o Baileys isolado no adapter. Participantes com privacidade de número chegam como `@lid` e o telefone real, quando disponível, vem em `phoneNumber`; sem telefone o campo fica nulo, para nunca exibir identificador interno como número
- **`ListGroupParticipantsUseCase.ts`** — monta a lista enriquecida com os contatos já conhecidos do tenant (nome salvo e avatar), em consulta única por lote
- **`chat.routes.ts`** — `GET /chat/conversations/:id/participants` devolve os participantes e o total
- **`ConversationDetailsPanel.tsx`**, **`chat.service.ts`**, **`chat.api.types.ts`** — a seção Participantes deixa de exibir texto fixo e passa a listar os membros com avatar, nome, telefone e marcação de admin, com o total no título

### Changed

- **`ConversationDetailsPanel.tsx`** — recursos exclusivos de grupo (participantes, "Ver todos", download automático de mídia e "Sair do grupo") não são mais renderizados em conversa de contato, onde apareciam vazios. Regra registrada em `AGENTS.md` e em `docs/sessoes-e-chat-diagnostico.md`
- **`@whiskeysockets/baileys`** — atualizado de `7.0.0-rc.9` (21/11/2025) para `7.0.0-rc14` (29/07/2026). Traz o rc10 (correções de estabilidade em reenvio de mensagens, upload de mídia, Mutex, vazamento de memória e sincronia de app state) e o rc13 (parsing de `protocolMessage` com `fromMe` incorretamente `false`). Pontos de contato verificados: `key.participantAlt`/`remoteJidAlt`, entrega offline como `append`, `lidMapping.getPNForLID` (agora tipado), `profilePictureUrl`, `Contact.phoneNumber` e os valores de `DisconnectReason` seguem inalterados
- **`BaileysMessagingEngineAdapter.ts`** — remove `printQRInTerminal`, deprecado na rc14; o QR já vinha do evento `connection.update` e é publicado via `SESSION_QR_UPDATED`
- **`docs/sessoes-e-chat-diagnostico.md`** — novo documento com os doze problemas investigados em 06–07/09/2026, causas reais, soluções, cuidados não óbvios ao mexer e armadilhas de diagnóstico
- **`ListConversationsUseCase.ts`**, **`IChatContactRepository.ts`**, **`PrismaChatContactRepository.ts`** — a listagem buscava o contato de cada conversa individual com um `findById` dentro do laço, em série: 23 consultas para 51 conversas (19 individuais, 3 sessões) onde bastavam 3, cada uma pagando a latência até o Postgres (~125 ms de servidor contra ~33 ms da rota de mensagens). Os contatos passam a ser carregados em lote e resolvidos por `Map`; acrescenta `findByIds` e `findByPhones` ao repositório. Resposta HTTP inalterada

### Fixed

#### Chat — Mensagens novas não apareciam no painel

- **`PrismaChatMessageRepository.ts`** — a listagem paginava com `orderBy sentAt asc` + `take limit`, devolvendo as mensagens mais **antigas**. Em conversas maiores que a página (ex.: 78 mensagens com `PAGE_SIZE` 40) as recentes nunca chegavam ao painel: o card da lista mostrava a última mensagem, vinda de `lastMessagePreview`, mas a janela da conversa parava meses atrás. A janela passa a ser sempre as `limit` mais recentes, respeitando o cursor `before`; `orderDir` controla apenas a ordem do resultado, preservando o `desc` usado por `MarkConversationAsReadUseCase`
- **`useChatWebSocket.ts`** — o hook contornava o proxy do Vite montando a URL do WS com `window.location.hostname` + `VITE_API_PORT`. Como `pnpm dev` roda `--mode dev` e o `.env.dev` define `VITE_API_URL=/api`, o REST passava pelo proxy e funcionava, mas o WebSocket ia para `ws://<host>:3000` e falhava com `ERR_CONNECTION_REFUSED` em backoff infinito — o painel só via mensagens novas ao recarregar a página. Com `VITE_API_URL` relativo o WS passa a usar a origem da página (proxy do Vite em dev, domínio do painel em produção)
- **`ListConversationsUseCase.ts`**, **`GetConversationByIdUseCase.ts`** — conversas de grupo montam um contato sintético que recebia `phone: conv.groupJid`. O JID de grupo tem formato interno `<criador>-<timestamp>` (ex.: `554799247313-1615683047`) e era exibido onde vai o número do contato. O campo passa a ficar vazio em grupos
- **`ConversationListItem.tsx`**, **`ChatHeader.tsx`**, **`ConversationDetailsPanel.tsx`** — exibem "Grupo" no lugar do telefone quando a conversa é de grupo
- **`BaileysMessagingEngineAdapter.ts`** — participantes de grupo com privacidade de número chegam como `@lid` e o telefone real vem em `key.participantAlt`, campo que `extractParticipantJid` ignorava; `resolveParticipantPhone` ainda devolvia o LID como fallback, gravando o identificador interno em `fromParticipant` e exibindo-o como telefone (ex.: `Adriel · 144285148151969`). Agora `participantAlt` é preferido e, sem resolução possível, o campo fica nulo — a bolha mostra só o nome, como no WhatsApp Web. Mensagens já gravadas mantêm o LID até saneamento dos dados

#### Chat/Sessões — Perda silenciosa de mensagens e status mentiroso

- **`ChatPage.tsx`** — o handler de `chat.message.created` anexava a mensagem sem checar se ela já estava no estado, duplicando a bolha e gerando "two children with the same key" no `MessageList`. Ocorre com duas conexões WS (StrictMode em dev), reentrega após reconexão ou corrida entre evento e refetch. Passa a ignorar mensagem cujo id já existe
- **`ChatPage.tsx`**, **`ChatWindow.tsx`**, **`MessageList.tsx`** — o scroll ao fundo vinha de um contador global e a animação era inferida dele (`'auto'` só quando valia 1). Como o contador nunca volta a 1, toda abertura de conversa a partir da segunda animava a rolagem da mensagem mais antiga até a mais recente, atravessando todas as bolhas — efeito agravado por mídia, que muda de altura ao carregar. O sinal passa a carregar a intenção: abrir/trocar de conversa salta direto para o fim, mensagem nova e envio próprio animam
- **`ChatPage.tsx`** — a mensagem só era anexada quando a conversa estava aberta, e a abertura reaproveita o cache sem refetch: tudo que chegava com a conversa fechada atualizava apenas o card da lista e sumia ao reabrir, voltando só após recarregar a página. O cache passa a ser atualizado também com a conversa fechada (conversa ainda não carregada é ignorada, para não criar cache parcial que pularia o fetch)
- **`BaileysMessagingEngineAdapter.ts`** — mensagens recebidas enquanto a sessão está fora do ar são acumuladas pelo WhatsApp e entregues na reconexão como `append` (`upsertMessage(msg, node.attrs.offline ? 'append' : 'notify')`), mesmo tipo do history sync. Como `append` era descartado enquanto `BAILEYS_SYNC_FULL_HISTORY` estivesse desligado — o padrão —, tudo que chegava durante um deploy era perdido em silêncio. `append` passa a ser sempre ingerido, com dedupe por `externalMessageId`; o despejo de histórico do pareamento segue atrás da flag, via `messaging-history.set`
- **`SessionStatusReconciler.ts`**, **`server.ts`** — sockets não sobrevivem a restart, mas o status gravado antes do shutdown sim: a sessão seguia `CONNECTED` no painel sem socket algum e sem receber mensagens. No startup, com o bootstrap desligado, as sessões ainda marcadas como ativas passam a ser reconciliadas para `DISCONNECTED`. Com `SESSION_BOOTSTRAP_ON_STARTUP=true` elas são religadas com a credencial persistida, sem QR

#### Backend — Reconexão de sessão com credencial revogada

- **`BaileysErrorTranslator.ts`** — `translateDisconnect` passa a devolver `shouldClearCredentials`. Motivos em que o WhatsApp revoga o dispositivo (`loggedOut`, `forbidden`, `badSession`, `multideviceMismatch`) marcam a credencial como morta; `connectionReplaced` e falhas de transporte **não** marcam, pois a credencial continua válida e limpá-la forçaria um pareamento desnecessário
- **`BaileysMessagingEngineAdapter.ts`** — credencial revogada agora é apagada via `clearCredentials()` e o socket é **reaberto na hora** (`discardCredentials`), de modo que o QR de pareamento nasce da mesma ação do usuário que esbarrou na credencial morta. Antes, o reconnect reusava a credencial morta, o WhatsApp devolvia 401 em segundos e o único caminho de saída era deletar a sessão — o que quebrava o vínculo das conversas (`chat_conversations.sessionId`) e duplicava o histórico. Sessões já presas em `FAILED` se recuperam no primeiro clique em Reconectar, sem intervenção no banco
- **`BaileysMessagingEngineAdapter.ts`** — guarda `pairingRestarts` impede laço de limpeza/reabertura: se a credencial recém-gerada for revogada de novo, a sessão é estacionada em `LOGGED_OUT` para pareamento manual. O guard é liberado ao conectar e em toda ação manual (connect/disconnect/logout)
- **`BaileysMessagingEngineAdapter.ts`** — cada socket recebe um `epoch`; eventos vindos de um socket já substituído são descartados e seus listeners removidos (`detachSocket`). Antes, o `close` do socket antigo chegava depois da criação do novo, apagava a entrada do socket novo no registry, sobrescrevia o status e agendava reconexão paralela — dois sockets na mesma credencial faziam o WhatsApp responder `connectionReplaced` e a sessão caía em `FAILED` logo após clicar em Reconectar
- **`BaileysMessagingEngineAdapter.ts`** — contador de tentativas migrado para o registry e zerado em `connection === 'open'`. Antes ele vivia no closure do socket, então uma sessão que já tinha usado as 5 tentativas ia direto para `FAILED` na primeira queda recuperável seguinte
- **`BaileysMessagingEngineAdapter.ts`** — auto-reconexão agendada é abortada se um connect/reconnect manual já reabriu a sessão
- **`BaileysSessionRegistry.ts`** — entrada ganha `epoch` e `reconnectAttempt`, com `nextEpoch()`, `isCurrentEpoch()`, `deleteIfCurrentEpoch()` e acessores do contador

#### Frontend — Fluxo de reconexão coerente

- **`SessionCard.tsx`** — Reconectar sempre abre o QrCodeDialog (credencial válida → mostra o progresso; credencial revogada → mostra o QR), e o botão Conectar fica restrito a `PENDING`, eliminando dois botões com o mesmo efeito em `DISCONNECTED`/`FAILED`
- **`QrCodeDialog.tsx`** — `LOGGED_OUT` deixa de ser tratado como erro e passa a instruir o novo pareamento, informando que o histórico da sessão é preservado

### Added

#### Backend — Logout preserva vínculo de histórico da sessão

- **`ISessionAuthStateRepository.ts`** — adiciona `clearCredentials()` para invalidar credenciais sem apagar a linha de `session_auth_states`
- **`PrismaSessionAuthStateRepository.ts`** — implementa `clearCredentials()` zerando `statePayload` e mantendo o mesmo `sessionId`
- **`LogoutSessionUseCase.ts`** — troca `deleteBySessionId` por `clearCredentials` no logout; conversas, mídia em disco e `sessions.id` permanecem ligados à mesma sessão para reconexão com QR

#### Frontend — Reconectar após logout na mesma sessão

- **`SessionCard.tsx`** — exibe botão Reconectar em status `LOGGED_OUT`, abre QR na mesma sessão e deixa claro no tooltip que histórico e mídia são preservados

#### Backend — Alterar senha do usuário autenticado

- **`api/src/shared/utils/passwordPolicy.ts`** — validador central PWD-01…PWD-05 com `getUnmetRequirements` e `validatePasswordPolicy`
- **`api/src/shared/errors/internal/AuthErrors.ts`** — erros `PasswordMismatchError` e `WeakPasswordError` com códigos HTTP 400
- **`api/src/modules/users/application/dtos/ChangePasswordInputDto.ts`** — DTO de entrada para troca de senha
- **`api/src/modules/users/application/use-cases/ChangePasswordUseCase.ts`** — orquestra match, política, hash bcrypt e persistência via `IUserRepository.update()`
- **`api/src/modules/users/presentation/schemas/change-password.schema.ts`** — schema Fastify do body `{ newPassword, confirmPassword }`
- **`api/src/modules/users/presentation/routes/me.routes.ts`** — expõe `PATCH /api/me/password` autenticado, retorna `204 No Content`

#### Frontend — Configurações → Minha conta → Alterar senha

- **`app/src/features/settings/utils/passwordPolicy.ts`** — validação client-side espelhando PWD-01…PWD-06
- **`app/src/services/account.service.ts`** — serviço HTTP `changePassword` via `PATCH /me/password`
- **`app/src/types/api.types.ts`** — tipo `ChangePasswordRequest`
- **`app/src/features/settings/components/ChangePasswordForm.tsx`** — formulário com toggle de visibilidade, checklist de requisitos e feedback de sucesso/erro
- **`app/src/features/settings/components/SettingsLayout.tsx`** — layout de configurações com sidebar e `<Outlet />`
- **`app/src/pages/settings/SettingsAccountPage.tsx`** — página Minha conta com dados somente leitura e link para alterar senha
- **`app/src/pages/settings/ChangePasswordPage.tsx`** — página Alterar senha com breadcrumb
- **`app/src/routes/AppRoutes.tsx`** — rotas `/settings`, `/settings/account` e `/settings/account/password`
- **`app/src/app/AppLayout.tsx`** — item Configurações no menu lateral

#### Frontend — Filtro de conversas por sessão no chat

- **`app/src/pages/ChatPage.tsx`** — a tela de chat passa a carregar conversas usando `sessionId` opcional da API, mantém uma seleção explícita de sessão ativa, recarrega a lista quando o usuário alterna entre `Todos` e uma sessão conectada específica e invalida filtro/seleção quando a sessão deixa de estar conectada
- **`app/src/features/chat/components/ConversationSidebar.tsx`** — adiciona chips de sessão no topo da sidebar, com `Todos` + sessões conectadas do tenant em formato `Nome + número`, deixando a distinção entre números conectados mais clara sem misturar a filtragem local de status e busca

#### Frontend — Base visual da marca no painel

- **`app/public/assets/logo_waiochat.png`**, **`app/public/assets/waioFavicon-256x256.png`**, **`app/public/assets/waioLogo-256x256.png`**, **`app/public/assets/waiochat-pro.png`**, **`app/public/assets/waiochat-pro1.png`**, **`app/public/assets/waiochat-pro2.png`**, **`app/public/assets/iProtect-256x256.png`** e **`app/public/assets/iSaver-256x256.png`** — adiciona o pacote inicial de logos, favicon e peças visuais para reutilização no painel e em materiais da marca

#### Tooling — Padronização do repositório

- **`.gitattributes`** — normaliza finais de linha em `LF`, marca arquivos binários corretamente e reduz ruído entre ambientes macOS/Windows
- **`.prettierrc`** — adiciona baseline simples de formatação com `singleQuote` e `trailingComma: all`

#### Documentação — Planejamento do offload de mídia do chat

- **`docs/superpowers/plans/2026-05-09-chat-media-storage-architecture.md`** — adiciona um plano técnico detalhado para migrar a mídia do chat de disco local para object storage, cobrindo diagnóstico atual, arquitetura alvo, contratos, mapa de arquivos, etapas por task, riscos, rollout e estratégia de validação

#### Documentação — Migração do banco local para a Render

- **`api/db.instructions.md`** — adiciona um guia operacional completo para criar um novo banco em uma instância PostgreSQL já existente na Render, exportar o banco local do Docker, importar o dump no banco remoto, atualizar a `DATABASE_URL` da API, validar o Prisma e diagnosticar problemas comuns como `psql: not found`, uso de URL interna vs. externa e incompatibilidades do meta-comando `\l`

### Changed

#### Frontend — Aplicação da identidade visual no acesso ao painel

- **`app/index.html`** — troca o favicon SVG genérico pelo logo PNG da marca
- **`app/src/pages/LoginPage.tsx`** — substitui o monograma temporário pelo logo real na tela de login e ajusta a renderização do asset para usar proporção simples, sem bordas arredondadas artificiais
- **`app/src/app/AppLayout.tsx`** — aplica o mesmo logo oficial no drawer do painel autenticado, removendo o monograma placeholder e alinhando a navegação interna com a identidade visual já usada no login

### Fixed

#### Frontend — Build do painel na Render (corepack EROFS)

- **`render.yaml`** — define `buildCommand` do static site sem `corepack enable`; o Render nativo já instala pnpm ao detectar `app/pnpm-lock.yaml`, e `corepack enable` falha com `EROFS: read-only file system` ao tentar escrever em `/usr/bin/pnpm`

#### Backend — Sync histórico do Baileys só quando explicitamente habilitado

- **`api/src/modules/messaging/infrastructure/engines/baileys/BaileysMessagingEngineAdapter.ts`** — adiciona retornos antecipados nos eventos `messages.upsert` com `append` e `messaging-history.set` quando `BAILEYS_SYNC_FULL_HISTORY=false`, impedindo que o reconnect execute `mapMessagesToHistoryItems()` e `IngestHistorySyncUseCase` para lotes históricos não solicitados
- **`api/src/modules/messaging/infrastructure/engines/baileys/BaileysMessagingEngineAdapter.ts`** — preserva o recebimento de mensagens novas em tempo real (`notify`) e corta apenas o path de histórico/gap sync; com isso, a reconexão deixa de abrir o lote pesado de queries de contatos, conversas e mensagens históricas que ainda sobrecarregava a API e o PostgreSQL da Render

#### Backend — Estabilidade ao conectar sessões WhatsApp na Render

- **`api/Dockerfile`** — remove `prisma migrate deploy` do `CMD` do container web; migrations devem rodar no pre-deploy/one-off job, evitando que o serviço HTTP morra antes de subir quando o PostgreSQL oscila temporariamente
- **`api/scripts/prisma-migrate-deploy-with-retry.mjs`** — adiciona `PRISMA_DEPLOY_ALLOW_UNAVAILABLE=true` como escape operacional explícito para permitir rollout quando o banco fecha conexão durante o pre-deploy e não há migration pendente crítica
- **`api/src/modules/messaging/infrastructure/engines/baileys/BaileysMessagingEngineAdapter.ts`** — desliga o `syncFullHistory` completo por padrão via `BAILEYS_SYNC_FULL_HISTORY=false`, reduzindo picos de memória/CPU ao conectar um número novo; também blinda handlers `connection.update`, `messages.upsert` e `messaging-history.set` para que falhas transitórias do Prisma (`P1001`/`P1017`) não derrubem o processo Node
- **`api/src/modules/messaging/infrastructure/engines/baileys/BaileysAuthStatePersistence.ts`** — agrupa persistências do auth state com debounce e retry antes de gravar no PostgreSQL, reduzindo a avalanche de `sessionAuthState.upsert()` durante descriptografia, retry de mensagens e conexão de novos números
- **`api/src/modules/messaging/infrastructure/engines/baileys/BaileysAuthStatePersistence.ts`** — elimina upserts desnecessários em `session_auth_states` com três mecanismos: (1) `setStateValue` e `deleteStateValue` que comparam JSON serializado antes de marcar dirty — `saveCreds` e `keys.set` só agendam persistência quando algum valor mudou de fato; (2) snapshot explícito `{ ...stateMap }` passado para `persistStateWithRetry` no momento do flush, garantindo que mudanças que chegam durante um `upsert` assíncrono não são gravadas parcialmente; (3) loop `do … while (hasPendingPersist)` que re-persiste automaticamente quando novas mudanças chegam enquanto a gravação anterior ainda está em andamento
- **`api/src/shared/config/env.ts`**, **`api/src/app/server.ts`** e **`api/src/modules/sessions/application/services/SessionBootstrapService.ts`** — adicionam `SESSION_BOOTSTRAP_ON_STARTUP=false` por padrão e `SESSION_BOOTSTRAP_MAX_CONCURRENT=1`, desligando a reconexão automática de sessões WhatsApp durante o boot/deploy e limitando a concorrência quando o bootstrap for reativado explicitamente; evita que cada deploy dispare novas conexões Baileys e `upsert`s gigantes em `session_auth_states` enquanto o PostgreSQL da Render está recuperando ou enquanto `prisma migrate deploy` tenta conectar
- **`api/src/shared/config/env.ts`** — adiciona `BAILEYS_SYNC_FULL_HISTORY`, `BAILEYS_AUTH_FLUSH_DEBOUNCE_MS`, `BAILEYS_AUTH_PERSIST_MAX_RETRIES`, `BAILEYS_AUTH_PERSIST_RETRY_DELAY_MS`, `DATABASE_CONNECT_MAX_ATTEMPTS` e `DATABASE_CONNECT_RETRY_DELAY_MS` para controlar sincronização inicial, persistência do auth state e retry de conexão com o banco em produção
- **`api/src/app/server.ts`** — adiciona retry na conexão inicial com o Prisma antes de encerrar o startup, evitando queda imediata quando o PostgreSQL da Render fecha uma conexão temporariamente
- **`api/scripts/prisma-migrate-deploy-with-retry.mjs`**, **`api/package.json`** e **`api/Dockerfile`** — fazem `prisma migrate deploy` tentar novamente antes de falhar, cobrindo oscilações curtas do PostgreSQL durante pre-deploy/startup

#### Frontend — Preview de PDF/documento e contato no chat

- **`app/src/features/chat/components/messages/DocumentMessage.tsx`** — redesenha o card de documentos recebidos com preview visual para PDF, nome truncado com tooltip nativo, metadado de tipo e ações por ícone para abrir ou baixar o arquivo; corrige a prévia compacta demais que deixava PDFs pouco legíveis no histórico do chat
- **`app/src/features/chat/components/messages/VCardMessage.tsx`** — redesenha o card de contato recebido com avatar, nome, telefone formatado quando disponível e ação para abrir conversa via número; melhora também o parser de vCard para extrair `FN` e `TEL` de payloads estruturados
- **`api/src/modules/messaging/infrastructure/engines/baileys/BaileysMessagingEngineAdapter.ts`** — passa a preferir o payload `vcard` completo ao ingerir `contactMessage` e `contactsArrayMessage`, preservando telefone e metadados para que novas mensagens de contato tenham preview mais informativo no painel

#### Backend — CORS em produção para domínio público do painel

- **`api/src/app/app.ts`** — normaliza origens configuradas em `CORS_ORIGIN`, adiciona os domínios públicos oficiais do painel como fallback seguro e registra no startup a lista efetiva de origens permitidas; corrige preflight `204` sem `Access-Control-Allow-Origin` quando a env da Render não casa exatamente com `https://waioprime.com`

#### Backend — Reativação de conversas de grupo e atualização de sessão no chat

- **`api/src/modules/messaging/infrastructure/engines/baileys/BaileysMessagingEngineAdapter.ts`** — deixa de descartar mensagens `@g.us` no realtime e no history sync, volta a propagar `isGroup`, `groupJid`, `groupName`, `participant` e `participantName` para o módulo de chat e corrige a normalização de JID para preservar destinos de grupo em envio, leitura e presença
- **`api/src/modules/messaging/infrastructure/engines/baileys/BaileysMessagingEngineAdapter.ts`** — centraliza o roteamento de mensagens recebidas com resolução do remetente real, participante e metadados do grupo, reutilizando a mesma lógica para realtime e histórico e limpando cache de metadata ao desconectar/logout
- **`api/src/modules/messaging/infrastructure/engines/baileys/BaileysMessagingEngineAdapter.ts`** — passa a respeitar `autoDownloadMedia` apenas para conversas de grupo; novas conversas e grupos existentes ficam com download automático desligado por padrão para reduzir consumo de armazenamento, baixando mídia só após ativação explícita do usuário
- **`api/src/modules/messaging/infrastructure/MessagingEngineFactory.ts`** — volta a injetar `chatConversationRepo` no adapter do Baileys para permitir leitura do estado de `autoDownloadMedia` por conversa/grupo
- **`api/prisma/schema.prisma`** e **`api/prisma/migrations/20260509190000_change_auto_download_media_default_to_false/migration.sql`** — mudam o default de `autoDownloadMedia` para `false` e migram grupos já existentes para o novo comportamento de armazenamento conservador
- **`api/src/modules/chat/presentation/presenters/ChatPresenter.ts`** — alinha o fallback de `autoDownloadMedia` na resposta HTTP para `false`, evitando que o painel renderize grupos como se o download estivesse ligado por padrão
- **`api/src/modules/chat/infrastructure/listeners/ChatSessionStatusListener.ts`** — novo listener que publica `chat.session.updated` no WebSocket a partir dos eventos internos de sessão, permitindo ao painel reagir a sessões conectadas e desconectadas dentro da aba Chat
- **`api/src/app/server.ts`** — registra o listener de status de sessão junto com os demais listeners do módulo de chat

#### Frontend — Controle explícito do download automático de mídia em grupos

- **`app/src/types/chat.api.types.ts`** — o adapter do frontend deixa de assumir `autoDownloadMedia=true` quando o backend não envia o valor, alinhando o painel ao novo default de armazenamento
- **`app/src/features/chat/components/ConversationDetailsPanel.tsx`** — o toggle de download automático passa a abrir desligado por padrão e informa que a ativação só afeta as próximas mídias recebidas no grupo

#### Frontend — Renovação automática do access token no painel

- **`app/src/services/apiClient.ts`** — substitui o logout imediato em qualquer `401` por um fluxo de refresh com deduplicação de requisições concorrentes e retry automático da request original; corrige logout involuntário após expiração natural do JWT de acesso (`15m`) quando o `refreshToken` ainda é válido
- **`app/src/services/apiClient.ts`** — falhas temporárias de conexão durante reload/HMR do Vite deixam de limpar a sessão local; o refresh agora diferencia indisponibilidade transitória da API de refresh token inválido/expirado e preserva `authUser` até que a autenticação realmente deixe de ser válida

#### Backend — Persistência segura de replies durante history sync

- **`api/src/modules/chat/infrastructure/repositories/PrismaChatMessageRepository.ts`** — antes de gravar `quotedMessageId`, resolve o valor recebido para um ID interno válido da `chat_messages` (aceitando tanto ID interno quanto `externalMessageId` do WhatsApp); evita `P2003` ao ingerir mensagens históricas ou recebidas que citam uma mensagem ainda não mapeada no banco

#### Infraestrutura — Build/runtime da API no Docker com porta 3333

- **`api/src/app/app.ts`** — remove import em runtime de `fastify.d.ts`; a declaração continua válida para o TypeScript por estar incluída no projeto, mas deixa de quebrar o container com `Cannot find module '../shared/types/fastify.d'`
- **`api/src/shared/config/env.ts`** — alinha o `PORT` padrão da API para `3333`, consistente com `.env` e com o `docker-compose.yml`
- **`api/package.json`** — fixa `packageManager` em `pnpm@10.33.0` para manter o build do Docker alinhado ao lockfile e evitar o fluxo de aprovação de scripts do `pnpm 11` no container
- **`api/Dockerfile`** — adiciona Dockerfile multi-stage real para a API com `pnpm install`, `prisma generate`, `tsc build`, `prisma migrate deploy` no startup e `EXPOSE 3333`
- **`api/Dockerfile`** — runner passa a copiar `node_modules` da etapa `build` em vez da etapa `deps`, preservando o client gerado do Prisma e corrigindo o crash `@prisma/client did not initialize yet`
- **`api/prisma/seed.ts`** — o seed deixa de importar `hashPassword` de `src/` e passa a usar `bcryptjs` diretamente, permitindo executar `pnpm prisma:seed` dentro da imagem final da API na Render sem erro de `Cannot find module '../src/shared/utils/hash'`
- **`docker-compose.yml`** — sobrescreve `DATABASE_URL`, `HOST` e `PORT` do serviço `api` para valores válidos dentro da rede Docker; corrige restart loop causado por `localhost:5440` dentro do container e aplica a porta `3333`
- **`api/.env.dev`** — corrige o exemplo de `DATABASE_URL` para Docker Compose usando `postgres:5432` em vez da porta publicada no host
- **`api/.dockerignore`** — evita enviar `node_modules`, `dist`, `storage` e arquivos locais desnecessários para o build do Docker

#### Backend — Reativação da persistência de mídia do chat

- **`api/src/modules/messaging/infrastructure/engines/baileys/BaileysMessagingEngineAdapter.ts`** — volta a baixar imagens, áudios, vídeos, documentos e stickers recebidos pelo Baileys, salva os binários em `storage/media` e repopula `mediaUrl` nos fluxos de mensagem em tempo real e history sync; corrige o chat exibindo apenas placeholders porque as mensagens estavam sendo persistidas com `mediaUrl=null`
- **`api/src/modules/messaging/infrastructure/engines/baileys/BaileysMessagingEngineAdapter.ts`** — passa a desempacotar wrappers comuns do WhatsApp (`ephemeralMessage`, `viewOnceMessage`, `viewOnceMessageV2`, `documentWithCaptionMessage`, `editedMessage`) antes de classificar a mensagem; corrige casos em que documentos/PDFs não chegavam ao chat como `DOCUMENT`

#### Frontend — Links clicáveis em mensagens de texto

- **`app/src/features/chat/components/messages/RichMessageText.tsx`** — novo renderer de texto com auto-link para URLs `http/https`, preservando quebra de linha e estilo do bubble
- **`app/src/features/chat/components/MessageBubble.tsx`** — mensagens de texto passam a usar renderer rico em vez de `Typography` pura, tornando links clicáveis no chat

#### Frontend — Correção de URL do WebSocket em ambiente de desenvolvimento

- **`useChatWebSocket.ts`** — reescreve a lógica de resolução de URL do WS para caminhos relativos (`/api`): passa a usar `window.location.hostname` + `VITE_API_PORT` ao invés de `window.location.host`, contornando o proxy do Vite 6 que não realiza o upgrade de WebSocket de forma confiável em sub-paths; resolve falha silenciosa de conexão WS ao acessar o painel de outro dispositivo na rede local
- **`app/.env.example`** — documenta `VITE_API_PORT=3000` e adiciona instruções sobre como configurar `VITE_API_URL` para acesso de outros dispositivos na rede

---

## [0.2.0] — 2026-03-22 — Chat V2: reply no WhatsApp, suporte a grupos, avatares em tempo real, menu contextual e estabilização do adapter

### Added

#### Backend — Reply entregue no WhatsApp (dea6c36)

- **`IMessagingEngine.ts`** — `SendTextMessageInput` ganhou `quotedMessage?: QuotedMessageRef | null`; novo tipo `QuotedMessageRef` com `externalId`, `remoteJid`, `fromMe`, `body` e `type` (necessário para montar o proto correto no Baileys)
- **`SendMessageUseCase.ts`** — busca a mensagem citada **antes** de chamar a engine para passar `QuotedMessageRef` completo; elimina segundo `findById` redundante; DTO de retorno inclui `quotedMessage` já resolvido
- **`BaileysMessagingEngineAdapter.ts`** — `sendTextMessage` constrói `WAMessage` mínimo e passa como `{ quoted }` no `socket.sendMessage()`; proto `IMessage` montado por tipo (`image/video/audio/document/text`) — corrige `TypeError` causado pelo proto3 descartar string vazia em `conversation`, quebrando `getContentType()`

#### Frontend — Bloco citado persistente após envio (dea6c36)

- **`ChatPage.tsx`** — no `.then()` do `sendMessage`, após substituir o otimístico, aplica `resolveQuotedMessages`; handler WS `chat.message.created` também resolve quoted em mensagens recebidas
- **`chat.api.types.ts`** — `ChatMessageApiDto` com `quotedMessage?` opcional; `apiMessageToFrontend()` mapeia para `QuotedMessagePreview`
- **`ListMessagesUseCase.ts`** — novo tipo `QuotedMessageSummary`; `ChatMessageDto` com `quotedMessage?: QuotedMessageSummary | null`
- **`ChatPresenter.ts`** — `presentMessage()` serializa `quotedMessage` na resposta HTTP

#### Backend — Suporte a mensagens de grupo (a92f750)

- **`schema.prisma`** — migration `20260321113258` adiciona `isGroup`, `groupJid`, `groupName`, `fromParticipant`, `fromParticipantName`
- **`ChatConversation`** / **`ChatMessage`** — novos campos de grupo nas entidades e value objects
- **`BaileysMessagingEngineAdapter.ts`** — processa mensagens de grupo (`@g.us`); `mapMessagesToHistoryItems` reescrito como `async` com suporte a grupos e download de mídia recente (< 30 min); nova função `fetchAndSaveContactAvatar`
- **`IngestHistorySyncUseCase.ts`** / **`IngestIncomingMessageUseCase.ts`** — aceitam e processam campos de grupo
- **`ChatIncomingMessageListener.ts`** — repassa campos de grupo ao use case
- **`ChatPresenter.ts`** — inclui `isGroup`, `groupJid`, `groupName` na resposta HTTP
- **`PrismaChatContactRepository.ts`** — corrige bug crítico que zerava `avatarUrl` no upsert sem `avatarUrl` explícito

#### Frontend — Exibição de grupos (a92f750)

- **`ConversationListItem.tsx`** — ícone de grupo (`GroupsOutlinedIcon` verde) para conversas `@g.us`
- **`MessageBubble.tsx`** — exibe `fromParticipantName` acima da mensagem em grupos
- **`ChatHeader.tsx`** — exibe ícone de grupo, nome do grupo e avatar
- **`useDomGuardian.ts`** / **`DomGuardian.ts`** — hook e classe para bloquear injeção de CSS externo

#### Backend — Avatares de contatos em tempo real via WebSocket (89d8ec4)

- **`IChatContactRepository.ts`** — novo método `updateAvatarUrlByPhone`
- **`PrismaChatContactRepository.ts`** — implementa `updateAvatarUrlByPhone` via `updateMany`
- **`InternalMessagingEvent.ts`** — novo evento `CONTACT_AVATAR_UPDATED { tenantId, phone, avatarUrl }`
- **`BaileysMessagingEngineAdapter.ts`** — após salvar avatar, emite `CONTACT_AVATAR_UPDATED`; para mensagens individuais recebidas, dispara fetch em background
- **`ChatContactAvatarListener.ts`** (novo) — ouve evento, persiste `avatarUrl` e publica `chat.contact.updated` via WebSocket
- **`ChatWebSocketPublisher.ts`** — tipo `chat.contact.updated { tenantId, phone, avatarUrl }`
- **`server.ts`** — registra `registerChatContactAvatarListener`

#### Frontend — Avatar em tempo real (89d8ec4)

- **`useChatWebSocket.ts`** — `WsContactUpdatedData` e `chat.contact.updated` ao `ChatWsPayload`
- **`ChatPage.tsx`** — trata `chat.contact.updated` atualizando `contact.avatarUrl` no estado local

#### Backend — Avatar de grupos em tempo real (8172db6)

- **`schema.prisma`** — migration `20260321123307` adiciona `groupAvatarUrl String?` em `ChatConversation`
- **`IChatConversationRepository.ts`** — novo método `updateGroupAvatarUrlByGroupJid`
- **`InternalMessagingEvent.ts`** — novo evento `GROUP_AVATAR_UPDATED { tenantId, groupJid, avatarUrl }`
- **`ChatGroupAvatarListener.ts`** (novo) — ouve evento, persiste e publica `chat.contact.updated` com `phone=groupJid`
- **`server.ts`** — registra `registerChatGroupAvatarListener`
- Use cases `ListConversations`, `GetConversationById`, `UpdateConversation` — DTO sintético usa `conv.groupAvatarUrl`

#### Frontend — Avatar no painel de contexto, cores por participante, autoDownloadMedia (570b340)

- **`ConversationDetailsPanel.tsx`** — `src={contact.avatarUrl}` no `Avatar`; toggle de download automático de mídia para grupos
- **`MessageBubble.tsx`** — cores distintas por participante via hash do phone (`participantColor`), igual ao WhatsApp Web
- **`schema.prisma`** — migration `20260321124408` adiciona `autoDownloadMedia Boolean @default(true)` em `ChatConversation`; propagado em todo o stack: entity → mapper → repository → use cases → presenter → rotas → frontend types
- **`BaileysMessagingEngineAdapter.ts`** — cache in-memory `autoDownloadCache`; verifica flag antes de baixar mídia de grupos
- **`MessagingEngineFactory.ts`** — recebe e repassa `chatConversationRepo` ao adapter

#### Backend — Resolução de LID → WID em mensagens de grupo (a060096)

- **`BaileysMessagingEngineAdapter.ts`** — detecta JID `@lid` e chama `socket.signalRepository.lidMapping.getPNForLID(lid)` para resolver o número real; fallback seguro para o LID bruto

#### Frontend — Menu contextual no bubble e nome clicável (a060096)

- **`MessageBubble.tsx`** — botão `⌄` no hover abre `<Menu>` MUI com **Responder**, **Copiar** e **Conversar com [nome]** (só grupos); nome do participante clicável com prop `onParticipantClick?(phone, name)`
- **`MessageList.tsx`** → **`ChatWindow.tsx`** → **`ChatPage.tsx`** — cadeia `onParticipantClick`; `handleParticipantClick` navega à conversa direta com o contato

### Fixed

#### Backend — fromParticipant/fromParticipantName dropados no pipeline (1ca12aa)

- **`ListMessagesUseCase.ts`** — `ChatMessageDto` agora inclui `fromParticipant` / `fromParticipantName`
- **`ChatPresenter.ts`** — serializa os dois campos na resposta HTTP
- **`ChatIncomingMessageListener.ts`** — evento `chat.message.created` (WebSocket) inclui os dois campos
- **`SendMessageUseCase.ts`** / **`ChatWebSocketPublisher.ts`** — DTO e tipo do evento incluem os campos

#### Frontend — Chave JSX duplicada (e62016d)

- **`ConversationListItem.tsx`** — removida chave `key` duplicada que causava warning no React

#### Infraestrutura — Prisma Client não gerado após `pnpm i` (24efa69)

- **`api/package.json`** — adicionado `"postinstall": "prisma generate"` e campo `"pnpm.onlyBuiltDependencies"`; resolve `Cannot find module '.prisma/client/default'` em primeiro uso após clonar ou reinstalar dependências

#### Frontend — Botão Conectar não abria o dialog de QR Code (24efa69)

- **`SessionCard.tsx`** — chama `onRequestQr({ ...session, status: res.status })` imediatamente após `sessionService.connect()` retornar com sucesso; QR Code gerado como **SVG** via `QRCodeSVG` (`qrcode.react`), polling de 4 s

### Changed

#### Backend — Simplificação do `BaileysMessagingEngineAdapter` (b45f4e7)

- **`BaileysMessagingEngineAdapter.ts`** — refactor de estabilização: `@g.us` filtrado junto com `@broadcast`; lógica de grupos, resolução de LID, download automático de mídia, fetch de avatar e reply/quoted removidos do adapter; `sendTextMessage` simplificado para `socket.sendMessage(jid, { text: input.body })` puro; `mapMessagesToHistoryItems` convertido de `async` para síncrono

---
