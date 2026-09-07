# Reações em Mensagens — Tasks

**Design**: `.specs/features/message-reactions/design.md`
**Status**: Draft
**Branch**: `feature/chat-message-reactions` (a partir de `develop`, conforme AGENTS.md §31)

---

## Gates

**Vitest 5 já instalado e rodando** nos dois apps (feito antes desta feature — ver
`.specs/codebase/TESTING.md` para a matriz de cobertura completa e as convenções).

| Gate | Comando |
| --- | --- |
| `quick` | `pnpm typecheck && pnpm test` no app que a task tocar (`api/` ou `app/`) |
| `full` | `quick` nos dois + `pnpm prisma:generate` quando o schema mudar |
| `smoke` | Roteiro manual da T23, com sessão WhatsApp real |

**Testes são co-locados, nunca task separada**: a task que cria a lógica cria o teste dela.
Camadas com teste exigido nesta feature (pela matriz): use cases, mappers, funções puras de
normalização do adapter, funções puras do painel e componentes visuais com lógica.
Repositórios Prisma, rotas Fastify e `ChatPage` ficam no smoke — não há banco de teste nem
Fastify em pé, e forçar isso agora inflaria a feature.

## Skills do repositório (`.agents/skills/`) por task

Não são carregadas automaticamente pelo Claude Code (que lê `.claude/skills/`) — são lidas e
seguidas como instrução ao executar a task.

| Skill | Onde entra |
| --- | --- |
| `ui-ux-pro-max` | T18, T19, T20 — decisões visuais dos chips e da barra (contraste, densidade, hierarquia) |
| `frontend-design` | T18, T19 — evitar que a barra de reação vire componente genérico de template |
| `web-design-guidelines` | T19, T20 — auditoria de acessibilidade (`aria-pressed`, foco, alvo de toque) |
| `agent-browser` / `playwright-cli` | T23 — abrir o painel, reagir, conferir os três temas e capturar evidência |
| `copywriting` | T15 — textos curtos dos tooltips e da mensagem de erro |
| `the-fool` (`.claude/skills/`) | Antes de T1 — stress test das premissas do design, se quiser mais uma passada |

---

## Execution Plan

### Fase 1 — Contratos e dados

```
T1 ─┐
    ├→ T3
T2 ─┘
T4 (paralela)
T5 (paralela)
```

### Fase 2 — Engine

```
T4 → T6
T5 → T7
```

### Fase 3 — Aplicação e transporte

```
T8 ──┐
T3 ──┼→ T9 ──┐
T4 ──┘        ├→ T14
T3 → T10 ─┐   │
T3 → T11  │   │
T12 ──────┼───┘
T7,T10,T12 → T13
```

### Fase 4 — Painel

```
T15 ─┐
T17 ─┼→ T18 ─┐
T14 → T16 ───┼→ T19 → T20 → T21
```

### Fase 5 — Fechamento

```
T21 → T22 → T23
```

---

## Task Breakdown

### T1: Model Prisma + migration das reações

**What**: Adicionar `ChatMessageReaction` ao schema com relações em `ChatMessage` e `Tenant`, e gerar a migration.
**Where**: `api/prisma/schema.prisma`, `api/prisma/migrations/<ts>_add_chat_message_reactions/`
**Depends on**: None
**Reuses**: Estilo do model `ChatMessage` (cuid, `@@map`, índices tenant-aware)
**Requirement**: REACT-02, REACT-07

**Done when**:
- [ ] Model conforme §4 do design, com `@@unique([messageId, reactorKey])` e `@@index([tenantId, messageId])`
- [ ] Back-relations em `ChatMessage.reactions` e `Tenant.chatMessageReactions`
- [ ] `pnpm prisma:migrate --name add_chat_message_reactions` (snake_case, como `20260907060000_add_conversation_state_flags`) gera migration aditiva — nenhuma migration existente editada
- [ ] Schema alterado é o de `api/prisma/schema.prisma` (não existe outro diretório `prisma/` no repo — verificado)
- [ ] `pnpm prisma:generate` sem erros

