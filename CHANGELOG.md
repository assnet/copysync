# Changelog

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

---

## [Unreleased]

### Added

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

#### Backend — Estabilidade ao conectar sessões WhatsApp na Render

- **`api/Dockerfile`** — remove `prisma migrate deploy` do `CMD` do container web; migrations devem rodar no pre-deploy/one-off job, evitando que o serviço HTTP morra antes de subir quando o PostgreSQL oscila temporariamente
- **`api/scripts/prisma-migrate-deploy-with-retry.mjs`** — adiciona `PRISMA_DEPLOY_ALLOW_UNAVAILABLE=true` como escape operacional explícito para permitir rollout quando o banco fecha conexão durante o pre-deploy e não há migration pendente crítica
- **`api/src/modules/messaging/infrastructure/engines/baileys/BaileysMessagingEngineAdapter.ts`** — desliga o `syncFullHistory` completo por padrão via `BAILEYS_SYNC_FULL_HISTORY=false`, reduzindo picos de memória/CPU ao conectar um número novo; também blinda handlers `connection.update`, `messages.upsert` e `messaging-history.set` para que falhas transitórias do Prisma (`P1001`/`P1017`) não derrubem o processo Node
- **`api/src/modules/messaging/infrastructure/engines/baileys/BaileysAuthStatePersistence.ts`** — agrupa persistências do auth state com debounce e retry antes de gravar no PostgreSQL, reduzindo a avalanche de `sessionAuthState.upsert()` durante descriptografia, retry de mensagens e conexão de novos números
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
