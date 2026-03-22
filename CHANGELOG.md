# Changelog

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

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