**Gate**: full

---

### T2: Entidade de domínio + contrato do repositório [P]

**What**: Criar `ChatMessageReaction` (entidade pura) e `IChatMessageReactionRepository` com `upsert`, `remove`, `findByMessageId`, `findByMessageIds`.
**Where**: `api/src/modules/chat/domain/entities/ChatMessageReaction.ts`, `api/src/modules/chat/domain/contracts/IChatMessageReactionRepository.ts`
**Depends on**: None
**Reuses**: Forma de `ChatMessage.ts` e `IChatMessageRepository.ts`
**Requirement**: REACT-02

**Done when**:
- [ ] Entidade sem qualquer import de Prisma/Fastify/Baileys
- [ ] Todo método do contrato recebe `tenantId`
- [ ] Tipos de input (`UpsertReactionInput`) exportados

**Gate**: quick (api)

---

### T3: Mapper + repositório Prisma

**What**: Implementar `PrismaChatMessageReactionMapper` e `PrismaChatMessageReactionRepository`.
**Where**: `api/src/modules/chat/infrastructure/mappers/`, `api/src/modules/chat/infrastructure/repositories/`
**Depends on**: T1, T2
**Reuses**: `PrismaChatMessageMapper`, `PrismaChatMessageRepository` (injeção do `prisma` client via construtor)
**Requirement**: REACT-02, REACT-07, REACT-09

**Done when**:
- [ ] `upsert` usa `prisma.chatMessageReaction.upsert` na chave composta (idempotente)
- [ ] `upsert` ignora evento com `reactedAt` anterior ao registro existente (reação fora de ordem)
- [ ] `findByMessageIds` faz **uma** query com `in` (sem N+1)
- [ ] Nenhum model Prisma escapa: tudo passa pelo mapper
- [ ] Todas as queries filtram `tenantId`
- [ ] `PrismaChatMessageReactionMapper.test.ts`: Prisma → domínio com `reactorPhone`/`reactorName` nulos, `reactedAt` como `Date`, `fromMe` preservado

**Tests**: unit (mapper)
**Gate**: quick (api)

---

### T4: Ampliar o port `IMessagingEngine` [P]

**What**: Adicionar `ReactionTargetRef`, `SendReactionInput` e o método `sendReaction` ao contrato da engine.
**Where**: `api/src/modules/messaging/domain/contracts/IMessagingEngine.ts`
**Depends on**: None
**Reuses**: `QuotedMessageRef` como modelo de referência a mensagem externa
**Requirement**: REACT-03, REACT-05

**Done when**:
- [ ] Tipos conforme §5 do design, documentados em pt-BR como o restante do arquivo
- [ ] `emoji: string | null` (null = remover) documentado no JSDoc
- [ ] Nenhum tipo do Baileys referenciado

**Gate**: quick (api)

---

### T5: Evento interno `MESSAGE_REACTION_UPDATED` [P]

**What**: Adicionar o membro à união `InternalMessagingEvent`.
**Where**: `api/src/shared/events/InternalMessagingEvent.ts`
**Depends on**: None
**Reuses**: Formato dos eventos `MESSAGE_*` existentes
**Requirement**: REACT-06

**Done when**:
- [ ] Campos conforme §6 do design, com `sessionId` e `tenantId`
- [ ] Nenhum campo carrega payload cru da engine

**Gate**: quick (api)

---

### T6: `sendReaction` no adapter Baileys

**What**: Implementar o envio de reação (`{ react: { text, key } }`) com tradução de erro.
**Where**: `api/src/modules/messaging/infrastructure/engines/baileys/BaileysMessagingEngineAdapter.ts`
**Depends on**: T4
**Reuses**: `sendTextMessage` (resolução de socket/JID), `BaileysErrorTranslator`
**Requirement**: REACT-03, REACT-05

**Done when**:
- [ ] Monta a `key` alvo com `remoteJid`, `fromMe`, `id` e `participant` (grupo)
- [ ] `emoji: null` envia `text: ''` (remoção)
- [ ] Sessão ausente/desconectada → erro interno `SESSION_NOT_CONNECTED`; falha de envio → `MESSAGE_SEND_FAILED`
- [ ] Log estruturado com `sessionId`, `targetId`, `emoji`

