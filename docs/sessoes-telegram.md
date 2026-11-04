# Sessões Telegram (engine `telegram`)

Item 2 do [`produto-roadmap.md`](produto-roadmap.md). Conecta a **conta Telegram do próprio
usuário** (MTProto, lib [`telegram`/GramJS](https://gram.js.org/)) como segunda engine atrás de
`IMessagingEngine`. Limite por plano: `telegram_sessions` = 0 (Lite) / 1 (Pro) / 2 (Max).

Status: **F1 + F2 (api 0.51.0 · app 0.64.0, 2026-11-04)** — criar, conectar (código ou QR),
listar, limite por canal, receber texto e enviar texto/mídia. **Pendente (F3):** Telegram como
origem/destino no Monitoramento e nos grupos de disparo; download de mídia recebida.

Termos: **sessão** (nunca instância), **canal** (WhatsApp × Telegram), **código de login** (o que o
Telegram manda ao app do usuário), **senha de duas etapas** (2FA da conta).

## 1. Por que conta de usuário e não bot, e por que um número só

| Alternativa | Veredito | Por quê |
|---|---|---|
| Bot API | ❌ | bot não entra em grupo de concorrente, não abre link de convite, só lê com privacidade desligada. Inviabiliza o Monitoramento |
| Conta de usuário via MTProto (GramJS) | ✅ | lê qualquer grupo em que a conta está, posta como pessoa, mídia, login por telefone+código ou QR. JS puro, roda na Render |
| TDLib (`tdl`) | ❌ | binário nativo no container |
| Número da plataforma no grupo + "outro número" do usuário (modelo de concorrentes) | ❌ | gambiarra para o listener deles distinguir post original de eco. Aqui o eco é reconhecido pelo **id da mensagem enviada** (`sentIds`), como no WhatsApp (`createOutboundMessageId`). Zero número da plataforma, zero segundo número |

Único dado da plataforma: `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` de **um** app registrado em
[my.telegram.org](https://my.telegram.org/apps) (uma vez, pela CopySync; nunca por tenant).

## 2. Onde está

| Peça | Arquivo |
|---|---|
| Adapter (único lugar que importa `telegram`) | `api/src/modules/messaging/infrastructure/engines/telegram/TelegramMessagingEngineAdapter.ts` |
| Login pendente, registry em memória | `…/telegram/TelegramSessionRegistry.ts` (`PendingLogin` com `Deferred`s) |
| Credencial cifrada | `…/telegram/TelegramAuthStatePersistence.ts` |
| Tradução de erros | `…/telegram/TelegramErrorTranslator.ts` |
| Roteador por engine | `api/src/modules/messaging/infrastructure/MessagingEngineRouter.ts`; `MessagingEngineFactory.createRouter` |
| Porta | `IMessagingEngine.requestLoginCode / submitLoginCode / submitLoginPassword` |
| Use cases | `sessions/application/use-cases/SessionLoginByCodeUseCases.ts`, `GetSessionLimitsUseCase.ts`, `CreateSessionUseCase.ts` |
| Telefone internacional | `sessions/domain/services/normalizeInternationalPhone.ts` |
| Engines válidas | `sessions/domain/sessionEngines.ts` (`baileys`, `telegram`) |
| Migration | `20261103120000_add_telegram_session_statuses` (`AWAITING_CODE`, `AWAITING_PASSWORD`) |
| Erros | `shared/errors/internal/TelegramErrors.ts`, `MessagingErrors.ts` (`ENGINE_DISABLED`, `ENGINE_OPERATION_UNSUPPORTED`) |
| Painel | `app/src/features/sessions/` (wizard Telegram, painel de código/QR, contadores por canal), `pages/SessionsPage.tsx` |

## 3. API

Todas sob `/api/sessions`, mesmas regras das rotas de sessão (sem envelope).

- `GET /limits` → `{ whatsapp: { used, limit }, telegram: { used, limit, enabled } }`. `limit null` = ilimitado;
  `enabled=false` = engine desligada no servidor (painel mostra indisponível, não erro).
- `POST /` `{ name, engine: 'telegram', declaredPhone? }` — telefone com DDI (`+55 11 9…` ou `5511…`; 10–11 dígitos sem `+` = Brasil).
  Limite por canal: `PLAN_LIMIT_REACHED` 403 `meta { key: 'telegram_sessions', limit }`. Engine desligada: `ENGINE_DISABLED` 503.
- `POST /:id/telegram/send-code` `{ phone? }` → `{ sessionId, status: 'AWAITING_CODE' }`. Sem `phone` usa `declaredPhone`.
- `POST /:id/telegram/sign-in` `{ code }` → `status: 'CONNECTED' | 'AWAITING_PASSWORD'`.
- `POST /:id/telegram/password` `{ password }` → `status: 'CONNECTED'`.
- `POST /:id/connect` — com credencial salva conecta direto; sem ela inicia **login por QR**: `GET /:id/qr` devolve
  `tg://login?token=…` (troca a cada ~30 s; o polling do painel pega o novo). Usuário escaneia em
  Telegram › Configurações › Dispositivos › Conectar dispositivo.
- `reconnect`, `disconnect`, `logout`, `DELETE`: iguais ao WhatsApp. `logout` chama `auth.LogOut` e apaga a credencial.
- Erros do login: `TELEGRAM_PHONE_INVALID`, `TELEGRAM_CODE_INVALID`, `TELEGRAM_CODE_EXPIRED`, `TELEGRAM_PASSWORD_INVALID` (422),
  `TELEGRAM_FLOOD_WAIT` (429, `meta.seconds`), `TELEGRAM_LOGIN_NOT_PENDING` (409), `PAIRING_FAILED` (400, outros RPC).
- Em sessão WhatsApp, as rotas `telegram/*` respondem `ENGINE_OPERATION_UNSUPPORTED` 422.

## 4. Como o login funciona por dentro

`client.start()` (código) ou `client.signInUserWithQrCode()` (QR) rodam em **background**; os callbacks
`phoneCode`/`password` devolvem `Deferred`s que `submitLoginCode`/`submitLoginPassword` resolvem. Cada
submit cria um `waiter` que recebe o resultado do passo: `onError` da lib → `waiter.reject(erro traduzido)`
e a lib pede o valor de novo; callback `password` → `waiter.resolve(AWAITING_PASSWORD)`; fim do fluxo →
`finishLogin` salva a StringSession cifrada, lê `getMe().phone` para `Session.phone`, registra o handler
`NewMessage` e marca `CONNECTED`. Disconnect/delete rejeitam os `Deferred`s com `AUTH_USER_CANCEL` (a lib
encerra o fluxo). Restart da API perde o login pendente: a sessão fica `FAILED`/`DISCONNECTED` e o operador
pede código de novo (como o pareamento do WhatsApp).

## 5. Identificadores e eventos

- `to`, `from`, `groupJid`: **peer id marcado** do Telegram em texto — `"123456"` usuário, `"-123456"` grupo
  pequeno, `"-100123456"` supergrupo/canal. Sufixo `@g.us`/`@s.whatsapp.net` anexado pelo chat é descartado
  no adapter. `isGroup` = id começa com `-`.
- **Id externo de mensagem = `<peerId>_<msgId>`** (`telegramMessageId.ts`; ex.: `-1001234567890_42`). O `msg.id`
  do Telegram só é único no chat (supergrupo/canal) ou na caixa da conta; sem o peer colidiria na unique da
  captura (`[sessionId, sourceExternalMessageId]`) e no dedupe do chat (`findByExternalId`). Vale para
  `MESSAGE_RECEIVED`, `quotedMessageId` (peer de `replyToPeerId` quando a citação é de outro chat), o id
  devolvido por `sendTextMessage`, `MESSAGE_SENT` e o eco (`sentIds`, últimos 500, com o peer **resolvido**
  pelo `getInputEntity`, igual ao `msg.peerId` do eco). Tudo que volta à engine (citação, reação, lidas) passa
  por `parseTelegramMessageId`, que aceita também o id legado só numérico. Id provisório `tg-<hex>` não faz
  parse: citar/reagir a mídia enviada pelo painel não cita (reação → `MESSAGE_SEND_FAILED`).
- `MESSAGE_RECEIVED`: texto e legenda; **`msgType` no enum do chat (`TEXT`/`IMAGE`/`VIDEO`/`AUDIO`/`DOCUMENT`/
  `STICKER`)**, igual ao Baileys — a captura do monitoramento compara `=== 'IMAGE'`. `mimeType`, `fileName` e
  `durationSeconds` vêm do documento (foto = `image/jpeg`).
- **Mídia recebida** vai para o `mediaFileStore` (`<sessionId>_tg_<id>.<ext>`) com a mesma regra do Baileys:
  contato sempre; grupo só com `autoDownloadMedia` na conversa (salvar grupo monitorado liga). Foto no maior
  tamanho; vídeo/áudio/documento/figurinha até **20 MiB** (`TELEGRAM_INBOUND_MEDIA_MAX_BYTES`, checado pelo
  tamanho declarado e pelo buffer). Acima do limite ou falha → `mediaUrl: null`, a mensagem entra igual.
  Download em memória (buffer), como o Baileys; prévia de link recebida (`linkPreview`) ainda é `null`.
- **Formatação de envio**: texto e legenda chegam no formato do WhatsApp (`*negrito*`, `_itálico_`, `~riscado~`,
  `` `mono` ``, ```` ``` ````) e saem como HTML do Telegram (`parseMode: 'html'`) via `whatsappToTelegramHtml.ts`
  (função pura, testada): escapa `&<>`, separa links antes da marcação (`_`/`*` em link de afiliado ficam
  intactos), marca só fora de palavra (`snake_case` não vira itálico).
- **Prévia de link**: com `linkPreview` no envio (oferta `LINK_PREVIEW`), o Telegram gera a **prévia nativa**
  do 1º link do texto; o cartão/miniatura montado por nós não é usado. Sem `linkPreview` → sem prévia (igual
  ao WhatsApp). **Menções** (`mentions`, "Marcar todos") são ignoradas sem erro; o `ChatOfferMessageSender`
  nem busca participantes em conversa `channel = telegram`.
- `createOutboundMessageId` devolve id provisório `tg-<hex>` (o Telegram atribui o id real no envio);
  `sendMediaMessage` devolve o id real composto (`<peer>_<msgId>`) e o registra em `sentIds` (eco descartado);
  o `DispatchOutboundMediaUseCase` troca o provisório pelo real na mesma escrita do `SENT`
  (`transitionStatus(..., externalMessageId)`). Não voltar a devolver o provisório: citação/reação/status quebram.
- **Canal da conversa**: conversas criadas para sessão Telegram gravam `channel = 'telegram'`
  (`chat/domain/services/conversationChannel.ts`, pela `Session.engine`: ingestão via
  `ISessionRepository.findEngineById` só ao criar, `StartConversationUseCase`, `ChatSessionGroupDirectory`).
  Conversas criadas antes ficam `whatsapp`.
- `FLOOD_WAIT` no envio vira `TELEGRAM_FLOOD_WAIT` (429, `meta.seconds`). No worker de ofertas o envio volta à
  fila com `notBefore = agora + seconds + 1 s`, segurando a vez da sessão (`deferForOfflineSession` com
  `failureReason = TELEGRAM_FLOOD_WAIT` enquanto QUEUED: marca que `waitingSessionSince` conta o flood, não a
  queda — sem coluna nova). Flood acumulado (desde o 1º + espera pedida) ≥ 6 h ou envio sem `sessionId` →
  `FAILED TELEGRAM_FLOOD_WAIT` (atrasados da sessão juntos). Queda depois de flood ganha janela própria de 6 h.
- `getGroupInviteLink.inviteCode` é o que vem depois de `https://t.me/` (ex.: `+AbCd…`): quem monta a URL
  precisa saber o canal.
- `fetchProfilePicture`: foto da própria conta (quando `jid` é o telefone da sessão, como pede a listagem de
  sessões), de grupo/canal ou contato (peer id). Baixada (`downloadProfilePhoto`, pequena) e salva no
  `mediaFileStore` (`avatar_tg_*.jpg`), cache 6 h por sessão+peer — mesmo modelo do WhatsApp. Sem foto → `null`.
- `listParticipatingGroups` devolve `avatarUrl` (campo opcional da porta): foto pequena do grupo no storage como
  `avatar_tg_<id>_<photoId>.jpg` (foto nova = arquivo novo). Já salva → URL na hora; faltando → download em **fila
  única** (sem rajada, evita `FLOOD_WAIT`), a listagem espera até 3 s e o resto entra na próxima. Cada download
  emite `GROUP_AVATAR_UPDATED`, que grava `groupAvatarUrl` nas conversas do grupo (monitorados/disparo).
  `mergeSessionGroups` usa a foto da conversa e, sem ela, a da engine.
- `listParticipatingGroups` lista **todos** os grupos, supergrupos e canais ativos (sem `left`/`deactivated`),
  inclusive canal em que a conta só é inscrita, e devolve `canPost` (opcional na porta; ausente = true, WhatsApp
  não manda): canal broadcast → `creator || adminRights.postMessages`; grupo/supergrupo → false só com
  `defaultBannedRights.sendMessages` e a conta sem creator/admin. Canal só de leitura serve para **monitorar**;
  como destino (`EnsureSessionGroupUseCase` com `purpose: 'send'`, padrão) → 422 `GROUP_NOT_POSTABLE`. O painel
  esconde `canPost === false` nos seletores de destino (gerador, disparo) e o rodízio de links filtra no adapter.
  Não voltar a remover canais da listagem: o seletor de monitorados depende deles.
- `checkNumberExists` → `null`; `updateChatState`, `presenceSubscribe` → no-op.

## 6. Configuração

| Variável | Padrão | Nota |
|---|---|---|
| `TELEGRAM_ENGINE_ENABLED` | `false` | liga a engine. Sem ela: `GET /limits.telegram.enabled=false`, criar sessão Telegram → 503 |
| `TELEGRAM_API_ID` | — | inteiro do app em my.telegram.org |
| `TELEGRAM_API_HASH` | — | hash do app |
| `CREDENTIALS_ENCRYPTION_KEY` | — | já usada pelas credenciais de afiliado; obrigatória para cifrar a StringSession |

Como obter `api_id`/`api_hash`: entrar em https://my.telegram.org com o número do dono da plataforma →
*API development tools* → criar app (nome do produto, plataforma "Web", URL do painel) → copiar
`App api_id` e `App api_hash`. Guardar na Render (API) e no `.env` local. **Nunca** no git, nunca
num tenant: o par identifica a aplicação, não a conta.

## 7. O que não fazer

- Não importar `telegram` fora de `engines/telegram/`. Não usar Bot API.
- Não pedir ao usuário um "segundo número" nem colocar número da plataforma em grupo: o eco é por id.
- Não guardar a StringSession em claro, em log ou fora de `SessionAuthKey` cifrada.
- Não contar sessões Telegram em `whatsapp_sessions` (limite é por engine, `SessionLimit.engine`).
- Não tratar `groupJid` do Telegram como dígitos de WhatsApp (tem `-` na frente); consumidores novos
  (monitoramento, disparo) resolvem o canal pela `Session.engine`.
- Não disparar em rajada: `FLOOD_WAIT` do Telegram vira 429 e pode banir conta nova. Telegram entra
  na fila por sessão (`fila-de-envio.md`) com intervalo próprio quando chegar a F3.
- Não usar `String(msg.id)` como id externo nem `Number(externalId)` de volta: sempre
  `composeTelegramMessageId`/`parseTelegramMessageId`.
- Não emitir `msgType` em minúsculas nem fora do `ChatMessageType`.
- Não mandar texto do WhatsApp cru ao Telegram nem com `parseMode` markdown: só `whatsappToTelegramHtml` + `html`.
- Não baixar mídia de grupo sem `autoDownloadMedia` nem sem limite de bytes.
- Não gravar `channel: 'whatsapp'` fixo ao criar conversa: usar `channelForEngine`.

## 8. Verificado × não verificado

- ✅ `tsc`, testes unitários (roteador, use cases, repositório, presets, telefone internacional, id composto,
  conversor HTML, `msgType`, canal da conversa, `FLOOD_WAIT` reagendado, `GROUP_JID_PATTERN`).
- ⏳ Pendente: `FLOOD_WAIT` na **fila de mídia** (oferta `MEDIA` com foto) — o erro acontece no job depois de
  enfileirar e a mensagem fica `FAILED` com o envio `SENT` (mesmo limite da falha assíncrona de mídia);
  prévia de link recebida.
- ❌ Não testado contra o Telegram real (sem `api_id`/`api_hash` no momento da entrega): envio do código,
  2FA, QR, recepção em grupo, `FLOOD_WAIT`, download de foto recebida, HTML na legenda/texto, prévia nativa.
  Primeiro teste real deve cobrir esses pontos.
