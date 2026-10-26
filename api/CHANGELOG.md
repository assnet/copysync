# Changelog

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

---

## [Unreleased]

### Added

#### Backend — Gerador de ofertas (`campaigns`, M1-P)

- **`campaigns/domain/services/*`** — funções puras: marketplace por host com allowlist (`detectMarketplace`/`isSupportedProductUrl`), referência do produto, link de afiliado Amazon/ML, texto da oferta, agenda espaçada dos envios, início do dia em `America/Sao_Paulo`
- **`ShopeeAffiliateClient.ts`** — Affiliate Open API (assinatura SHA256), `productOfferV2` + `generateShortLink`, erros traduzidos sem vazar segredo
- **`HttpShortLinkExpander.ts`** / **`HttpOfferImageFetcher.ts`** — redirect manual revalidando cada salto (anti-SSRF); foto só de CDN permitida, ≤ 5 MB
- **`GenerateOfferUseCase`**, **`UpdateOfferUseCase`**, **`SendOfferUseCase`**, **`ProcessDueOfferDispatchesUseCase`**, destinos e uso — gerar, revisar, enviar espaçado e limite diário `offer_generations_per_day` (`PLAN_LIMIT_REACHED`, recontagem sob advisory lock)
- **`OfferDispatchWorker.ts`** — envio durável no banco (`SKIP LOCKED` + `claimToken`), atrás de `OFFER_DISPATCH_WORKER_ENABLED` (padrão `false`)
- **`offer.routes.ts`** — `/api/campaigns/offers` (gerar, editar, enviar, uso, destinos)
- **`SendStoredMediaMessageUseCase.ts`** (chat) — envia imagem já guardada no store; cada mensagem recebe a própria cópia
- **`ListConversationsUseCase`** — filtro opcional `isGroup`
- **`OfferErrors.ts`**, **`PlanErrors.ts`**, **`MediaNotFoundError`** — erros internos novos
- **Migration `20261026160000_create_offers_and_dispatches`** — tabelas `offers`, `offer_dispatches`, `offer_destinations`
- Doc: `docs/gerador-de-ofertas.md`

#### Frontend — Gerador de ofertas

- **`features/offers/`** + **`OfferGeneratorPage.tsx`** — colar link, prévia, edição (preço em BRL, foto por upload em partes, texto), destinos, confirmação e progresso por destino; rota `/offers` e item no menu

### Changed

- **`ResolveAffiliateCredentialUseCase.ts`** — decifra a sessão só para provider que usa sessão (ML); JSON inválido não vaza o texto decifrado na mensagem de erro

### Fixed

- **`DispatchOutboundMediaUseCase.test.ts`**, **`RetryOutboundMediaUseCase.test.ts`** — fakes adaptados ao `acquireLocalFile` do E1 (22 testes quebrados)

#### Backend — S3/R2 Media Storage (E1)