**Gate**: quick (api)

---

### T7: Handler `messages.reaction` no adapter

**What**: Assinar `socket.ev.on('messages.reaction')`, normalizar e emitir `MESSAGE_REACTION_UPDATED`.
**Where**: `api/src/modules/messaging/infrastructure/engines/baileys/BaileysMessagingEngineAdapter.ts`
**Depends on**: T5
**Reuses**: Normalização `@lid → remoteJidAlt` e filtro `@broadcast` do handler `messages.upsert`
**Requirement**: REACT-06, REACT-11

**Done when**:
- [ ] **Alvo = `item.key.id`** e **autor = `item.reaction.key`** (a lib inverte o que a intuição sugere — ver design §6, `process-message.js:411-421`). Trocar os dois grava a reação na mensagem errada
- [ ] Autor: `reaction.key.participant` em grupo, senão `reaction.key.remoteJid`; `fromMe` = `reaction.key.fromMe`
- [ ] `reaction.text` vazio/ausente → `emoji: null`
- [ ] `senderTimestampMs` (Long) convertido para ISO; ausente → agora
- [ ] `@broadcast`/`status@broadcast` ignorados; `@lid` sem `remoteJidAlt` → `reactorPhone: null` (reação preservada)
- [ ] `extractBaileysMessage` continua retornando `null` para `reactionMessage` (sem duplicidade)
- [ ] Erro dentro do handler não derruba o socket (try/catch + `logger.warn`)
- [ ] Normalização extraída como **função pura exportada** (`normalizeReactionEvent`) para ser testável sem socket
- [ ] Teste co-locado cobrindo: alvo vindo de `item.key` e autor de `item.reaction.key` (o erro que este plano quase cometeu), `text` vazio → `emoji: null`, grupo com `participant`, `@lid` sem alternativa → `reactorPhone: null`, `senderTimestampMs` ausente

**Tests**: unit (normalização pura)
**Gate**: quick (api)

---

### T8: Extrair resolução de destino da conversa

**What**: Extrair de `SendMessageUseCase` o trecho que resolve `recipientPhone`/`contactPhone`/grupo e a montagem da referência de mensagem externa, para um helper reusável.
**Where**: `api/src/modules/chat/application/use-cases/` (helper novo) + `SendMessageUseCase.ts`
**Depends on**: None
**Reuses**: Código existente — **refactor puro, sem mudança de comportamento**
**Requirement**: REACT-03 (habilitador)

> Mexe no caminho de envio em produção sem rede de testes. Vai como commit `refactor(chat):`
> isolado e com smoke próprio (envio individual, grupo, com citação) **antes** de T9 encostar nele.
> Se o smoke não puder ser feito na hora, T9 duplica a resolução e T8 fica para depois.

**Done when**:
- [ ] `SendMessageUseCase` usa o helper e mantém comportamento idêntico (envio com e sem citação, individual e grupo)
- [ ] Helper devolve `{ recipientPhone, contactPhone, isGroup }` e monta a ref de mensagem externa
- [ ] Nenhuma assinatura pública alterada

**Gate**: quick (api) + smoke de envio simples

---

### T9: `SetMessageReactionUseCase`

**What**: Use case de reagir/remover pelo painel — valida, envia pela engine, persiste, devolve agregado.
**Where**: `api/src/modules/chat/application/use-cases/SetMessageReactionUseCase.ts`
**Depends on**: T3, T4, T8
**Reuses**: `SendMessageUseCase` (estrutura), helper da T8, `NotFoundError`
**Requirement**: REACT-01, REACT-02, REACT-03, REACT-05

**Done when**:
- [ ] Ordem do §7 respeitada: carrega → valida → resolve → engine → persiste → publica → retorna
- [ ] Emoji validado por tamanho: não vazio, ≤ 64 bytes, sem ASCII imprimível/whitespace → `ValidationError` (**400**, é o statusCode de `ValidationError` em `ResourceErrors.ts:20`; não inventar 422)
- [ ] `reactorKey = 'self'` (constante, não derivada do `sessionId`), `fromMe: true`
- [ ] `emoji: null` chama `remove` e envia remoção à engine
- [ ] Falha da engine propaga sem gravar nada
- [ ] Publica `chat.message.reaction.updated` e devolve `ReactionSummary[]`
- [ ] Depende apenas de interfaces (nenhum Prisma, nenhum Fastify)
- [ ] Teste co-locado com repos e engine dublês: emoji válido persiste e envia; **engine falha → nada é gravado**; `emoji: null` chama `remove`; emoji inválido lança `ValidationError` antes de tocar a engine; grupo monta o alvo com `participant`

**Tests**: unit (use case)
**Gate**: quick (api)

---

### T10: `IngestMessageReactionUseCase`

**What**: Use case de ingestão de reação vinda do WhatsApp.
**Where**: `api/src/modules/chat/application/use-cases/IngestMessageReactionUseCase.ts`
**Depends on**: T3
**Reuses**: `IngestIncomingMessageUseCase` (padrão de dedupe/resolução), `IChatMessageRepository.findByExternalId`
**Requirement**: REACT-06, REACT-07, REACT-11

**Done when**:
- [ ] Mensagem alvo não encontrada → retorna `null` (log `debug`, sem criar nada)
- [ ] `emoji: null` → `remove`; caso contrário `upsert`
- [ ] Reação nossa (celular ou eco do próprio envio pelo painel) gera o mesmo `reactorKey = 'self'` do painel — idempotente
- [ ] **Não toca na conversa**: `lastMessageAt`, `lastMessagePreview`, `unreadCount` e `status` intactos; nenhum `chat.conversation.updated`/`chat.unread.updated` emitido (design §7.1)
- [ ] Nome do autor resolvido: `ChatContact` por telefone → `reactorName` (pushName) → `null`
- [ ] Retorna `{ conversationId, messageId, reactions }` para o listener publicar
- [ ] Teste co-locado: mensagem inexistente → `null` sem efeito colateral; reação repetida (eco) é no-op; `emoji: null` remove; **conversa nunca é escrita** (repo de conversa dublê sem nenhuma chamada de escrita); reação fora de ordem por `reactedAt` é ignorada

**Tests**: unit (use case)
**Gate**: quick (api)

---

### T11: Reações agregadas no `ListMessagesUseCase`

**What**: Anexar `reactions: ReactionSummary[]` ao `ChatMessageDto`, em uma única busca por lote.
**Where**: `api/src/modules/chat/application/use-cases/ListMessagesUseCase.ts`
**Depends on**: T3
**Reuses**: Padrão do enriquecimento de `quotedMessage`/avatar já existente no use case
**Requirement**: REACT-09, REACT-10

**Done when**:
- [ ] Uma chamada a `findByMessageIds` por listagem (verificar com log de query em dev)
- [ ] `reactedByMe` derivado de `fromMe`
- [ ] `reactors[].name` resolvido reusando o `Map` de `contactRepo.findByPhones` que o use case já monta para avatares (`ListMessagesUseCase.ts:84-86`) — zero query nova
- [ ] `reactors` limitado a 10 autores
- [ ] Mensagem sem reação retorna `[]` (nunca `undefined`)
- [ ] Teste co-locado da agregação: agrupamento por emoji com contagem, `reactedByMe`, resolução de nome (contato → pushName → null), corte em 10 autores

**Tests**: unit (agregação pura — extrair `aggregateReactions` para função testável)
**Gate**: quick (api)

---

### T12: Evento WS `chat.message.reaction.updated` nas duas pontas

**What**: Adicionar o evento à união `ChatWsEvent` (api) e à `ChatWsPayload` (app) — na mesma task, para não divergirem.
**Where**: `api/src/modules/chat/infrastructure/ws/ChatWebSocketPublisher.ts`, `app/src/hooks/useChatWebSocket.ts`
**Depends on**: None (shape definido no design §7)
**Reuses**: Membros existentes da união (`chat.message.status.updated` como modelo)
**Requirement**: REACT-08