- **`IMediaFileStore.ts`** — contrato estendido com `saveBuffer`, `mediaExists`, `publicUrl` e `acquireLocalFile` (+ tipo `AcquiredMediaFile` com `release()` para limpeza de temporários)
- **`S3MediaFileStore.ts`** — implementação S3-compatível (Cloudflare R2) do `IMediaFileStore`: upload via `PutObjectCommand`, download sob demanda para arquivo temporário (`acquireLocalFile`), remoção e verificação de existência via `HeadObject`
- **`LocalMediaFileStore.ts`** — métodos novos do contrato implementados delegando ao legado `MediaStorage` (sem mudança de comportamento para `MEDIA_STORAGE_DRIVER=local`)
- **`mediaContainer.ts`** — swap point agora escolhe `S3MediaFileStore` ou `LocalMediaFileStore` conforme `env.S3_ENABLED`
- **`env.ts`** — variáveis `MEDIA_STORAGE_DRIVER`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_URL`; derivada `S3_ENABLED`
- **`@aws-sdk/client-s3`**, **`@aws-sdk/s3-request-presigner`** — dependências adicionadas (v3.679.0)

#### Backend — Migração de consumidores para novo contrato de mídia

- **`BaileysMessagingEngineAdapter.ts`** — substituídas chamadas diretas a `saveMediaBuffer`/`mediaFileExists`/`mediaPublicUrl` (legado `MediaStorage`) por `mediaContainer.mediaFileStore.saveBuffer`/`mediaExists`/`publicUrl`; adapter agora funciona com disco ou S3 sem alteração
- **`DispatchOutboundMediaUseCase.ts`** — `resolveLocalPath` + `exists` substituídos por `acquireLocalFile` com `try/finally release()`, permitindo envio de mídia armazenada em S3 (download temporário transparente)
- **`RetryOutboundMediaUseCase.ts`** — verificação de existência migrada para `acquireLocalFile` + `release()` imediato

#### Frontend — CSP correto do painel versionado no Blueprint

- **`render.yaml`** — adiciona `Content-Security-Policy` em `/*` com `connect-src`/`media-src` em `api.copysync.app` (+ `wss:`) e `style-src 'unsafe-inline'` (MUI/Emotion); o CSP configurado à mão no dashboard apontava para domínios de outro projeto e bloqueava estilos inline, deixando login impossível e layout quebrado
- **`docs/app-bloqueio-indexacao.md`** — tabela explicando cada diretiva, registro do incidente e aviso para atualizar o header ao trocar domínio

#### Frontend — Painel invisível para buscadores (app.copysync.app)

- **`app/public/robots.txt`** — `Disallow: /` para todo `User-agent`; o painel é área privada e nenhum crawler deve rastreá-lo
- **`app/index.html`** — `<meta name="robots">` (+ `googlebot`, `bingbot`) com `noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate`; impede indexação mesmo se a URL for descoberta por link externo
- **`render.yaml`** — header `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex` em `/*`, cobrindo também JS, CSS, imagens e manifest (a meta tag só vale para HTML); adiciona `X-Content-Type-Options: nosniff` e `Referrer-Policy`
- **`docs/app-bloqueio-indexacao.md`** — como as três camadas se complementam, por que `robots.txt` sozinho não basta e como verificar após deploy

#### Backend — Vitest

- **`vitest.config.mts`**, **`tsconfig.build.json`**, **`package.json`** — runner de testes na API, com testes co-locados (`Arquivo.test.ts` ao lado do código) e exclusão dos testes do build. Cobertura exigida por camada em `.specs/codebase/TESTING.md`: use cases, mappers e funções puras têm teste; repositórios Prisma e rotas Fastify seguem no smoke manual
- **`src/shared/utils/passwordPolicy.test.ts`** — primeiro teste, sobre código existente, garantindo que a política devolve todas as falhas de uma vez e lança `WeakPasswordError`

### Fixed

#### Backend — History sync do Baileys agora é realmente opt-in

- **`BaileysMessagingEngineAdapter.ts`** — adiciona guard clauses logo na entrada dos handlers de `messages.upsert` do tipo `append` e `messaging-history.set`; quando `BAILEYS_SYNC_FULL_HISTORY=false`, o fluxo retorna antes de chamar `mapMessagesToHistoryItems()` e antes de acionar `IngestHistorySyncUseCase`, impedindo que o reconnect dispare ingestão em lote de histórico no banco
- **`BaileysMessagingEngineAdapter.ts`** — mantém intacto o fluxo de mensagens em tempo real (`type === 'notify'`), então o corte atua apenas no histórico/gap sync; na prática, a API continua recebendo mensagens novas normalmente, mas deixa de abrir a sequência pesada de queries de contatos, conversas e mensagens históricas que estava pressionando o PostgreSQL da Render após reconectar sessões existentes

#### Backend — Deploy seguro sem reconexão automática de sessões WhatsApp

- **`api/src/shared/config/env.ts`** — adiciona `SESSION_BOOTSTRAP_ON_STARTUP` com default `false`, impedindo que a API reconecte sessões WhatsApp automaticamente a cada boot/deploy; isso evita que o startup dispare o Baileys, carregue blobs grandes de `session_auth_states` e gere novos `upsert`s enquanto o PostgreSQL ainda está instável ou enquanto `prisma migrate deploy` tenta validar o banco
- **`api/src/shared/config/env.ts`** — adiciona `SESSION_BOOTSTRAP_MAX_CONCURRENT` com default `1`, permitindo reativar o bootstrap de forma controlada sem reconectar várias sessões em paralelo
- **`api/src/app/server.ts`** — envolve o bootstrap em `if (env.SESSION_BOOTSTRAP_ON_STARTUP)`; quando desligado, a API sobe normalmente, registra os listeners e deixa as sessões desconectadas até reconexão manual pela API/UI, preservando disponibilidade HTTP e reduzindo pressão no banco durante deploy
- **`api/src/modules/sessions/application/services/SessionBootstrapService.ts`** — substitui o `Promise.allSettled` sobre todas as sessões por batches limitados por `maxConcurrent`; quando o bootstrap for ligado explicitamente, as reconexões passam a ocorrer de forma sequencial/controlada, evitando avalanche simultânea de conexão Baileys e persistência de auth state

#### Backend — Persistência do auth state do Baileys: eliminação de upserts desnecessários

- **`BaileysAuthStatePersistence.ts`** — adicionada `areSerializedValuesEqual(left, right)` que compara `JSON.stringify` de dois valores serializados; usada internamente para detectar se um valor realmente mudou antes de marcar o estado como sujo, eliminando gravações em banco provocadas por chamadas repetidas do Baileys com os mesmos dados
- **`BaileysAuthStatePersistence.ts`** — nova função `setStateValue(key, value)` que serializa o novo valor com `BufferJSON.replacer`, compara com o que já está no `stateMap` e só grava se houver diferença; retorna `true` apenas quando a mudança foi efetiva, permitindo que `saveCreds` e `keys.set` decidam de forma confiável se há algo a persistir
- **`BaileysAuthStatePersistence.ts`** — nova função `deleteStateValue(key)` que verifica com `hasOwnProperty` se a key existe antes de deletar; retorna `true` somente quando a remoção ocorreu de fato, evitando que `keys.set` marque dirty em tentativas de deletar keys inexistentes
- **`BaileysAuthStatePersistence.ts`** — nova função `markStateDirty()` que centraliza a atribuição `hasPendingPersist = true`; substitui o flag `dirtyAfterPersistStarted` com nome mais claro e semântica explícita de "há mudanças aguardando a próxima janela de persistência"
- **`BaileysAuthStatePersistence.ts`** — `persistStateWithRetry` passou a receber `statePayload: Record<string, unknown>` em vez de capturar `stateMap` pela closure; a chamada em `flushState` faz `{ ...stateMap }` antes de entrar no loop, garantindo que o snapshot gravado no banco corresponde ao estado no momento em que o flush começou — mudanças que chegam durante o `upsert` assíncrono não são gravadas parcialmente nem perdidas
- **`BaileysAuthStatePersistence.ts`** — `flushState` usa o snapshot explícito e mantém o loop `do … while (hasPendingPersist)` para repetir automaticamente se novas mudanças chegaram enquanto a gravação anterior ainda estava em andamento; a remoção do bloco `if (persistInFlight) { dirtyAfterPersistStarted = true; return }` anterior evita que uma segunda entrada em `flushState` ignore silenciosamente mudanças já marcadas
- **`BaileysAuthStatePersistence.ts`** — novo helper `scheduleDirtyStatePersist()` que combina `markStateDirty()` e `schedulePersistState()` em uma única chamada; simplifica `saveCreds` e `keys.set` que antes chamavam `schedulePersistState()` diretamente sem garantir que `hasPendingPersist` estava setado
- **`BaileysAuthStatePersistence.ts`** — `saveCreds` agora chama `setStateValue(CREDS_KEY, creds)` e agenda persistência somente se o valor retornado for `true`; elimina flushes causados pelo Baileys ao chamar o callback `creds.update` com as mesmas credenciais já persistidas (comportamento comum durante heartbeat e reconfirmação de sessão)
- **`BaileysAuthStatePersistence.ts`** — `keys.set` substitui o `dirty = true` incondicional por `dirty = setStateValue(key, value) || dirty` e `dirty = deleteStateValue(key) || dirty`; a persistência só é agendada quando pelo menos uma key teve mudança efetiva, eliminando upserts disparados por chamadas `keys.set` com dados idênticos aos já armazenados (frequentes durante descriptografia e sincronização de mensagens históricas)

### Changed

#### Backend — Simplificação do BaileysMessagingEngineAdapter: remoção de grupos, mídia, avatares e reply

- **`BaileysMessagingEngineAdapter.ts`** — refactor profundo que reverte o adapter a um estado estável focado exclusivamente em mensagens individuais (`@s.whatsapp.net`):
  - **Mensagens de grupo removidas**: `@g.us` agora é filtrado junto com `@broadcast` em `messages.upsert`; toda lógica de `isGroup`, `groupJid`, `groupName`, `participant` (incluindo resolução de LID de participante via `signalRepository.lidMapping.getPNForLID`) e `participantName` foi removida — os campos correspondentes deixaram de ser emitidos no evento `MESSAGE_RECEIVED`
  - **Download automático de mídia removido**: removidos imports de `downloadMediaMessage`, `saveMediaBuffer`, `mediaPublicUrl` e `mediaFileExists`; removido o cache in-memory `autoDownloadCache` e a dependência de `IChatConversationRepository`; o campo `mediaUrl` não é mais emitido no evento `MESSAGE_RECEIVED`
  - **Reply/quoted no envio removido**: `sendTextMessage` simplificado — a construção de `WAMessage` com proto por tipo (`imageMessage`, `videoMessage`, `audioMessage`, `documentMessage`, `conversation`) e o terceiro argumento `{ quoted }` do `socket.sendMessage()` foram removidos; envio é agora `socket.sendMessage(jid, { text: input.body })` puro
  - **Fetch de avatar em background removido**: chamadas `fetchAndSaveContactAvatar` eliminadas tanto no handler `messages.upsert` (para contatos individuais e grupos) quanto no handler `contacts.upsert`; o `contacts.upsert` agora chama `chatContactRepo.upsert({ tenantId, phone, name })` direto, sem await de avatar
  - **`mapMessagesToHistoryItems` simplificado**: método alterado de `async` para síncrono; parâmetros `socket` e `sessionId` removidos; grupos e broadcasts são filtrados; callback de `messages.upsert` e `messaging-history.set` passam de `async () =>` para `() =>`
  - **Imports removidos**: `downloadMediaMessage`, `WAMessage`, `IChatConversationRepository`, `saveMediaBuffer`, `mediaPublicUrl`, `mediaFileExists`

### Added

#### Backend — Resolução de LID → WID (phone real) em mensagens de grupo

- **`BaileysMessagingEngineAdapter.ts`** — ao extrair o `participant` de uma mensagem de grupo, detecta se o JID retornado termina em `@lid` (Linked Identity do WhatsApp); quando há LID, chama `socket.signalRepository.lidMapping.getPNForLID(lid)` para resolver o número de telefone real (`@s.whatsapp.net` → dígitos puros); fallback seguro para o LID bruto caso a resolução falhe. Isso garante que `fromParticipant` sempre carregue o WID/phone real exibido na sidebar de conversas, não um identificador interno do WhatsApp.

#### Frontend — Menu de contexto nas mensagens de grupo

- **`MessageBubble.tsx`** — ao passar o mouse sobre qualquer balão de mensagem aparece um botão `⌄` no canto superior direito (gradiente de fundo igual à cor do bubble, animação de opacidade); clicar abre um `<Menu>` MUI com as opções:
  - **Responder** — ativa o bloco de reply (mesmo comportamento do botão lateral já existente)
  - **Copiar** — copia o texto da mensagem para o clipboard via `navigator.clipboard`
  - **Conversar com [nome]** — visível apenas em mensagens de grupo recebidas; chama `onParticipantClick(phone, name)` para navegar à conversa direta com o participante

#### Frontend — Nome do participante clicável nos grupos

- **`MessageBubble.tsx`** — linha do nome/telefone do remetente em mensagens de grupo ganhou cursor pointer e underline no hover quando o handler `onParticipantClick` estiver disponível; clicar abre a conversa direta com aquele número; nova prop `onParticipantClick?: (phone: string, name: string) => void`

#### Frontend — Cadeia de propagação de `onParticipantClick`

- **`MessageList.tsx`** — nova prop `onParticipantClick?: (phone: string, name: string) => void` repassada para cada `<MessageBubble>`
- **`ChatWindow.tsx`** — nova prop `onParticipantClick` declarada e repassada para `<MessageList>`
- **`ChatPage.tsx`** — `handleParticipantClick` criado: busca em `conversations` a primeira conversa individual (`isGroup = false`) cujo `contact.phone === phone` e a seleciona via `handleSelectConversation`; caso não exista conversa direta com o contato, a ação é silenciosa

---

## [0.11.0] — 2026-03-21 — Chat V7: reply entregue no WhatsApp, bloco citado persistente e regras de processo no AGENTS.md

### Fixed

#### Backend — Reply nunca chegava ao destinatário no WhatsApp

- **`IMessagingEngine.ts`** — `SendTextMessageInput` ganhou campo `quotedMessage?: QuotedMessageRef | null`; novo tipo `QuotedMessageRef` com `externalId`, `remoteJid`, `fromMe`, `body` e `type` (tipo da mensagem citada, necessário para montar o proto correto)
- **`SendMessageUseCase.ts`** — busca a mensagem citada no repositório **antes** de chamar a engine (em vez de depois); passa `QuotedMessageRef` completo para `engine.sendTextMessage()` incluindo `externalMessageId`, `direction`, `type` e `content`; elimina o segundo `findById` redundante que existia apenas para montar o DTO de retorno
- **`BaileysMessagingEngineAdapter.ts`** — `sendTextMessage` agora constrói um `WAMessage` mínimo e passa como terceiro argumento (`{ quoted }`) ao `socket.sendMessage()`; proto `IMessage` montado por tipo para evitar crash: `image → imageMessage`, `video → videoMessage`, `audio → audioMessage`, `document → documentMessage`, `text/outros → conversation` com fallback `' '` para evitar que proto3 descarte string vazia (o que causava `TypeError: cannot read property of undefined` no `getContentType()` do Baileys)

#### Frontend — Bloco de mensagem citada sumia ~1s após o envio

- **`ChatPage.tsx`** — no `.then()` do `chatService.sendMessage()`, após substituir o otimístico pela mensagem real, aplica `resolveQuotedMessages` ao array completo para repopular `quotedMessage` a partir das mensagens já em memória; mesma correção aplicada ao handler WS `chat.message.created` (mensagens recebidas com `quotedMessageId` também são resolvidas)
- **`chat.api.types.ts`** — `ChatMessageApiDto` ganhou campo opcional `quotedMessage?: { id, type, content, mediaUrl, direction, isDeleted } | null`; `apiMessageToFrontend()` mapeia `dto.quotedMessage` para `QuotedMessagePreview` quando presente, eliminando dependência exclusiva do `resolveQuotedMessages` client-side
- **`ListMessagesUseCase.ts`** — novo tipo exportado `QuotedMessageSummary`; `ChatMessageDto` ganhou campo opcional `quotedMessage?: QuotedMessageSummary | null`
- **`ChatPresenter.ts`** — `presentMessage()` serializa `quotedMessage: dto.quotedMessage ?? null` na resposta HTTP
- **`SendMessageUseCase.ts`** — DTO de retorno inclui `quotedMessage` já resolvido (usando a entidade buscada antes do envio), sem custo de consulta adicional

### Changed

#### Docs — AGENTS.md: regras de processo e versionamento

- **`AGENTS.md`** — adicionadas seções 31–36 adaptadas ao monorepo WaioPrime: fluxo Git obrigatório (branches, workflow de feature/release/hotfix), SemVer com portadores de versão em `api/package.json` + `app/package.json` + `api/CHANGELOG.md` + TAG Git, template de documentação de feature no CHANGELOG, template de seção de release, padrão de commits com escopos (`auth`, `sessions`, `messaging`, `chat`, etc.), template de PR e lista de proibições absolutas de processo

---

## [0.10.0] — 2026-03-12 — Chat V6: envio real via WhatsApp, funcionalidade Responder e player nativo de mídia

### Fixed

#### Backend — Envio de mensagem nunca chegava ao WhatsApp

- **`SendMessageUseCase`** — corrigida falha crítica: o use case salvava a mensagem no banco mas **nunca chamava a engine** para enviar via WhatsApp. Adicionadas dependências `IChatContactRepository` e `IMessagingEngine | null`; agora o fluxo é: busca conversa → busca contato → chama `engine.sendTextMessage()` → salva no banco com o `externalMessageId` retornado pelo Baileys. Se a engine estiver indisponível (sessão desconectada), loga warning e salva sem envio real (sem quebrar o sistema)
- **`chat.routes.ts`** — `SendMessageUseCase` passou a ser instanciado **por-request** (igual ao `MarkConversationAsReadUseCase`), recebendo `contactRepo` e `getActiveEngine()` atualizados no momento do envio

### Added

#### Backend — Suporte a `quotedMessageId` no envio

- **`sendMessageBodySchema`** — campo opcional `quotedMessageId: string` adicionado ao schema de validação do Fastify
- **`SendMessageInput`** — aceita `quotedMessageId?: string | null`
- **`SendMessageUseCase`** — persiste `quotedMessageId` junto com a mensagem criada

#### Frontend — Funcionalidade Responder (reply)

- **`MessageBubble.tsx`** — hover sobre qualquer balão exibe botão `ReplyIcon` lateral (à esquerda para mensagens enviadas, à direita para recebidas); animação de opacidade `0 → 1` no hover; `onReply?: (message: ChatMessage) => void` como prop opcional
- **`MessageList.tsx`** — nova prop `onReply?: (message: ChatMessage) => void` repassada para cada `<MessageBubble>`
- **`MessageComposer.tsx`** — novas props `replyTo?: QuotedMessagePreview | null` e `onCancelReply?: () => void`; exibe banner acima do input com borda colorida lateral (`primary.main`), ícone e label do tipo da mensagem citada (Imagem, Áudio, Vídeo, Documento), texto truncado, botão `CloseIcon` para cancelar
- **`ChatWindow.tsx`** — gerencia estado `replyTo: ChatMessage | null`; `useEffect` limpa o reply ao trocar de conversa; `handleReply` e `handleCancelReply` encadeados para `MessageList` e `MessageComposer`; `handleSend` inclui `quotedMessageId` e limpa o reply após envio; constrói `QuotedMessagePreview` para passar ao composer; assinatura `onSendMessage` atualizada para `(text: string, quotedMessageId?: string | null) => void`
- **`chat.service.ts`** — `sendMessage()` aceita terceiro argumento `quotedMessageId?: string | null` e o inclui no body quando presente
- **`ChatPage.tsx`** — `handleSendMessage` inclui `quotedMessageId`; constrói `quotedMessage` otimista a partir do estado local de mensagens para exibição imediata; `resolveQuotedMessages()` popula `quotedMessage` em todos os itens ao carregar mensagens da API (lookup por `quotedMessageId` dentro do batch)

#### Frontend — Player nativo de áudio

- **`AudioMessage.tsx`** — substituído player customizado (MUI `Slider` + `IconButton`) por `<audio controls>` nativo; o browser fornece play/pause, barra de progresso, volume e menu ⋮ com "Baixar", "Velocidade da reprodução" e "PiP" sem código adicional; `minWidth: 280`, sem altura fixa para não cortar controles

---

## [0.9.0] — 2026-03-12 — Chat V5: tipos de mensagem, metadados, renders dedicados e paginação reversa

### Added

#### Backend — Novos tipos de mensagem

- **`ChatMessageType` (enum)** — adicionados `VIDEO`, `LOCATION`, `VCARD`, `CALL_LOG`; enum completo: `TEXT | IMAGE | AUDIO | DOCUMENT | VIDEO | STICKER | LOCATION | VCARD | CALL_LOG | EVENT`
- **`ChatMessage` (entidade de domínio)** — adicionados campos: `fileName?: string`, `durationSeconds?: number`, `isDeleted?: boolean`, `quotedMessageId?: string`
- **`IChatMessageRepository`** — `ChatMessageCreateData` extendido com os quatro novos campos
- **`PrismaChatMessageMapper`** — `toDomain()` mapeia os quatro novos campos do modelo Prisma para a entidade
- **`PrismaChatMessageRepository`** — `create()` persiste os quatro novos campos

#### Backend — Migração Prisma `20260312110628_add_message_types_and_fields`

- **`schema.prisma`** — `ChatMessageType` enum expandido; `ChatMessage` model com `fileName String?`, `durationSeconds Int?`, `isDeleted Boolean @default(false)`, `quotedMessageId String?`; relação auto-referencial `quotedMessage / quotedBy` para replies

#### Backend — Use cases atualizados

- **`ListMessagesUseCase`** — `ChatMessageDto` inclui `fileName`, `durationSeconds`, `isDeleted`, `quotedMessageId`
- **`SendMessageUseCase`** — retorno agora inclui todos os campos do `ChatMessageDto`
- **`IngestIncomingMessageUseCase`** — input aceita `msgType?`, `mediaUrl?`, `mimeType?`, `fileName?`, `durationSeconds?`, `isDeleted?`, `quotedMessageId?`, `body: string | null`; tipo persistido via `input.msgType ?? TEXT`; função auxiliar `buildPreview()` com labels emoji por tipo
- **`IngestHistorySyncUseCase`** — `HistoryMessageItem` aceita todos os novos campos; `processChunk` usa `item.msgType ?? TEXT`; função auxiliar `buildHistoryPreview()`

#### Backend — Adapter Baileys: extração completa de mensagens

- **`BaileysMessagingEngineAdapter`** — nova função `extractBaileysMessage(m)` que detecta e extrai dados estruturados para todos os tipos: `TEXT` (conversation, extendedTextMessage), `IMAGE`, `VIDEO`, `AUDIO`, `DOCUMENT`, `STICKER`, `LOCATION` (lat/lng → string `"lat,lng"`), `VCARD` (contactMessage, contactsArrayMessage), `CALL_LOG` (call); extrai `mimeType`, `fileName`, `durationSeconds`, `isDeleted` (via protocolMessage.type===0), `quotedMessageId` (via contextInfo.stanzaId); retorna `null` para reactionMessage, pollCreationMessage e protocolMessages não-deleção (não ingere)
- Handlers `messages.upsert` e `mapMessagesToHistoryItems` migrados para usar `extractBaileysMessage()` em vez de extração manual de texto

#### Backend — Eventos e apresentação

- **`InternalMessagingEvent`** — `MESSAGE_RECEIVED` contém `body: string | null`, `msgType?`, `mediaUrl?`, `mimeType?`, `fileName?`, `durationSeconds?`, `isDeleted?`, `quotedMessageId?`
- **`ChatPresenter`** — `presentMessage()` serializa `fileName`, `durationSeconds`, `isDeleted`, `quotedMessageId`
- **`ChatWebSocketPublisher`** — tipo `chat.message.created` inclui os quatro novos campos
- **`ChatIncomingMessageListener`** — passa todos os novos campos do payload para o use case e para o publish WS

#### Frontend — Tipos atualizados

- **`features/chat/types.ts`** — `MessageType` expandido com `'video' | 'location' | 'vcard' | 'call_log'`; nova interface `QuotedMessagePreview`; `ChatMessage.body` agora `string | null`; `ChatMessage` com `mimeType?`, `isDeleted?`, `quotedMessageId?`, `quotedMessage?`
- **`chat.api.types.ts`** — `ApiMessageType` expandido; `ChatMessageApiDto` com `fileName`, `durationSeconds`, `isDeleted`, `quotedMessageId`; `apiMessageToFrontend()` mapeia todos os novos campos

#### Frontend — Componentes de renderização dedicados

Criado diretório `app/src/features/chat/components/messages/` com 10 componentes:

- **`ImageMessage.tsx`** — `<img>` com lightbox modal ao clicar, fallback `BrokenImageOutlined`
- **`AudioMessage.tsx`** — `<audio controls>`, detecção de PTT (ogg/opus), display de duração, fallback
- **`DocumentMessage.tsx`** — card de arquivo com ícone, label de extensão, botão de download
- **`StickerMessage.tsx`** — `<img>` para sticker, fallback `EmojiEmotionsOutlined`
- **`VideoMessage.tsx`** — `<video controls>`, display de duração, fallback de erro
- **`LocationMessage.tsx`** — card com pin vermelho, parse lat/lng, link para Google Maps
- **`VCardMessage.tsx`** — card de contato, parse de vCard (FN/TEL), ícone verde
- **`CallLogMessage.tsx`** — pill centralizado (como eventos do sistema), detecção de chamada perdida/atendida
- **`DeletedMessage.tsx`** — "Mensagem apagada" em itálico com ícone `Block`
- **`QuotedMessage.tsx`** — bloco de reply com borda colorida lateral, ícones por tipo, texto truncado

#### Frontend — `MessageBubble.tsx` reescrito

- Substituído `MediaPlaceholder` genérico pelos 10 renderers especializados
- `call_log` renderiza como pill centralizado (fora da bolha)
- `event` renderiza como pill de sistema centralizado
- `isDeleted` → `DeletedMessage`
- Citação/reply → `QuotedMessage` no topo da bolha antes do conteúdo
- Switch completo por `message.type` para cada renderer dedicado

#### Frontend — Paginação reversa (scroll infinito para cima)

- **`MessageList.tsx`** — novas props: `hasMore`, `isLoadingMore`, `onLoadMore`, `scrollToBottom`; `onScroll` detecta quando `scrollTop < 80px` e dispara `onLoadMore`; `prevScrollHeight` ref preserva posição do scroll após prepend de mensagens antigas; spinner `CircularProgress` no topo durante carregamento; scroll ao fundo apenas no load inicial e quando `scrollToBottom` muda (não em todo re-render)
- **`ChatWindow.tsx`** — aceita e repassa `hasMore`, `isLoadingMore`, `onLoadMore`, `scrollToBottom` para `MessageList`
- **`ChatPage.tsx`** — `PAGE_SIZE = 40`; estados `hasMore`, `isLoadingMore`, `oldestTimestamp` por conversa; `handleSelectConversation` carrega primeiro lote com `limit: PAGE_SIZE` e inicializa cursores; `handleLoadMore` carrega lote anterior com `before: oldestTimestamp[id]` e prepende ao array; trigger `scrollToBottom` (toggle boolean) a cada nova mensagem WS

### Fixed

#### Backend — Filtragem de JIDs LID (Linked Identity)

- **`BaileysMessagingEngineAdapter`** — adicionado filtro `@lid` em todos os handlers (`messages.upsert`, `mapMessagesToHistoryItems`, `contacts.upsert`, `presence.update`); JIDs LID do WhatsApp eram processados como telefones reais, criando contatos e conversas duplicadas com números inválidos

#### Backend — Correção de pushName em mensagens fromMe

- **`IngestIncomingMessageUseCase`** — nome do contato agora só é extraído de `fromName` (pushName) quando `fromMe === false`; evita que o nome do próprio usuário sobrescreva o nome do contato
- **`IngestHistorySyncUseCase`** — mesma correção aplicada ao ingestion de histórico

#### Backend — Proteção contra nomes numéricos em contacts.upsert

- **`PrismaChatContactRepository`** — `findOrCreate` agora promove nomes numéricos para nomes reais quando disponíveis
- **`BaileysMessagingEngineAdapter`** — handler `contacts.upsert` ignora contatos sem nome real ou com nome puramente numérico, evitando sobrescrever nomes já válidos

#### Frontend — WebSocket em dev environment

- **`useChatWebSocket.ts`** — URL do WebSocket agora usa mesma estratégia do apiClient (`VITE_API_URL` com fallback para `http://localhost:3000/api`); compatível com proxy Vite e StrictMode do React

---

## [0.8.0] — 2026-03-10 — Chat V4: presence/typing sync e refinamento de inbox

### Added

#### Backend — Presence/typing sync

- **`InternalMessagingEvent`** — novo tipo `PRESENCE_UPDATED` com `phone` e `presence` (`composing` | `recording` | `available` | `unavailable` | `paused`)
- **`BaileysMessagingEngineAdapter`** — handler `presence.update` do Baileys: extrai `lastKnownPresence` do participante, filtra grupos/broadcasts, emite evento interno `PRESENCE_UPDATED`
- **`IMessagingEngine`** — novo método `presenceSubscribe(sessionId, phone): Promise<void>` para assinar atualizações de presença de um contato
- **`BaileysMessagingEngineAdapter.presenceSubscribe()`** — chama `socket.presenceSubscribe(jid)` no Baileys
- **`ChatPresenceListener.ts`** (novo) — ouve `PRESENCE_UPDATED` no event bus interno e publica `chat.presence.updated` via WebSocket; efêmero, sem persistência
- **`chat.routes.ts`** — `POST /conversations/:id/presence` — recebe ID de conversa, resolve contato, chama `engine.presenceSubscribe()`; retorna `{ subscribed: true/false }`
- **`ChatWebSocketPublisher`** — novo tipo de evento `chat.presence.updated` com `{ tenantId, phone, presence }`
- **`server.ts`** — `registerChatPresenceListener()` registrado no startup

#### Frontend — Presence/typing em tempo real

- **`useChatWebSocket.ts`** — novo tipo `WsPresenceUpdatedData` e evento `chat.presence.updated` no union `ChatWsPayload`
- **`chat.service.ts`** — `subscribePresence(conversationId)` → `POST /chat/conversations/:id/presence`
- **`ChatPage.tsx`** — estado `presenceMap` (phone → presence); handler WS `chat.presence.updated`; chama `subscribePresence()` ao selecionar conversa
- **`ChatWindow.tsx`** — aceita e repassa prop `presence?: string`
- **`ChatHeader.tsx`** — exibe indicador de presença abaixo do nome: "online" (verde), "digitando…" (verde/itálico), "gravando áudio…" (vermelho/itálico)

#### Frontend — Refinamento de inbox

- **`ConversationListItem.tsx`** — aceita prop `presence`; quando contato está digitando ou gravando, substitui preview de última mensagem por indicador colorido ("digitando…" ou "gravando áudio…")
- **`ConversationSidebar.tsx`** — repassa `presenceMap` para cada `ConversationListItem`

- **`BaileysMessagingEngineAdapter`** — adicionado filtro `@lid` em todos os handlers (`messages.upsert`, `mapMessagesToHistoryItems`, `contacts.upsert`, `presence.update`); JIDs LID do WhatsApp eram processados como telefones reais, criando contatos e conversas duplicadas com números inválidos

#### Backend — Correção de pushName em mensagens fromMe

- **`IngestIncomingMessageUseCase`** — nome do contato agora só é extraído de `fromName` (pushName) quando `fromMe === false`; evita que o nome do próprio usuário sobrescreva o nome do contato
- **`IngestHistorySyncUseCase`** — mesma correção aplicada ao ingestion de histórico

#### Backend — Proteção contra nomes numéricos em contacts.upsert

- **`PrismaChatContactRepository`** — `findOrCreate` agora promove nomes numéricos para nomes reais quando disponíveis
- **`BaileysMessagingEngineAdapter`** — handler `contacts.upsert` ignora contatos sem nome real ou com nome puramente numérico, evitando sobrescrever nomes já válidos

#### Frontend — WebSocket em dev environment

- **`useChatWebSocket.ts`** — URL do WebSocket agora usa mesma estratégia do apiClient (`VITE_API_URL` com fallback para `http://localhost:3000/api`); compatível com proxy Vite e StrictMode do React

---

## [0.8.0] — 2026-03-10 — Chat V4: presence/typing sync e refinamento de inbox

### Added

#### Backend — Presence/typing sync

- **`InternalMessagingEvent`** — novo tipo `PRESENCE_UPDATED` com `phone` e `presence` (`composing` | `recording` | `available` | `unavailable` | `paused`)
- **`BaileysMessagingEngineAdapter`** — handler `presence.update` do Baileys: extrai `lastKnownPresence` do participante, filtra grupos/broadcasts, emite evento interno `PRESENCE_UPDATED`
- **`IMessagingEngine`** — novo método `presenceSubscribe(sessionId, phone): Promise<void>` para assinar atualizações de presença de um contato
- **`BaileysMessagingEngineAdapter.presenceSubscribe()`** — chama `socket.presenceSubscribe(jid)` no Baileys
- **`ChatPresenceListener.ts`** (novo) — ouve `PRESENCE_UPDATED` no event bus interno e publica `chat.presence.updated` via WebSocket; efêmero, sem persistência
- **`chat.routes.ts`** — `POST /conversations/:id/presence` — recebe ID de conversa, resolve contato, chama `engine.presenceSubscribe()`; retorna `{ subscribed: true/false }`
- **`ChatWebSocketPublisher`** — novo tipo de evento `chat.presence.updated` com `{ tenantId, phone, presence }`
- **`server.ts`** — `registerChatPresenceListener()` registrado no startup

#### Frontend — Presence/typing em tempo real

- **`useChatWebSocket.ts`** — novo tipo `WsPresenceUpdatedData` e evento `chat.presence.updated` no union `ChatWsPayload`
- **`chat.service.ts`** — `subscribePresence(conversationId)` → `POST /chat/conversations/:id/presence`
- **`ChatPage.tsx`** — estado `presenceMap` (phone → presence); handler WS `chat.presence.updated`; chama `subscribePresence()` ao selecionar conversa
- **`ChatWindow.tsx`** — aceita e repassa prop `presence?: string`
- **`ChatHeader.tsx`** — exibe indicador de presença abaixo do nome: "online" (verde), "digitando…" (verde/itálico), "gravando áudio…" (vermelho/itálico)

#### Frontend — Refinamento de inbox

- **`ConversationListItem.tsx`** — aceita prop `presence`; quando contato está digitando ou gravando, substitui preview de última mensagem por indicador colorido ("digitando…" ou "gravando áudio…")
- **`ConversationSidebar.tsx`** — repassa `presenceMap` para cada `ConversationListItem`
- **`ConversationDetailsPanel.tsx`** — seção "Conversa" agora exibe "Última atividade" e "Não lidas" (quando > 0)

---

## [0.7.0] — 2026-03-10 — History sync, read receipts, delivery status e fromMe

### Added

#### Backend — History sync (messaging-history.set + append)

- **`IngestHistorySyncUseCase.ts`** (novo) — recebe batch de mensagens históricas do Baileys; deduplicação por `externalMessageId`; cria contato + conversa automaticamente; persiste mensagens com timestamp original
- **`BaileysMessagingEngineAdapter`** — handlers `messaging-history.set` e `messages.upsert` type `append` delegam ao `IngestHistorySyncUseCase` via `setImmediate` (não-bloqueante)
- **`mapMessagesToHistoryItems()`** — método privado no adapter que extrai `HistoryMessageItem[]` de mensagens brutas do Baileys, filtrando grupos, broadcasts e mensagens sem conteúdo

#### Backend — Suporte a `fromMe` (mensagens enviadas pelo telefone)

- **`InternalMessagingEvent.MESSAGE_RECEIVED`** — adicionado campo `fromMe?: boolean`
- **`IngestIncomingMessageUseCase`** — recebe `fromMe`; define `direction = OUTBOUND` quando `true`; não incrementa `unreadCount` para mensagens outbound
- **`BaileysMessagingEngineAdapter`** — `messages.upsert` handler não mais pula mensagens `fromMe`; repassa o campo no evento interno

#### Backend — Read receipts (double blue tick)

- **`IMessagingEngine`** — novo método `markMessagesRead(input: MarkMessagesReadInput): Promise<void>`
- **`BaileysMessagingEngineAdapter.markMessagesRead()`** — chama `socket.readMessages()` com keys `fromMe: false`; usa `normalizeJid()` para evitar sufixo `@s.whatsapp.net` duplicado
- **`MarkConversationAsReadUseCase.ts`** (novo) — reseta `unreadCount` no DB + envia receipt da última mensagem INBOUND via engine; recebe engine como nullable (se sessão offline, só reseta DB)
- **`chat.routes.ts`** — `POST /conversations/:id/read` chama o use case e publica `chat.unread.updated` via WS
- **`chat.service.ts` (frontend)** — `markAsRead(conversationId)` → `POST /conversations/:id/read`
- **`ChatPage.tsx`** — `handleSelectConversation` chama `markAsRead` fire-and-forget ao selecionar conversa

#### Backend — Delivery / read status em tempo real (✓✓ ticks)

- **`BaileysMessagingEngineAdapter`** — novo handler `messages.update`: detecta acks de mensagens enviadas (`key.fromMe === true`); status 3 → `MESSAGE_DELIVERED`, status 4/5 → `MESSAGE_READ`
- **`IChatMessageRepository`** — novo método `updateStatusByExternalId(externalId, tenantId, status)`
- **`PrismaChatMessageRepository`** — implementação: busca por `externalMessageId` + atualiza `status`
- **`ChatMessageStatusListener.ts`** (novo) — ouve `MESSAGE_DELIVERED` e `MESSAGE_READ` no event bus; atualiza status no DB; publica `chat.message.status.updated` via WebSocket
- **`ChatWebSocketPublisher`** — novo tipo de evento `chat.message.status.updated` com `{ conversationId, messageId, status }`
- **`server.ts`** — `registerChatMessageStatusListener(chatMessageRepo)` no startup

#### Backend — Engine singleton compartilhado

- **`activeEngine.ts`** (novo) — `setActiveEngine()` / `getActiveEngine()` para compartilhar a instância entre módulos sem acoplamento direto
- **`session.routes.ts`** — chama `setActiveEngine()` após criação da engine

#### Frontend — Status de mensagens em tempo real

- **`useChatWebSocket.ts`** — novo tipo `WsMessageStatusUpdatedData` e evento `chat.message.status.updated` no union `ChatWsPayload`
- **`ChatPage.tsx`** — handler `chat.message.status.updated`: localiza a mensagem pelo `messageId` no estado e atualiza `status` → `MessageBubble` renderiza o tick correto (✓ sent → ✓✓ delivered → ✓✓ azul read)

### Fixed

- **`BaileysMessagingEngineAdapter`** — `messaging-history.set` handler corrigido: antes fazia `histMsgs.map(h => h.message)` que stripava a `key` e descartava tudo; agora passa `histMsgs` direto
- **`BaileysMessagingEngineAdapter`** — `messages.upsert` não mais ignora mensagens `fromMe` (antes tinha `if (msg.key.fromMe) continue`)
- **`markMessagesRead`** — corrigido risco de JID duplicado (`@s.whatsapp.net@s.whatsapp.net`) usando `normalizeJid()` em vez de concatenação direta
- **`vite.config.ts`** — adicionado `ws: true` no proxy `/api` para que conexões WebSocket passem pelo Vite em dev

### Changed

- `IngestIncomingMessageUseCase` — aceita `fromMe` no input; lógica de direction e unread condicional
- `InternalMessagingEvent` — adicionados tipos `MESSAGE_READ` e campo `fromMe` em `MESSAGE_RECEIVED`
- `MessagingEngineFactory` — aceita `chatContactRepo` e `ingestHistorySyncUseCase` como dependências para injeção no adapter

---

## [0.6.0] — 2026-03-10 — Chat V3: WebSocket em tempo real + deduplicação de mensagens

### Added

#### Backend — WebSocket gateway

- **`@fastify/websocket@8.3.1`** instalado (compatível com Fastify v4; v11 exigia Fastify v5)
- **`ws@8.x`** e **`@types/ws`** adicionados como dependências
- **`app.ts`** — `await app.register(websocket)` registrado após o plugin JWT
- **`chat.ws.routes.ts`** (novo) — gateway WebSocket em `GET /api/chat/ws?token=&tenantId=`; autentica via `sseAuthHook` (mesma lógica do SSE); registra/desregistra cliente no `ChatWebSocketPublisher`; keepalive JSON ping a cada 25 s; limpa timer e desregistra ao fechar
- **`routes.ts`** — `chatWsRoutes` registrado sob `/api/chat` após as rotas REST

#### Backend — ChatWebSocketPublisher

- **`ChatWebSocketPublisher.ts`** (novo) — singleton (`chatWsPublisher`) que mantém `Map<tenantId, Set<WebSocket>>`; métodos `subscribe`, `unsubscribe`, `publish`, `pingAll`; remove automaticamente clientes mortos no `publish`
- **`ChatWsEvent`** — union type discriminado com quatro eventos: `chat.message.created`, `chat.conversation.updated`, `chat.unread.updated`, `chat.session.updated`; campo `event: 'ping'` para keepalive

#### Backend — deduplicação de mensagens inbound

- **`IChatMessageRepository`** — adicionado método `findByExternalId(externalId, tenantId): Promise<ChatMessage | null>`
- **`PrismaChatMessageRepository`** — implementação: `prisma.chatMessage.findFirst({ where: { externalMessageId, tenantId } })`
- **`IngestIncomingMessageUseCase`** — step 3 de deduplicação: se `externalMessageId` já existir no banco, retorna `null` sem duplicar; use case agora retorna `IngestIncomingMessageResult | null` com `{ conversationId, message, isNewConversation, unreadCount }` em vez de `void`

#### Backend — publicação automática via WS

- **`ChatIncomingMessageListener`** — após ingestão bem-sucedida, publica `chat.message.created` + `chat.unread.updated` via `chatWsPublisher`; se resultado for `null` (duplicata), ignora silenciosamente
- **`chat.routes.ts`** — handler `PATCH /conversations/:id` publica `chat.conversation.updated` via `chatWsPublisher` após atualizar a conversa

#### Frontend — hook WebSocket

- **`useChatWebSocket.ts`** (novo) — hook React com reconexão automática (backoff exponencial 2 s → 30 s); constrói URL `ws://` a partir de `VITE_API_URL` (compatível com proxy Vite em dev e URL absoluta em produção); tipagem completa de `ChatWsPayload`
- `WsMessageCreatedData`, `WsConversationUpdatedData`, `WsUnreadUpdatedData`, `WsSessionUpdatedData` — interfaces tipadas espelhando `ChatWsEvent` do backend

#### Frontend — ChatPage integrado com WebSocket

- **`ChatPage.tsx`** — substituído `useChatSSE` por `useChatWebSocket`; tratamento diferenciado por evento:
  - `chat.message.created` com `isNewConversation=true` → recarrega lista completa (nova conversa ainda não no estado)
  - `chat.message.created` com conversa já existente → atualiza preview inline no estado sem refetch
  - `chat.message.created` com conversa aberta → insere mensagem diretamente no `messages[id]` sem HTTP
  - `chat.conversation.updated` → atualiza campos da conversa inline
  - `chat.unread.updated` → atualiza badge de não lidos inline

### Fixed

- **`chat.ws.routes.ts`** — assinatura do handler corrigida para `@fastify/websocket` v8: recebe `connection: SocketStream` (com `connection.socket: WebSocket`), não o `WebSocket` diretamente como na v11

### Changed

- `IngestIncomingMessageUseCase.execute()` — assinatura alterada de `Promise<void>` para `Promise<IngestIncomingMessageResult | null>`; `ChatIncomingMessageListener` atualizado correspondentemente

### Tested

- `tsc --noEmit` (api/) — zero erros
- `tsc --noEmit` (app/) — zero erros
- Handshake WebSocket autenticado — `WS CONNECTED OK`
- End-to-end: PATCH conversa → evento `chat.conversation.updated` recebido via WS em < 400 ms
- 2 PATCHes consecutivos → 2 eventos WS independentes entregues (`[PASS] WS sync OK`)
- Baileys conectado e online (`AwaitingInitialSync → Online`) durante os testes

---

## [0.5.0] — 2026-03-10 — Chat V2: ingestão de mensagens WhatsApp em tempo real + SSE

### Added

#### Backend — pipeline de ingestão

- **`InternalMessagingEvent`** — `MESSAGE_RECEIVED` enriquecido com campos `fromName?: string` e `externalMessageId?: string`
- **`IChatConversationRepository`** — novo método `findActiveByContactAndSession(contactId, sessionId, tenantId)` — localiza conversa não-CLOSED para o par contato+sessão
- **`PrismaChatConversationRepository`** — implementação: `status: { notIn: ['CLOSED'] }`, ordenado por `lastMessageAt desc`
- **`IngestIncomingMessageUseCase`** (novo) — orquestra: findOrCreate contato → findActive ou cria conversa → persiste mensagem → atualiza preview + incrementa não lidos
- **`BaileysMessagingEngineAdapter`** — handler `messages.upsert` com `type === 'notify'`: extrai `from`, `body`, `externalMessageId` (key.id), `pushName`; emite `MESSAGE_RECEIVED` no event bus interno
- **`ChatIncomingMessageListener`** (novo) — subscreve `MESSAGE_RECEIVED` no event bus; delega ao `IngestIncomingMessageUseCase`; loga erros sem crashar
- **`server.ts`** — instancia repositórios de chat, `IngestIncomingMessageUseCase` e registra o listener no startup

#### Backend — SSE (Server-Sent Events)

- **`sseAuthHook.ts`** (novo) — preHandler que lê `?token=` e `?tenantId=` da query string, injeta no header `Authorization` e chama `jwtVerify`; resolve tenant context (incluindo super-admin)
- **`chat.routes.ts`** — endpoint `GET /api/chat/events` (SSE): emite `event: message_received` para clientes do tenant; keepalive `:ping` a cada 25 s; desregistra listener ao fechar

#### Frontend — integração SSE

- **`useChatSSE.ts`** (novo) — hook com `EventSource`, lê `?token=` e `?tenantId=` do localStorage; reconexão automática com backoff exponencial (2 s → 30 s)
- **`ChatPage.tsx`** — integrado `useChatSSE`; recarrega lista de conversas e mensagens da conversa aberta ao receber `message_received`

### Tested

- `tsc --noEmit` (api/) — zero erros
- `tsc --noEmit` (app/) — zero erros
- Ingestão verificada via curl (mensagens armazenadas no banco com contato e conversa criados automaticamente)

---

## [0.4.0] — 2026-03-09 — Redesign SaaS do painel + correções de QR e persistência de sessão de usuário

### Added

#### Tema global — dark/light mode

- **`buildTheme(mode: PaletteMode)`** — factory de tema MUI substituindo o export estático anterior; suporta alternância claro/escuro em runtime
- Paleta nova: `primary #4f70e0`, `secondary #7c3aed`; dark: `background.default #0f1117`, `paper #1a1d27`; light: `background.default #f4f6fb`, `paper #ffffff`
- Overrides de componentes MUI: `Button`, `Card`, `Drawer`, `AppBar`, `TextField`, `Chip`, `ListItemButton`, `Dialog`, `IconButton`, `Alert`, `Tooltip`; scroll global customizado

#### ThemeContext — persistência do tema

- **`src/contexts/ThemeContext.tsx`** — `ColorModeProvider` com hook `useColorMode()`; modo persiste em `localStorage.colorMode`; `App.tsx` atualizado para usar `ColorModeProvider` em vez de `ThemeProvider` direto

#### Componentes reutilizáveis — `src/components/`

- **`PageHeader.tsx`** — cabeçalho de página: `{ title, subtitle, action, sx }`; flex layout responsivo
- **`StatCard.tsx`** — cartão de métrica: `{ label, value, icon, accentColor }`; barra lateral de acento colorido + caixa de ícone
- **`EmptyState.tsx`** — estado vazio com borda tracejada: `{ icon, title, description, action }`
- **`SectionCard.tsx`** — card com header e divisor: `{ title, subtitle, action, children, noPadding }`
- **`src/components/index.ts`** — barrel export dos quatro componentes

#### AppLayout — sidebar SaaS

- Reescrito com `DRAWER_WIDTH=248`; componente `NavLogo` com ícone "W" gradiente; seção "EM BREVE" com itens desabilitados (Contatos, Campanhas, Flows, Automação, Assistentes, Métricas) e `<Chip label="Em breve" />` inline
- Botão de toggle claro/escuro na topbar; chip do tenant ativo; bloco inferior da sidebar exibe **e-mail** e **papel** do usuário (`Super Admin` / `Usuário`)

#### LoginPage — layout split-panel

- Reescrita com painel esquerdo (gradiente `primary.dark → secondary.main`) contendo logo, lista de features da plataforma e círculos decorativos; painel direito com formulário de login
- toggle de tema no canto superior direito; painel esquerdo oculto em `xs/sm` (responsivo); card de credenciais de desenvolvimento exibido só em `IS_DEV`

#### DashboardPage — visão geral operacional

- Reescrita com saudação por horário (Bom dia / Boa tarde / Boa noite), chip do tenant ativo, 4 `StatCard` com cores de acento (total/conectadas/aguardando/com problemas)
- `SectionCard` com preview das 5 sessões mais recentes (dot de status + nome + telefone) e botão "Gerenciar"
- `SectionCard` com lista dos próximos módulos (Chatbots, Flows visuais, Campanhas, Assistentes IA, Métricas)

#### SessionsPage

- Atualizada para usar `PageHeader` + `EmptyState` dos componentes reutilizáveis; lógica de negócio intacta

#### SessionCard — card moderno

- Reescrito: avatar com inicial + dot de status (verde/amarelo/vermelho/cinza) posicionado no canto inferior-direito do avatar
- `SessionStatusChip` inline; linha com ícone de telefone + número; data formatada de `updatedAt`
- Efeito hover: `border-color alpha(primary, 0.35)` + `box-shadow`; ações separadas em grupo esquerdo (connect/disconnect/reconnect/logout como `IconButton`) e grupo direito (QR + delete)

#### QrCodeDialog — modal refinado

- Reescrito: sem `DialogTitle` — header customizado com nome da sessão, `SessionStatusChip`, botão de refresh e close
- Frame do QR: `border 2px solid alpha(primary, 0.4)` + `boxShadow` de glow; fundo sempre branco para o QR
- Dot animado com `@keyframes pulse` (opacidade 1→0.3→1 a 1,5s) indicando polling ativo

### Fixed

#### QR — renderização correta

- Instalado `qrcode.react`; tela de QR substituída de `<img src={qrCode}>` (que não renderizava string raw do Baileys) para `<QRCodeSVG value={qrCode} />` — QR agora scaneável corretamente

#### QR — loop infinito de polling

- **Causa raiz:** callback `onStatusChange` criava novo objeto `{ ...prev, status }` → referência de `session` mudava → `useEffect([session])` disparava novamente → novo `setInterval` → loop exponencial
- **Correção 1** (`QrCodeDialog`): dependência trocada de `session` (objeto) para `session?.id` (string primitiva); `fetchStateRef` para evitar stale closure no intervalo; cleanup ao fechar o dialog
- **Correção 2** (`SessionsPage`): `handleStatusChange` memoizado com `useCallback` para estabilizar referência entre re-renders

#### Persistência do usuário após reload

- **Causa:** `loadInitialState` em `AuthContext` só restaurava `accessToken` do `localStorage`; `user` voltava como `null` após qualquer reload, quebrando a exibição de e-mail/papel na sidebar
- **Correção:** objeto `user` serializado em `localStorage.authUser` no login; restaurado no `loadInitialState`; removido no logout

### Tested

- `tsc --noEmit` (app/) — zero erros de tipagem
- Smoke test manual no browser:
  - Login → token e dados do usuário persistidos corretamente (e-mail e papel exibidos na sidebar após reload)
  - Toggle claro/escuro → persist no localStorage, aplicado imediatamente em toda a UI
  - Dashboard → StatCards renderizando totais corretos de sessões; preview de sessões ativas listando corretamente
  - Sessões → `SessionCard` com dot de status correto; ações de connect/disconnect/reconnect/logout funcionando
  - QR dialog → QR code renderiza e é scaneável; polling a cada 5 s sem loops; indicador de pulse visível durante atualização
  - Responsividade verificada (painel esquerdo do login oculto em telas menores)

---

## [0.3.0] — 2026-03-09 — OpenAPI 3.0 / Swagger UI

### Added

#### Dependências

- **`@fastify/swagger@8.15.0`** — geração automática de spec OpenAPI 3.0.3 a partir dos schemas das rotas; versão 8.x compatível com Fastify v4
- **`@fastify/swagger-ui@4.2.0`** — interface Swagger UI servida em `GET /docs`

#### Spec OpenAPI

- Título, versão (0.3.0), descrição e contato cadastrados em `openapi.info`
- Dois servidores declarados: `http://localhost:<PORT>` (local) e `https://waioprime-api.onrender.com` (produção)
- Security scheme **`bearerAuth`** (HTTP Bearer JWT) configurado globalmente; bearer obtido via `POST /api/auth/login`
- Tags declaradas: `Health`, `Auth`, `Tenants`, `Me`, `Sessions`

#### Schemas compartilhados — `app.addSchema()`

Todos registrados via `addSchema()` para reuso por `$ref` em todas as rotas:

- **`LoginResponse`** — objeto com `success`, `data.accessToken`, `data.refreshToken`, `data.user`, `data.tenants`
- **`TenantItem`** — objeto com `id`, `name`, `slug`, `role` (enum OWNER/ADMIN/MEMBER/SUPER_ADMIN), `status`
- **`SessionStatus`** — enum dos 8 estados possíveis de sessão
- **`SessionItem`** — objeto completo de sessão com todos os campos
- **`ErrorResponse`** — objeto `{ success: false, error: { code, message } }`

#### Anotações por rota

Todas as rotas receberam `schema: { tags, summary, description?, security?, headers?, body?, params?, response }`:

- **`GET /health`** — tag Health; response 200 com `status`, `timestamp`, `environment`
- **`POST /api/auth/login`** — body existente reaproveitado; response 200 `LoginResponse`, 401 `ErrorResponse`
- **`POST /api/auth/refresh`** — response 200 `{ accessToken }`, 401 `ErrorResponse`
- **`POST /api/auth/logout`** — `security: [bearerAuth]`; response 204, 401 `ErrorResponse`
- **`GET /api/tenants`** — `security: [bearerAuth]`; response 200 array de `TenantItem`
- **`POST /api/tenants/switch`** — `security: [bearerAuth]`; response 200 `{ accessToken, tenantId, tenantName }`
- **`GET /api/me`** — `security: [bearerAuth]`; response 200 com perfil completo e tenants
- **10 rotas de sessions** — todas com `security: [bearerAuth]`, header `x-tenant-id` obrigatório, params `sessionIdParamSchema` quando aplicável, responses tipados por rota:
  - `POST /api/sessions` → 201 `SessionItem`
  - `GET /api/sessions` → 200 `{ sessions: SessionItem[], total }`
  - `GET /api/sessions/:id` → 200 `SessionItem`
  - `GET /api/sessions/:id/status` → 200 `{ sessionId, status, phone, lastConnectedAt, lastDisconnectedAt }`
  - `POST /api/sessions/:id/connect` → 200 `{ sessionId, status, qrCode?, pairingCode? }`
  - `POST /api/sessions/:id/disconnect` → 200 `{ sessionId, status }`
  - `POST /api/sessions/:id/reconnect` → 200 `{ sessionId, status, qrCode?, pairingCode? }`
  - `POST /api/sessions/:id/logout` → 200 `{ sessionId, status }`
  - `GET /api/sessions/:id/qr` → 200 `{ sessionId, qrCode }`
  - `GET /api/sessions/:id/pairing-code` → 200 `{ sessionId, pairingCode }`

#### Swagger UI

- Servido em `GET /docs` (sem autenticação)
- `docExpansion: 'list'`, `deepLinking: true`, `persistAuthorization: true`

#### CORS

- `allowedHeaders` atualizado para incluir `x-tenant-id`

### Tested

- `tsc --noEmit` — zero erros de tipagem
- Servidor sobe sem erros (`pnpm run dev`)
- `GET /docs` retorna `200 OK` com a interface Swagger UI
- spec JSON disponível em `GET /docs/json`

---

## [0.2.0] — 2026-03-09 — Integração real do Baileys ao módulo de sessions

### Added

#### Baileys — infra da engine de mensageria

- **`@whiskeysockets/baileys@7.0.0-rc.9`** instalado via npm (inclui `lib/` pré-compilado; build scripts de `postinstall` ignorados pelo pnpm por segurança — comportamento esperado)
- **`BaileysAuthStatePersistence.ts`** — implementação de `AuthenticationState` com persistência em banco (tabela `SessionAuthState`); substitui `useMultiFileAuthState`:
  - armazena credenciais e chaves Signal em um único blob JSON por sessão (`statePayload`)
  - serialização via `BufferJSON.replacer/reviver` para roundtrip correto de `Buffer`/`Uint8Array`
  - chaves de tipo `app-state-sync-key` deserializadas via `proto.Message.AppStateSyncKeyData.fromObject()`
- **`BaileysSessionRegistry.ts`** — registro em memória de conexões `WASocket` ativas; singleton compartilhado pelo processo:
  - `ActiveSessionEntry { socket, tenantId, latestQr?, latestPairingCode? }`
  - métodos: `set / get / has / delete / setQr / clearQr / setPairingCode / getQr / getPairingCode / getAll()`
- **`BaileysErrorTranslator.ts`** — tradução de erros e motivos de desconexão Baileys para `AppError` internos:
  - `translateDisconnect(sessionId, lastError)` retorna `{ shouldReconnect, error }` para cada `DisconnectReason`
  - `translateEngineError(err)` para erros genéricos de socket
  - duck-typing sobre `Boom` (sem dependência direta de `@hapi/boom`)

#### BaileysMessagingEngineAdapter — implementação completa

- Substituído stub anterior pela implementação real de `IMessagingEngine`:
  - **`connectSession`** — abre socket Baileys com versão WA buscada via `fetchLatestBaileysVersion()`, auth de banco via `BaileysAuthStatePersistence`, browser fingerprint `Browsers.ubuntu('Chrome')`
  - **`disconnectSession`** — fecha socket, remove do registry, atualiza status `DISCONNECTED`
  - **`reconnectSession`** — delega para `connectSession` (reabre socket com credenciais persistidas)
  - **`logoutSession`** — executa `socket.logout()` + fecha socket + atualiza status `LOGGED_OUT`; credenciais limpos pelo use case
  - **`getSessionStatus`** — inspeciona `ws.readyState` do socket ativo
  - **`getSessionQr`** — lê QR code em memória do registry
  - **`getSessionPairingCode`** — lê pairing code em memória do registry
  - **Reconexão automática com backoff exponencial**: base 3s, máximo 5 tentativas; falha permanente → status `FAILED`
  - Emite todos os eventos internos: `SESSION_CONNECTING`, `SESSION_CONNECTED`, `SESSION_DISCONNECTED`, `SESSION_QR_UPDATED`, `SESSION_LOGGED_OUT`

#### Schema e domínio

- **`SessionStatus`** — adicionados dois novos estados:
  - `AWAITING_QR` — socket aberto aguardando scan do QR
  - `AWAITING_PAIRING` — aguardando código de pareamento
- **Migration** `20260309185659_add_session_awaiting_states` aplicada e versionada
- **`Session.canDisconnect()`** atualizado: inclui `AWAITING_QR` e `AWAITING_PAIRING` como estados desconectáveis

#### IMessagingEngine — novos tipos e métodos

- Interfaces de input explícitas: `ConnectSessionInput`, `DisconnectSessionInput`, `ReconnectSessionInput`, `LogoutSessionInput` (todas com `tenantId`)
- Novos métodos no contrato: `getSessionQr(sessionId)` e `getSessionPairingCode(sessionId)`
- `MessagingEngineFactory.create()` agora recebe `sessionRepo` e `authStateRepo` como parâmetros

#### ISessionRepository — método de bootstrap

- **`findActiveSessionsForBootstrap()`** — retorna todas as sessões (cross-tenant) com status em `CONNECTING | AWAITING_QR | AWAITING_PAIRING | CONNECTED`; usado somente no startup para reconectar sessões ativas

#### Use Cases — integração com engine real

- **`ConnectSessionUseCase`** — injeta `IMessagingEngine`; chama `engine.connectSession()` após atualizar status para `CONNECTING`
- **`DisconnectSessionUseCase`** — injeta `IMessagingEngine`; chama `engine.disconnectSession()` antes de atualizar status
- **`ReconnectSessionUseCase`** — injeta `IMessagingEngine`; chama `engine.reconnectSession()`
- **`LogoutSessionUseCase`** — injeta `IMessagingEngine`; chama `engine.logoutSession()` + limpa `SessionAuthState`

#### Novos Use Cases

- **`GetSessionQrUseCase`** — valida tenant ownership, delega para `engine.getSessionQr()`
- **`GetSessionPairingCodeUseCase`** — valida tenant ownership, delega para `engine.getSessionPairingCode()`

#### SessionBootstrapService

- **`SessionBootstrapService`** — serviço de startup: consulta sessões ativas no banco e chama `engine.reconnectSession()` para cada uma em paralelo (`Promise.allSettled`); falhas individuais são logadas e a sessão é marcada `DISCONNECTED`, sem bloquear o boot

#### Presentation

- **`SessionPresenter`** — adicionados `toQrResult()` e `toPairingCodeResult()`
- **`session.routes.ts`** — engine singleton instanciado via `MessagingEngineFactory`; 2 novas rotas:
  - `GET /api/sessions/:id/qr` — retorna QR code atual (ou `null`)
  - `GET /api/sessions/:id/pairing-code` — retorna pairing code atual (ou `null`)
- **`server.ts`** — chama `SessionBootstrapService.bootstrap()` após o servidor iniciar; falha do bootstrap não derruba o processo

### Changed

- `api/prisma/schema.prisma` — enum `SessionStatus` com 2 novos valores
- `api/package.json` — dependência `@whiskeysockets/baileys@7.0.0-rc.9` adicionada; `package-lock.json` substituído por `pnpm-lock.yaml`

### Tested

- `tsc --noEmit` — zero erros de tipagem
- Smoke test manual end-to-end:
  - `POST /api/auth/login` → token OK
  - `POST /api/sessions` → sessão criada com status `PENDING`
  - `POST /api/sessions/:id/connect` → status muda para `CONNECTING`
  - `GET /api/sessions/:id/status` (após ~8s) → status `AWAITING_QR`
  - `GET /api/sessions/:id/qr` → QR code string retornado corretamente

---

## [0.1.0] — 2026-03-09 — Módulo de sessions com ciclo de vida completo (commit 2ef19eb)

### Added

#### Módulo de Sessions — ciclo de vida completo

- **Schema Prisma** — adicionados campos ao model `Session`:
  - `engine String @default("baileys")` — engine de mensageria da sessão
  - `externalRef String?` — referência externa fornecida pela engine
  - `lastConnectedAt DateTime?` — última conexão confirmada
  - `lastDisconnectedAt DateTime?` — última desconexão/logout
  - `deletedAt DateTime?` — soft delete
- **Schema Prisma** — model `SessionAuthState` revisado:
  - campo `data Json` renomeado para `statePayload Json`
  - adicionados `tenantId String`, `provider String @default("baileys")`, `version Int @default(0)`
  - adicionada relação com `Tenant` e índice em `tenantId`
- **Migration** `20260309175545_add_session_lifecycle_fields` aplicada e versionada

#### Domain

- **`Session.ts`** — entidade atualizada com 6 novos campos e métodos de máquina de estados:
  - `canConnect()` — PENDING | DISCONNECTED | FAILED → CONNECTING
  - `canDisconnect()` — CONNECTED | CONNECTING → DISCONNECTED
  - `canReconnect()` — DISCONNECTED | FAILED | LOGGED_OUT → CONNECTING
  - `isDeleted()` — suporte a soft delete
- **`ISessionRepository.ts`** — contratos revisados com interfaces explícitas `SessionCreateData` e `SessionStatusUpdate`
- **`ISessionAuthStateRepository.ts`** — novo contrato de persistência do estado de autenticação da engine

#### Shared — Audit

- **`IAuditLogRepository.ts`** — contrato de auditoria com tipo `AuditAction` desacoplado do Prisma
- **`PrismaAuditLogRepository.ts`** — implementação via `prisma.auditLog.create()`

#### Application — DTOs e Use Cases

- **`SessionDto.ts`** — DTOs explícitos: `CreateSessionInputDto`, `SessionItemDto`, `SessionStatusDto`, `SessionActionDto` (com `qrCode?` e `pairingCode?` reservados para integração com engine)
- **`CreateSessionUseCase`** — cria sessão em estado `PENDING`, audita `SESSION_CREATED`
- **`ListSessionsUseCase`** — lista sessões ativas do tenant
- **`GetSessionByIdUseCase`** — busca sessão por id com isolamento de tenant
- **`GetSessionStatusUseCase`** — retorna status resumido da sessão
- **`ConnectSessionUseCase`** — valida `canConnect()`, muda para `CONNECTING`, audita `SESSION_CONNECTED`; placeholder para `IMessagingEngine.connectSession()`
- **`DisconnectSessionUseCase`** — valida `canDisconnect()`, muda para `DISCONNECTED`, registra `lastDisconnectedAt`, audita `SESSION_DISCONNECTED`; placeholder para engine
- **`ReconnectSessionUseCase`** — valida `canReconnect()`, muda para `CONNECTING`, audita `SESSION_CONNECTED` com `meta.action = reconnect_requested`; placeholder para engine
- **`LogoutSessionUseCase`** — muda para `LOGGED_OUT`, limpa `SessionAuthState` via repositório, audita `SESSION_LOGGED_OUT`; placeholder para engine

#### Infrastructure

- **`PrismaSessionMapper.ts`** — converte `PrismaSession` → `Session` (domínio)
- **`PrismaSessionRepository.ts`** — implementação com padrão `updateMany({ where: {id, tenantId} })` para isolamento de tenant em nível de banco (defense-in-depth); `findById` usa `deletedAt: null`
- **`PrismaSessionAuthStateRepository.ts`** — upsert com incremento de `version`; `deleteMany` no logout

#### Presentation

- **`SessionPresenter.ts`** — transforma outputs dos use cases em respostas HTTP (`toSessionItem`, `toSessionList`, `toSessionStatus`, `toConnectResult`, `toActionResult`)
- **`session.schema.ts`** — schemas de validação JSON Schema para Fastify (`createSessionBodySchema`, `sessionIdParamSchema`)
- **`session.routes.ts`** — 8 rotas registradas, todas com `preHandler: [authHook, tenantHook]`:
  - `POST /api/sessions` — cria sessão
  - `GET /api/sessions` — lista sessões do tenant
  - `GET /api/sessions/:id` — detalhe da sessão
  - `GET /api/sessions/:id/status` — status resumido
  - `POST /api/sessions/:id/connect` — solicita conexão
  - `POST /api/sessions/:id/disconnect` — solicita desconexão
  - `POST /api/sessions/:id/reconnect` — solicita reconexão
  - `POST /api/sessions/:id/logout` — logout e limpeza de credenciais
- **`routes.ts`** — registradas as rotas de sessions em `${API_PREFIX}/sessions`

### Changed

- `api/src/app/routes.ts` — importa e registra `sessionRoutes`
- `api/prisma/schema.prisma` — modelos `Session`, `SessionAuthState` e `Tenant` atualizados

### Fixed

- Padrão `updateMany` no repositório de sessões contorna limitação do Prisma (`update` só aceita campos únicos no `where`), garantindo isolamento de tenant em todas as mutações

---

## [0.1.0] — 2026-03-09 — Commit inicial

### Added

- Estrutura inicial do monorepo (`api/`, `app/`, `panel/`, `scripts/`)
- Base da API com **Fastify + TypeScript + Prisma + PostgreSQL**
- Configuração centralizada com `dotenv`
- Logger estruturado (`pino`)
- Tratamento global de erros e healthcheck (`GET /health`)
- Módulo de **autenticação** (login, access token, refresh token)
- Módulo de **tenants** (criação, listagem, gerenciamento)
- Módulo de **usuários** (me, update)
- Multi-tenancy com `tenantHook` e `authHook`
- Schema Prisma inicial com entidades: `Tenant`, `User`, `UserTenant`, `Session`, `SessionAuthState`, `Message`, `Contact`, `AuditLog`
- Migrations versionadas
- Seed de dados iniciais