**Done when**:
- [ ] Campos idênticos nos dois arquivos (`tenantId`, `conversationId`, `messageId`, `reactions`)
- [ ] `pnpm typecheck` limpo em api/ e app/

**Gate**: full

---

### T13: `ChatMessageReactionListener` + registro no startup

**What**: Listener que consome `MESSAGE_REACTION_UPDATED`, chama a ingestão e publica no WS; registrado no bootstrap junto aos demais.
**Where**: `api/src/modules/chat/infrastructure/listeners/ChatMessageReactionListener.ts` + ponto de registro dos listeners
**Depends on**: T7, T10, T12
**Reuses**: `ChatMessageStatusListener` (estrutura literal)
**Requirement**: REACT-06, REACT-08

**Done when**:
- [ ] `registerChatMessageReactionListener(...)` no mesmo formato dos existentes
- [ ] Resultado `null` da ingestão não publica evento
- [ ] Agregado idêntico ao anterior não publica evento — evita o WS duplicado do eco das nossas próprias reações (design §6)
- [ ] Erro capturado com `logger.warn` — nunca derruba o processo
- [ ] Registrado no startup ao lado dos outros listeners de chat

**Gate**: quick (api)

---

### T14: Rota `PUT /chat/messages/:messageId/reaction`

**What**: Schema de validação, handler fino, presenter e wiring do use case.
**Where**: `api/src/modules/chat/presentation/routes/chat.routes.ts`, `.../schemas/chat.schema.ts`, `.../presenters/ChatPresenter.ts`
**Depends on**: T9, T12
**Reuses**: `sendMessageBodySchema`, `conversationIdParamSchema`, `preHandler: [authHook, tenantHook]`, `httpResponse`
**Requirement**: REACT-01, REACT-05, REACT-09

**Done when**:
- [ ] `messageIdParamSchema` e `reactionBodySchema` (`emoji: string|null`, maxLength 32)
- [ ] Handler: valida → use case → presenter → `httpResponse`; zero regra de negócio
- [ ] Sem acesso a Prisma no handler
- [ ] Resposta `{ messageId, conversationId, reactions }`
- [ ] Erros mapeados pelos erros internos existentes: `NotFoundError` 404, `SessionNotConnectedError` 409, `ValidationError` **400** — sem statusCode novo inventado na rota

**Gate**: quick (api)

---

### T15: Strings da feature [P]

**What**: Criar `strings.ts` do chat com todas as labels de reações (tooltips, aria-labels, erros).
**Where**: `app/src/features/chat/strings.ts`
**Depends on**: None
**Reuses**: —
**Requirement**: REACT-13

**Done when**:
- [ ] Objeto `chatStrings.reactions` com chaves para: reagir, remover, tooltip de autores, erro de envio, "Participante"
- [ ] Sem nome de marca do produto
- [ ] Formato pronto para virar chave i18n (nomes semânticos, sem interpolação implícita)

**Tests**: none (constantes)
**Gate**: quick (app)

---

### T16: Tipos e serviço HTTP no painel

**What**: `MessageReaction` em `types.ts`, `ReactionSummaryApiDto` em `chat.api.types.ts`, `chatService.setMessageReaction`.
**Where**: `app/src/features/chat/types.ts`, `app/src/types/chat.api.types.ts`, `app/src/services/chat.service.ts`
**Depends on**: T14
**Reuses**: Padrão dos métodos existentes de `chat.service.ts` e do mapeamento DTO→domínio já feito no `ChatPage`
**Requirement**: REACT-09, REACT-10

**Done when**:
- [ ] `ChatMessage.reactions?: MessageReaction[]` no tipo do painel
- [ ] `setMessageReaction(messageId, emoji: string | null)` tipado, usando `apiClient`
- [ ] Mapeamento DTO→domínio no mesmo lugar em que as demais mensagens são mapeadas

**Gate**: quick (app)

---

### T17: Componente `EmojiPicker` reutilizável [P]

**What**: Instalar `emoji-picker-react` e encapsulá-lo em um componente lazy, com tema plugado no MUI.
**Where**: `app/src/components/EmojiPicker.tsx`, `app/package.json`
**Depends on**: None
**Reuses**: `useTheme()` do MUI para `palette.mode`
**Requirement**: REACT-01, REACT-12

**Done when**:
- [ ] Carregado via `React.lazy` + `Suspense` (não entra no bundle inicial)
- [ ] Tema segue `theme.palette.mode` (claro/escuro/sistema)
- [ ] API do componente: `onSelect(emoji: string)` e `onClose()` — sem vazar tipos da lib
- [ ] `app/package.json` atualizado com versão fixada

**Gate**: quick (app)

---

### T18: `ReactionBar` (barra rápida + botão `+`)

**What**: Popover com 👍 ❤️ 😂 😮 😢 🙏 e botão que abre o `EmojiPicker`.
**Where**: `app/src/features/chat/components/messages/ReactionBar.tsx`
**Depends on**: T15, T17
**Reuses**: `Popover`/`Tooltip` do MUI já usados em `MessageBubble`
**Requirement**: REACT-01, REACT-12, REACT-13

**Done when**:
- [ ] Emoji já ativo do usuário aparece marcado; clicar nele remove (toggle)
- [ ] Navegação por setas, `Esc` fecha e devolve o foco ao botão de origem
- [ ] Cores só por tokens do tema; legível nos três modos
- [ ] Strings de T15
- [ ] Teste: clicar num emoji da barra chama `onSelect` com ele; clicar no emoji já ativo emite remoção (`null`); `Esc` fecha

**Tests**: unit (componente)
**Gate**: quick (app)

---

### T19: `MessageReactions` (chips agrupados)

**What**: Chips por emoji com contagem, tooltip de autores e toggle ao clicar.
**Where**: `app/src/features/chat/components/messages/MessageReactions.tsx`
**Depends on**: T15, T16
**Reuses**: Linguagem visual de `messages/QuotedMessage.tsx`, `alpha()` sobre a cor da bolha
**Requirement**: REACT-10, REACT-11, REACT-12

**Done when**:
- [ ] Agrupa por emoji; contagem oculta quando 1
- [ ] `reactedByMe` destacado com borda/contraste (não só cor — daltônicos)
- [ ] `<button>` com `aria-label` e `aria-pressed`; tooltip abre por foco de teclado
- [ ] Autor sem telefone conhecido exibe "Participante"
- [ ] Overflow com muitos emojis distintos não quebra o layout da bolha
- [ ] Teste com Testing Library via `renderWithTheme`: contagem oculta quando 1 e visível quando > 1; `aria-pressed` reflete `reactedByMe`; clique dispara o toggle com o emoji certo; renderiza no tema escuro

**Tests**: unit (componente)
**Gate**: quick (app)

---

### T20: Integrar reações na `MessageBubble`

**What**: Botão de reagir no cluster de hover/foco, item no menu de contexto, e render dos chips no rodapé da bolha.
**Where**: `app/src/features/chat/components/MessageBubble.tsx`
**Depends on**: T18, T19
**Reuses**: `hovered`, o `Menu` e o `replyBtn` já existentes no componente
**Requirement**: REACT-01, REACT-10, REACT-12

**Done when**:
- [ ] Props novas: `onSetReaction?(message, emoji: string | null)`
- [ ] Ações de hover também aparecem no foco por teclado (corrige o botão Responder de passagem)
- [ ] Mensagem `isDeleted` não exibe o botão de reagir
- [ ] Chips não cobrem o horário/status da mensagem
- [ ] Bolhas de entrada e de saída ambas corretas

**Gate**: quick (app)

---

### T21: Estado otimista e evento WS na `ChatPage`

**What**: `handleSetReaction` com rollback e handler do `chat.message.reaction.updated`.
**Where**: `app/src/pages/ChatPage.tsx`
**Depends on**: T12, T16, T20
**Reuses**: Padrão dos handlers WS existentes (`chat.message.status.updated`) e do `setMessages` imutável
**Requirement**: REACT-01, REACT-04, REACT-05, REACT-08

**Done when**:
- [ ] Aplicação otimista + substituição pelo agregado da resposta HTTP
- [ ] `catch` restaura o snapshot e mostra erro não bloqueante com a string de T15
- [ ] Evento WS substitui o agregado (sem merge incremental) e ignora conversa não carregada
- [ ] Sem re-render da lista inteira a cada reação (atualiza só a mensagem alvo)
- [ ] A redução de estado (aplicar agregado otimista / aplicar agregado do servidor) sai como **função pura** fora do componente, com teste co-locado — é o que torna esse trecho testável sem montar a página

**Tests**: unit (redutor puro)
**Gate**: full

---

### T22: Documentação e versão

**What**: `CHANGELOG.md`, doc da feature em `docs/`, bump de versão em `api/` e `app/`.
**Where**: `CHANGELOG.md`, `docs/chat-reacoes-mensagens.md`, `api/package.json`, `app/package.json`
**Depends on**: T21
**Reuses**: Formato do §32 do AGENTS.md
**Requirement**: Todos (rastreabilidade)

**Done when**:
- [ ] Entrada `Added` no CHANGELOG listando arquivos afetados e o porquê
- [ ] `docs/chat-reacoes-mensagens.md`: fluxo ponta a ponta, contrato HTTP/WS, o que **não** fazer (não chamar Baileys fora do adapter, não fazer merge incremental do agregado, backfill fora de escopo)
- [ ] Versão minor em ambos os `package.json` (0.10.x → **0.11.0**, feature backward-compatible)
- [ ] Débito registrado: i18n pendente, reações de histórico fora de escopo

**Gate**: quick (nenhum código)

---

### T23: Smoke test manual

**What**: Roteiro de validação ponta a ponta com sessão real conectada.
**Where**: — (execução)
**Depends on**: T22
**Reuses**: `agent-browser` / `playwright-cli` (`.agents/skills/`) para dirigir o painel e capturar evidência dos três temas
**Requirement**: Success Criteria da spec

**Done when**:
- [ ] Reagir pelo painel → aparece no celular (individual e grupo)
- [ ] Reagir pelo celular → aparece no painel < 2 s com a conversa aberta
- [ ] Trocar emoji substitui (não acumula) a reação do mesmo autor
- [ ] Remover pelo painel e pelo celular limpa o chip nos dois lados
- [ ] Reload da página mantém as reações; paginação para trás também
- [ ] Derrubar e reconectar a sessão não duplica reações
- [ ] Sessão desconectada → erro tratado, sem reação fantasma
- [ ] Reagir a mensagem antiga **não** move a conversa no topo da lista nem gera não lida
- [ ] Reagir pelo painel gera **um** evento WS, não dois (eco tratado)
- [ ] Emoji com ZWJ (👨‍👩‍👧‍👦) e skin tone aceitos
- [ ] Conferido nos temas claro, escuro e sistema, e navegando por teclado

**Gate**: smoke

---

## Check 1 — Granularidade

Toda task entrega **um** artefato: um model, um contrato, um repositório, um use case, um handler,
uma rota, um componente. As duas exceções são deliberadas: **T12** (as duas metades da mesma união
tipada — separá-las garante divergência) e **T1** (schema + migration são inseparáveis no Prisma).

## Check 2 — Diagrama × `Depends on`

| Task | Depends on (definição) | Diagrama | ✅ |
| --- | --- | --- | --- |
| T1 | None | Fase 1, raiz | ✅ |
| T2 | None | Fase 1, raiz | ✅ |
| T3 | T1, T2 | T1,T2 → T3 | ✅ |
| T4 | None | Fase 1, paralela | ✅ |
| T5 | None | Fase 1, paralela | ✅ |
| T6 | T4 | T4 → T6 | ✅ |
| T7 | T5 | T5 → T7 | ✅ |
| T8 | None | Fase 3, raiz | ✅ |
| T9 | T3, T4, T8 | T3,T4,T8 → T9 | ✅ |
| T10 | T3 | T3 → T10 | ✅ |
| T11 | T3 | T3 → T11 | ✅ |
| T12 | None | Fase 3, raiz | ✅ |
| T13 | T7, T10, T12 | T7,T10,T12 → T13 | ✅ |
| T14 | T9, T12 | T9,T12 → T14 | ✅ |
| T15 | None | Fase 4, raiz | ✅ |
| T16 | T14 | T14 → T16 | ✅ |
| T17 | None | Fase 4, raiz | ✅ |
| T18 | T15, T17 | T15,T17 → T18 | ✅ |
| T19 | T15, T16 | T15,T16 → T19 | ✅ |
| T20 | T18, T19 | T18,T19 → T20 | ✅ |
| T21 | T12, T16, T20 | T12,T16,T20 → T21 | ✅ |
| T22 | T21 | T21 → T22 | ✅ |
| T23 | T22 | T22 → T23 | ✅ |

## Check 3 — Co-locação de testes

| Task | Camada | Tipo exigido pela matriz | Teste na task? | ✅ |
| --- | --- | --- | --- | --- |
| T1 | schema/migration | none | — | ✅ |
| T2 | domain (tipos) | none | — | ✅ |
| T3 | mapper + repo Prisma | unit (mapper); repo → smoke | mapper | ✅ |
| T4 | port (tipos) | none | — | ✅ |
| T5 | evento (tipos) | none | — | ✅ |
| T6 | adapter (I/O de socket) | none | — | ✅ |
| T7 | adapter (normalização pura) | unit | sim | ✅ |
| T8 | refactor de use case | unit (cobertura pelo existente) | smoke de envio | ✅ |
| T9 | use case | unit | sim | ✅ |
| T10 | use case | unit | sim | ✅ |
| T11 | use case (agregação) | unit | sim | ✅ |
| T12 | tipos WS | none | — | ✅ |
| T13 | listener (fiação) | none | — | ✅ |
| T14 | rota Fastify | none (sem harness HTTP) | smoke | ✅ |
| T15 | constantes | none | — | ✅ |
| T16 | tipos + serviço HTTP | none | — | ✅ |
| T17 | wrapper de lib | none | — | ✅ |
| T18 | componente | unit | sim | ✅ |
| T19 | componente | unit | sim | ✅ |
| T20 | componente de integração visual | smoke | — | ✅ |
| T21 | página + redutor puro | unit (redutor) | sim | ✅ |
| T22 | docs | none | — | ✅ |
| T23 | validação | smoke | — | ✅ |

Todos os tipos exigidos são parallel-safe (sem banco, sem porta, sem arquivo compartilhado) — os
marcadores `[P]` seguem válidos.

## Paralelismo

- Fase 1: T1+T2 (→T3), T4 e T5 simultâneos — 3 frentes
- Fase 2: T6 e T7 simultâneos
- Fase 3: T8, T10, T11, T12 simultâneos; T9 depois de T8; T13 e T14 fecham
- Fase 4: T15 e T17 simultâneos; o resto é cadeia

## Rastreabilidade

| Requisito | Tasks |
| --- | --- |
| REACT-01 | T9, T14, T17, T18, T20, T21 |
| REACT-02 | T1, T2, T3, T9 |
| REACT-03 | T4, T6, T8, T9 |
| REACT-04 | T21 |
| REACT-05 | T4, T6, T9, T14 |
| REACT-06 | T5, T7, T10, T13 |
| REACT-07 | T1, T3, T10 |
| REACT-08 | T12, T13, T21 |
| REACT-09 | T3, T11, T14, T16 |
| REACT-10 | T11, T16, T19, T20 |
| REACT-11 | T7, T10, T11, T19 |
| REACT-12 | T17, T18, T19, T20 |
| REACT-13 | T15, T18 |
| REACT-14 | T10, T13 |

**Cobertura**: 14/14 requisitos mapeados. Nenhum órfão.
