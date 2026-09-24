# Reações em Mensagens — Tasks

**Design**: `.specs/features/message-reactions/design.md`
**Status**: Draft — revisado em 2026-09-24 (robustez; ver cabeçalho de `tasks.md`)
**Branch**: `feature/chat-message-reactions` (a partir de `develop`, conforme AGENTS.md §31)

> **Revisão 2026-09-24** — nenhuma task implementada até aqui. A branch existente (local e
> `origin`) não tem commit próprio e está 22 atrás de `develop`: o conteúdo que carregava (Vitest,
> CI) já entrou por outra linhagem (`STATE.md`, "Resolvidos"). Antes da T1, recolocá-la sobre a
> `develop` atual (`git switch -C feature/chat-message-reactions develop`; o push dela exige
> `--force-with-lease`, e só depois de confirmar que `origin` também não tem commit próprio).
> Esta revisão incorporou ao plano: tombstone + last-write-wins serializado por autor (lock + decisão pura), relógio do servidor para gestos nossos, publicação só com `changed`, keycap aceito, `reactorKey` pela
> identidade crua do protocolo, índice em `externalMessageId`, proibição do fallback "grava sem
> enviar", carimbo do envio fixado pelo use case, exceção de `archived` (REACT-14) e
> estado do servidor separado dos cliques pendentes com `reactionsRevision`, eco reconhecido por id pré-gerado. Motivos em `design.md` §4-§8 e §10.

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
**Reuses**: Estilo do model `ChatMessage` (`@@map`, índices tenant-aware); `id` sem `@default` — gerado na aplicação (design §4)
**Requirement**: REACT-02, REACT-07

**Done when**:
- [ ] Model conforme §4 do design, com `@@unique([messageId, reactorKey])` e `@@index([tenantId, messageId])`
- [ ] `emoji String?` — `NULL` é tombstone de remoção, não "sem emoji"
- [ ] `updatedAt DateTime @updatedAt` — base da `reactionsRevision` (design §4)
- [ ] Back-relations em `ChatMessage.reactions` e `Tenant.chatMessageReactions`
- [ ] `@@index([tenantId, externalMessageId])` em `ChatMessage`, na mesma migration (alvo da reação é resolvido por esse par)
- [ ] SQL gerado conferido antes de aplicar: só `CREATE TABLE`, `CREATE INDEX` e FKs — nenhum `ALTER`/`DROP` em tabela existente
- [ ] `pnpm prisma:migrate --name add_chat_message_reactions` (snake_case, como `20260907060000_add_conversation_state_flags`) gera migration aditiva — nenhuma migration existente editada
- [ ] Schema alterado é o de `api/prisma/schema.prisma` (não existe outro diretório `prisma/` no repo — verificado)
- [ ] `pnpm prisma:generate` sem erros

**Gate**: full

---

### T2: Entidade de domínio + contrato do repositório [P]

**What**: Criar `ChatMessageReaction` (entidade pura), `IChatMessageReactionRepository` com `apply`, `findByMessageId`, `findByMessageIds`, e as funções puras `decideReactionWrite` e `aggregateReactions` em `chat/domain/services/`.
**Where**: `api/src/modules/chat/domain/entities/ChatMessageReaction.ts`, `api/src/modules/chat/domain/contracts/IChatMessageReactionRepository.ts`, `api/src/modules/chat/domain/services/aggregateReactions.ts`, `api/src/modules/chat/domain/services/decideReactionWrite.ts`
**Depends on**: None
**Reuses**: Forma de `ChatMessage.ts` e `IChatMessageRepository.ts`; `domain/services/diffRemoteState.ts` como modelo de função pura com teste
**Requirement**: REACT-02, REACT-10, REACT-11

**Done when**:
- [ ] Entidade sem qualquer import de Prisma/Fastify/Baileys; `emoji: string | null` (tombstone)
- [ ] Todo método do contrato recebe `tenantId`
- [ ] Uma única porta de escrita (`apply`, last-write-wins) — sem `upsert`/`remove` separados (design §4)
- [ ] Tipos `ApplyReactionInput`, `ApplyReactionResult` (`applied`, `changed`), `ReactionSummary` e `ReactionAggregate` (`{ revision, reactions }`) exportados; o contrato importa o tipo do serviço, nunca o contrário (AGENTS.md §8)
- [ ] `aggregateReactions` devolve `{ revision, reactions }`: `revision` = maior `updatedAt` incluindo tombstones (`null` sem linhas); na lista ignora tombstone, agrupa por emoji, contagem desc e depois primeira `reactedAt`, `reactedByMe` = `fromMe`, nome contato → `reactorName` → `null`, corte em 10 autores
- [ ] `decideReactionWrite`: implementa a tabela do design §4 linha a linha (carimbo menor ignora; carimbo igual conta como ≥; remoção sem estado grava tombstone sem `changed`)
- [ ] `aggregateReactions.test.ts` cobrindo cada regra acima, mais entrada vazia → `{ revision: null, reactions: [] }` e remoção mais recente avançando a `revision`
- [ ] `decideReactionWrite.test.ts`: um caso por linha da tabela do design §4, mais carimbo igual com emoji diferente → `applied` e `changed`

**Tests**: unit (função pura)
**Gate**: quick (api)

---

### T3: Mapper + repositório Prisma

**What**: Implementar `PrismaChatMessageReactionMapper` e `PrismaChatMessageReactionRepository`.
**Where**: `api/src/modules/chat/infrastructure/mappers/`, `api/src/modules/chat/infrastructure/repositories/`
**Depends on**: T1, T2
**Reuses**: `PrismaChatMessageMapper`, `PrismaChatMessageRepository` (injeção do `prisma` client via construtor)
**Requirement**: REACT-02, REACT-07, REACT-09

**Done when**:
- [ ] `apply` em `prisma.$transaction({ maxWait: 2000, timeout: 5000 })`: `pg_advisory_xact_lock(hashtextextended(${key}::text, 0::bigint))` via `$executeRaw` tagged template — casts obrigatórios (bind sem tipo quebra a resolução da função); nunca `$executeRawUnsafe`; nunca `$queryRaw` (retorno `void` não desserializa) → `findUnique` → `decideReactionWrite` → `upsert` só se `write` — esqueleto no design §4
- [ ] Linha existente de outro `tenantId` → erro, nunca sobrescreve (defesa multi-tenant)
- [ ] Devolve `{ applied, changed }` da decisão; repositório não decide regra
- [ ] Timeout/`P2028` e falha de conexão traduzidos para `EngineTemporarilyUnavailableError` (503); nenhum erro cru do Prisma sobe
- [ ] `id` = `crypto.randomUUID()` (nenhuma dependência nova)
- [ ] Smoke do repositório (sem banco de teste): mesmo `apply` duas vezes → segunda `changed: false`; remoção com carimbo anterior à reação → `applied: false` e reação continua; dois `apply` iguais disparados em paralelo (`Promise.all`) sem linha prévia → exatamente um `changed: true`
- [ ] Remoção grava `emoji = NULL` (tombstone), nunca `DELETE`
- [ ] `findByMessageId`/`findByMessageIds` filtram `tenantId` e devolvem tombstones também (a `revision` precisa deles; quem filtra é `aggregateReactions`)
- [ ] `findByMessageIds` faz **uma** query com `in` (sem N+1); lista vazia não consulta o banco
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
- [ ] `reactedAt: Date` no input — a engine envia como `senderTimestampMs` (design §5); é carimbo informativo para o destinatário, não a base da nossa ordenação
- [ ] Nenhum tipo do Baileys referenciado

**Gate**: nenhum próprio — o único implementador é o `BaileysMessagingEngineAdapter`, então o
contrato novo quebra o `tsc` até a T6. T4 e T6 vão no mesmo commit; o `quick` é cobrado ao fim da T6
(gate que se espera ver falhar não é gate — mesma regra de `chat-remote-state-sync/tasks.md`).

---

### T5: Evento interno `MESSAGE_REACTION_UPDATED` [P]

**What**: Adicionar o membro à união `InternalMessagingEvent`.
**Where**: `api/src/shared/events/InternalMessagingEvent.ts`
**Depends on**: None
**Reuses**: Formato dos eventos `MESSAGE_*` existentes
**Requirement**: REACT-06

**Done when**:
- [ ] Campos conforme §6 do design, com `sessionId`, `tenantId` e `isEcho`
- [ ] Nenhum campo carrega payload cru da engine

**Gate**: quick (api)

---

### T6: `sendReaction` no adapter Baileys

**What**: Implementar o envio de reação (`{ react: { text, key } }`) com tradução de erro.
**Where**: `api/src/modules/messaging/infrastructure/engines/baileys/BaileysMessagingEngineAdapter.ts`, `engines/baileys/ReactionEchoRegistry.ts` (+ teste), `api/src/shared/config/env.ts`
**Depends on**: T4
**Reuses**: `sendTextMessage` (resolução de socket/JID), `BaileysErrorTranslator`
**Requirement**: REACT-03, REACT-05

**Done when**:
- [ ] Monta a `key` alvo com `remoteJid`, `fromMe`, `id` e `participant` (grupo)
- [ ] `emoji: null` envia `text: ''` (remoção)
- [ ] `senderTimestampMs = input.reactedAt.getTime()` explícito — é o carimbo que o eco devolve e que a ingestão mantém (design §4, "Relógio")
- [ ] Id da reação pré-gerado (`generateMessageIDV2`) e passado em `sendMessage(jid, content, { messageId })`; registrado no `Set` de ecos da sessão **antes** do envio (TTL `REACTION_ECHO_TTL_MS`, teto calculado em `env.ts` a partir de `REACTION_MAX_PER_MINUTE` e do TTL — design §4; nenhum número fixo no adapter); **mantido mesmo se o envio falhar** — timeout pode ocorrer depois de o WhatsApp aceitar, e o eco tardio precisa da marca (design §4). Só o eco recebido ou o TTL retiram o id
- [ ] Cria no schema zod de `shared/config/env.ts`, com padrão: `REACTION_ECHO_TTL_MS` (120000), `REACTION_MAX_PER_MINUTE` (30), `REACTION_MIN_INTERVAL_MS` (700) e o teto derivado (design §4). Nascem aqui porque o teto já depende do limite; a T9 só consome
- [ ] Teto cheio: descarta primeiro id vencido; só sem vencido tira o mais antigo, com `logger.warn`
- [ ] Estrutura do `Set` de ecos extraída como classe pura (`ReactionEchoRegistry`, relógio injetável) com teste: com o teto cheio, id dentro do TTL nunca é descartado; id vencido sai primeiro; eco recebido retira o id; falha de envio não retira
- [ ] Pré-condições antes do socket: sessão ausente/não `open` → `SESSION_NOT_CONNECTED`; grupo com alvo de terceiro sem `participant` → `MESSAGE_SEND_FAILED` com motivo
- [ ] Falha de envio → `MESSAGE_SEND_FAILED` via `BaileysErrorTranslator`; erro cru nunca sobe
- [ ] Log estruturado com `sessionId`, `targetId`, `emoji`

**Tests**: unit (`ReactionEchoRegistry`)
**Gate**: quick (api) — cobre T4 + T6

---

### T7: Handler `messages.reaction` no adapter

**What**: Assinar `socket.ev.on('messages.reaction')`, normalizar e emitir `MESSAGE_REACTION_UPDATED`.
**Where**: `api/src/modules/messaging/infrastructure/engines/baileys/BaileysMessagingEngineAdapter.ts`
**Depends on**: T5
**Reuses**: `extractParticipantJid` + `resolveParticipantPhone` (resolução de LID já usada para remetente de grupo), filtro `@broadcast` do `messages.upsert`, formato de `normalizeChatState.ts`
**Requirement**: REACT-06, REACT-11

**Done when**:
- [ ] **Alvo = `item.key.id`** e **autor = `item.reaction.key`** (a lib inverte o que a intuição sugere — ver design §6, `process-message.js:411-421`). Trocar os dois grava a reação na mensagem errada
- [ ] Autor: `reaction.key.participant` em grupo, senão `reaction.key.remoteJid`; `fromMe` = `reaction.key.fromMe`
- [ ] `reactorKey`: `'self'` se `fromMe`; senão `lid:<id>` para autor `@lid`, `pn:<dígitos>` caso contrário — nunca o telefone resolvido
- [ ] `reactorPhone`: `participantAlt`/`remoteJidAlt`, depois `lidMapping`; sem resolução → `null` (reação preservada, **não** descartada como o `messages.upsert` faz em 1:1)
- [ ] `reaction.text` vazio/ausente → `emoji: null`
- [ ] `senderTimestampMs` (Long) convertido para ISO; ausente, zero ou não finito → agora. Só converte — a troca pelo relógio do servidor em `fromMe` é da T10, não do adapter
- [ ] `@broadcast`/`status@broadcast` ignorados
- [ ] `isEcho = fromMe && Set de ecos contém reaction.key.id` (e remove o id do `Set`); o `Set` fica fora da função pura, entra como parâmetro
- [ ] `extractBaileysMessage` continua retornando `null` para `reactionMessage` (sem duplicidade)
- [ ] Erro dentro do handler não derruba o socket (try/catch + `logger.warn`)
- [ ] Normalização extraída como **função pura exportada** (`normalizeReactionEvent`) para ser testável sem socket
- [ ] Teste co-locado cobrindo: alvo vindo de `item.key` e autor de `item.reaction.key` (o erro que este plano quase cometeu), `text` vazio → `emoji: null`, grupo com `participant`, `@lid` sem alternativa → `reactorPhone: null`, `senderTimestampMs` ausente, id no conjunto de ecos → `isEcho: true`, `fromMe` sem id no conjunto → `isEcho: false`

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
- [ ] Helper escrito como **função pura** e coberto por teste **antes** de o `SendMessageUseCase` passar a usá-lo — o teste caracteriza o comportamento atual (individual, grupo `<groupJid>@g.us`, citação com `remoteJid` de grupo vs contato) e é a rede que hoje não existe
- [ ] `SendMessageUseCase` usa o helper e mantém comportamento idêntico (envio com e sem citação, individual e grupo)
- [ ] Helper devolve `{ recipientPhone, contactPhone, isGroup }` e monta a ref de mensagem externa
- [ ] Fallback "grava sem enviar" (`SendMessageUseCase.ts:53-78`) **fica onde está** — é regra do envio de mensagem, não do helper; o helper não decide nada sobre engine/sessão
- [ ] Nenhuma assinatura pública alterada

**Tests**: unit (helper puro, caracterização)
**Gate**: quick (api) + smoke de envio simples

---

### T9: `SetMessageReactionUseCase`

**What**: Use case de reagir/remover pelo painel — valida, envia pela engine, persiste, devolve agregado.
**Where**: `api/src/modules/chat/application/use-cases/SetMessageReactionUseCase.ts`, `chat/application/contracts/IReactionSendThrottle.ts`, `chat/infrastructure/throttle/InMemoryReactionSendThrottle.ts`, `shared/errors/internal/ResourceErrors.ts`
**Depends on**: T3, T4, T8
**Reuses**: helper da T8, `aggregateReactions` (T2), `NotFoundError`, `ConflictError`, `SessionNotConnectedError`. **Não** reusar a estrutura do `SendMessageUseCase` inteira: o fallback "grava sem enviar" dele é proibido aqui (design §7, passo 3)
**Requirement**: REACT-01, REACT-02, REACT-03, REACT-05

**Done when**:
- [ ] Ordem do §7 respeitada: carrega → valida → pré-condições → resolve → engine → persiste → publica (se `changed`) → retorna
- [ ] Emoji validado por tamanho: não vazio, ≤ 64 bytes, não composto só de ASCII, sem whitespace/controle (keycap `1️⃣` válido); controle = `\p{Cc}`, nunca `\p{C}` (rejeitaria ZWJ) → `ValidationError` (**400**, é o statusCode de `ValidationError` em `ResourceErrors.ts:20`; não inventar 422)
- [ ] Sem engine ou sem `conv.sessionId` → `SessionNotConnectedError` (409); mensagem sem `externalMessageId` → `ConflictError` (409); `isDeleted` → `ConflictError`
- [ ] Alvo: `fromMe = direction === OUTBOUND`; grupo com alvo de terceiro exige `fromParticipant`
- [ ] Limite antes da engine (design §7, passo 5): `IReactionSendThrottle.tryAcquire(sessionId, messageId)`; recusado → `TooManyRequestsError` (429, novo em `ResourceErrors.ts`, código `TOO_MANY_REQUESTS`), nada enviado nem gravado
- [ ] Usa as chaves de `env.ts` criadas na T6 — `REACTION_MIN_INTERVAL_MS` (**700** — menor que os 1000 ms do painel, folga para jitter; design §8) e `REACTION_MAX_PER_MINUTE` (30); nenhum número mágico no use case
- [ ] Porta com `tryAcquire(sessionId, messageId) → reserva | null` (reserva síncrona, sem `await` entre checar e registrar) e `release(reserva)`
- [ ] Engine falha → `release` antes de propagar; `release` é idempotente
- [ ] `InMemoryReactionSendThrottle` com relógio injetável e limpeza das chaves expiradas (sem crescer sem limite); teste co-locado: intervalo por mensagem, teto por sessão, janela deslizante, sessões independentes, `release` devolve a vaga nos dois limites, duas aquisições seguidas sem `await` → a segunda recusada
- [ ] `reactedAt = now` (relógio do servidor) fixado uma vez e usado no envio **e** na gravação
- [ ] `reactorKey = 'self'` (constante, não derivada do `sessionId`), `fromMe: true`
- [ ] `emoji: null` grava tombstone via `apply` e envia remoção à engine
- [ ] Falha da engine propaga sem gravar nada
- [ ] Publica `chat.message.reaction.updated` **só se `changed`** (o eco pode ter chegado antes e publicado); devolve sempre o `ReactionAggregate` (`revision` + lista) lido após o `apply`, calculado por `aggregateReactions`
- [ ] Depende apenas de interfaces (nenhum Prisma, nenhum Fastify)
- [ ] Teste co-locado com repos e engine dublês: emoji válido grava e envia **com o mesmo `reactedAt`**; **engine falha → nada é gravado**; **limite estourado → 429 e engine não chamada**; **engine falha → vaga devolvida e nova tentativa imediata recebe o erro da engine, não 429**; **sem sessão/engine → erro e nada gravado nem enviado**; sem `externalMessageId` → `ConflictError`; `emoji: null` grava tombstone; emoji inválido (`abc`, `' '`) lança `ValidationError` antes de tocar a engine; grupo monta o alvo com `participant`; ZWJ, skin tone e keycap (`1️⃣`) aceitos; `apply` → `changed: false` não publica mas devolve o agregado

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
- [ ] Set e remoção pelo mesmo `apply` (remoção = tombstone); `changed: false` → retorna `null` (evento velho, eco ou sem mudança visível — nada a publicar)
- [ ] Carimbo: `isEcho` → `reactedAt` do evento (carimbo que o painel fixou); `fromMe` sem eco → `now` do servidor, ignorando o do celular; terceiros → `reactedAt` do evento (design §4, "Relógio")
- [ ] Reação nossa (celular ou eco do próprio envio pelo painel) gera o mesmo `reactorKey = 'self'` do painel — idempotente
- [ ] **Não toca na conversa**: `lastMessageAt`, `lastMessagePreview`, `unreadCount`, `status` e `archived` intactos por este caminho; nenhum `chat.conversation.updated`/`chat.unread.updated` emitido (design §7.1 — o desarquivamento, quando houver, vem do espelhamento de estado)
- [ ] Nome do autor resolvido: `ChatContact` por telefone → `reactorName` (pushName) → `null`
- [ ] Retorna `{ conversationId, messageId, reactionsRevision, reactions }` para o listener publicar
- [ ] Teste co-locado: mensagem inexistente → `null` sem efeito colateral; reação repetida (eco) é no-op; `emoji: null` grava tombstone; **conversa nunca é escrita** (repo de conversa dublê sem nenhuma chamada de escrita); `changed: false` devolve `null`; evento `fromMe` sem eco com `senderTimestampMs` antigo é gravado com o `now` do servidor (relógio injetável no teste); **eco com carimbo T0 depois de gesto T1 → `applied: false`** (o caso dos cliques rápidos)

**Tests**: unit (use case)
**Gate**: quick (api)

---

### T11: Reações agregadas no `ListMessagesUseCase`

**What**: Anexar `reactionsRevision` e `reactions: ReactionSummary[]` ao `ChatMessageDto`, em uma única busca por lote.
**Where**: `api/src/modules/chat/application/use-cases/ListMessagesUseCase.ts`
**Depends on**: T2, T3
**Reuses**: Padrão do enriquecimento de `quotedMessage`/avatar já existente no use case
**Requirement**: REACT-09, REACT-10

**Done when**:
- [ ] Uma chamada a `findByMessageIds` por listagem, nos três caminhos (`findMany`, `findAround`, busca) — verificar com log de query em dev
- [ ] Reações buscadas **antes** do `findByPhones`: os `reactorPhone` entram no mesmo lote dos `fromParticipant` (`ListMessagesUseCase.ts:80-86`). Hoje o lote só tem remetentes e o `Map` só guarda `avatarUrl` — passa a guardar o contato (nome + avatar), com o avatar da mensagem **idêntico** ao de antes
- [ ] Zero query de contato nova; agregação por `aggregateReactions` (T2)
- [ ] Mensagem sem reação retorna `reactions: []` e `reactionsRevision: null` (nunca `undefined`)
- [ ] Contrato de paginação intocado (`limit`/`before`/`around` como estão hoje)
- [ ] Teste co-locado do use case com dublês: 1 chamada a `findByMessageIds` e 1 a `findByPhones` por página; `avatarUrl` do remetente inalterado; reator resolvido pelo contato

**Tests**: unit (use case com dublês)
**Gate**: quick (api)

---

### T12: Evento WS `chat.message.reaction.updated` nas duas pontas

**What**: Adicionar o evento à união `ChatWsEvent` (api) e à `ChatWsPayload` (app) — na mesma task, para não divergirem.
**Where**: `api/src/modules/chat/infrastructure/ws/ChatWebSocketPublisher.ts`, `app/src/hooks/useChatWebSocket.ts`
**Depends on**: None (shape definido no design §7)
**Reuses**: Membros existentes da união (`chat.message.status.updated` como modelo)
**Requirement**: REACT-08

**Done when**:
- [ ] Campos idênticos nos dois arquivos (`tenantId`, `conversationId`, `messageId`, `reactionsRevision`, `reactions`)
- [ ] `pnpm typecheck` limpo em api/ e app/

**Gate**: full

---

### T13: `ChatMessageReactionListener` + registro no startup

**What**: Listener que consome `MESSAGE_REACTION_UPDATED`, chama a ingestão e publica no WS; registrado no bootstrap junto aos demais.
**Where**: `api/src/modules/chat/infrastructure/listeners/ChatMessageReactionListener.ts` + ponto de registro dos listeners
**Depends on**: T7, T10, T12
**Reuses**: `ChatConversationStateListener` (pula publicação quando nada mudou, linha 66) e `ChatMessageStatusListener` (registro)
**Requirement**: REACT-06, REACT-08, REACT-14

**Done when**:
- [ ] `registerChatMessageReactionListener(...)` no mesmo formato dos existentes
- [ ] Resultado `null` da ingestão não publica evento — cobre mensagem inexistente, evento velho e eco sem mudança visível (`changed: false`, design §4/§6); sem comparar agregado no listener
- [ ] Nunca publica `chat.conversation.updated`/`chat.unread.updated`
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
- [ ] `messageIdParamSchema` e `reactionBodySchema`: `emoji` **obrigatório** e `type: ['string','null']` (corpo `{}` é 400, não remoção implícita), `maxLength: 32` como barreira grosseira de tamanho — a regra real (≤ 64 bytes, não só ASCII, sem whitespace/controle) é do use case, única fonte
- [ ] `additionalProperties: false` no body
- [ ] Handler: valida → use case → presenter → `httpResponse`; zero regra de negócio
- [ ] Uma única instância de `InMemoryReactionSendThrottle` criada no wiring do módulo e injetada no use case (instância por requisição zeraria o limite)
- [ ] Sem acesso a Prisma no handler
- [ ] Resposta `{ messageId, conversationId, reactionsRevision, reactions }`
- [ ] Erros mapeados pelos erros internos existentes: `NotFoundError` 404, `SessionNotConnectedError`/`ConflictError` 409, `ValidationError` **400**, `TooManyRequestsError` 429, `EngineTemporarilyUnavailableError` 503 — todos vindos de erros internos, nenhum statusCode decidido na rota

**Gate**: quick (api)

---

### T15: Strings da feature [P]

**What**: Criar `strings.ts` do chat com todas as labels de reações (tooltips, aria-labels, erros).
**Where**: `app/src/features/chat/strings.ts`
**Depends on**: None
**Reuses**: —
**Requirement**: REACT-13

**Done when**:
- [ ] Objeto `chatStrings.reactions` com chaves para: reagir, remover, tooltip de autores, erro de envio, sessão desconectada, limite de envio ("aguarde um instante"), "Participante"
- [ ] Sem nome de marca do produto nem da engine
- [ ] Formato pronto para virar chave i18n (nomes semânticos, sem interpolação implícita): frase com variável é função tipada (`reactorsTooltip(names: string[])`, `chipLabel(emoji, count)`), nunca concatenação no componente
- [ ] Plural resolvido na função (`1 reação` / `n reações`), não no JSX

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
- [ ] `ChatMessage.reactions?: MessageReaction[]` e `reactionsRevision?: string | null` no tipo do painel
- [ ] `setMessageReaction(messageId, emoji: string | null)` tipado, usando `apiClient`
- [ ] Mapeamento DTO→domínio no mesmo lugar em que as demais mensagens são mapeadas; `reactions` ausente no DTO (API antiga durante deploy) vira `[]`, nunca quebra a bolha

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
- [ ] `emojiStyle={EmojiStyle.NATIVE}` — o padrão (`apple`) baixa imagens de CDN externo (`context.md` D1)
- [ ] Textos internos do picker (busca, categorias) passados pela prop de textos da lib a partir de `strings.ts`, não o inglês padrão
- [ ] Falha no chunk lazy (rede) cai num fallback silencioso — a barra rápida continua funcionando
- [ ] API do componente: `onSelect(emoji: string)` e `onClose()` — sem vazar tipos da lib
- [ ] `app/package.json` atualizado com versão fixada (`4.22.2`, sem `^`) e lockfile commitado

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
- [ ] Mensagem `isDeleted` ou sem `externalMessageId` não exibe o botão de reagir (a API recusaria com 409)
- [ ] Sem `onSetReaction` (outros usos da bolha), nada de reação é renderizado além dos chips — nenhum consumidor atual muda de comportamento
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
- [ ] Estado por mensagem separado em `server` (`{ revision, reactions }`) e `pending` (cliques sem resposta); a bolha mostra `server` com o último pendente por cima (design §8)
- [ ] Envio agrupado (design §8, regra 3): despachante em módulo TS sem React (`features/chat/reactionDispatcher.ts`, singleton por aba, `subscribe`/`unsubscribe`) + adaptador `useReactionDispatcher`; temporizador por mensagem — 400 ms parado **e** ≥ 1000 ms desde o último envio; envia só o último `draft`; gesto final igual à base efetiva (alvo do último `inflight`, senão `self` de `server`) não envia
- [ ] Sem flush: trocar de conversa ou sair da rota não adianta envio; o gesto em espera sai no horário normal. Desmontar o `ChatPage` só cancela a inscrição, **não** os temporizadores
- [ ] `reset()` chamado no logout e na troca de tenant (`AuthContext`/`TenantContext`): cancela temporizadores e esquece os drafts — nada sai com o contexto novo
- [ ] Resultado sem inscrito: erro vai para `console.warn` com `messageId` e código; nada de estado órfão (o despachante esquece a mensagem depois do resultado)
- [ ] Teste do despachante com timers falsos do Vitest: sair e voltar antes do envio → um envio só, no horário; `reset()` antes do horário → nenhum envio; três cliques → um envio; nenhum envio antes de 1000 ms desde o anterior
- [ ] Decisão do que enviar em função pura `selectReactionToSend(server, inflight, drafts)` com teste: três cliques → um envio com o último; vai e volta sem nada em voo → nenhum envio; **server 👍 + remoção em voo + novo 👍 → envia 👍**; draft igual ao alvo em voo → não envia
- [ ] Erro remove só aquele clique de `pending` e mostra erro não bloqueante com a string de T15 (409 de sessão tem texto próprio) — sem snapshot: o que fica visível é `server`
- [ ] Resposta HTTP, evento WS e página do `GET` passam pela mesma regra: aceitos só com `revision >= server.revision`; substituição, sem merge incremental; conversa não carregada é ignorada
- [ ] Teste do redutor cobre: clique → resposta; clique → erro → volta a `server`; **clique → WS com o gesto → erro (timeout) → reação continua visível**; dois cliques com respostas HTTP fora de ordem → estado final = último clique; agregado com `revision` menor descartado; página do `GET` mais velha que o WS não desfaz o WS
- [ ] Sem re-render da lista inteira a cada reação (atualiza só a mensagem alvo)
- [ ] A redução de estado (aplicar agregado otimista / aplicar agregado do servidor) sai como **função pura** fora do componente, com teste co-locado — é o que torna esse trecho testável sem montar a página

**Tests**: unit (redutor puro)
**Gate**: full

---

### T22: Documentação e versão

**What**: `CHANGELOG.md` da raiz, doc da feature em `docs/`, dívidas no `STATE.md`. Versão **não** é bumpada aqui.
**Where**: `CHANGELOG.md` (raiz), `docs/chat-reacoes-mensagens.md`, `.specs/project/STATE.md`
**Depends on**: T21
**Reuses**: Formato do §32 do AGENTS.md
**Requirement**: Todos (rastreabilidade)

> **Qual CHANGELOG**: o da raiz. É o que recebe todas as entradas desde maio (`git log -- CHANGELOG.md`)
> e carrega a nota de estado do versionamento; `api/CHANGELOG.md` parou em 2026-09-07. AGENTS.md
> §31.3 ainda cita `api/CHANGELOG.md` — divergência de processo registrada no `STATE.md`, não
> resolvida por esta feature.
>
> **Versão**: os `package.json` já estão em `0.11.0` (o plano original mandava ir de 0.10.x para
> 0.11.0, número já consumido). O número sai na `release/*`, a partir do que estiver em `develop` —
> mesma regra de `chat-remote-state-sync/tasks.md`, que disputa a mesma minor. Com as duas features
> entrando, a próxima minor é `0.12.0`, a decidir junto com o recorte pendente do versionamento
> (nota no topo do CHANGELOG).

**Done when**:
- [ ] Entrada `Added` em `[Unreleased]` do CHANGELOG da raiz, listando arquivos afetados e o porquê; migration nova citada (tabela + índice em `chat_messages`)
- [ ] `docs/chat-reacoes-mensagens.md`: fluxo ponta a ponta, contrato HTTP/WS, o que **não** fazer (não chamar Baileys fora do adapter, não fazer merge incremental do agregado, não apagar reação com `DELETE`, não derivar `reactorKey` do telefone resolvido, não gravar reação sem envio, backfill fora de escopo)
- [ ] `package.json` intocados nesta feature
- [ ] `STATE.md`: decisões (tombstone/LWW, `reactorKey` crua); dívidas (i18n pendente, reações de histórico fora de escopo, roteamento do `messages.upsert` antes do descarte de reação, CHANGELOG citado no AGENTS.md × usado)

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
- [ ] Reagir pelo painel gera **um** evento WS, não dois (eco tratado) — repetir 10× seguidas para pegar a corrida eco × `PUT`
- [ ] Com o relógio do celular do operador atrasado alguns minutos: reagir no painel e logo depois trocar no celular → painel termina com o emoji do celular
- [ ] Keycap (`1️⃣`) aceito pelo painel e entregue no celular
- [ ] Cliques rápidos no painel (👍, ❤️, 😂 em menos de 1 s) → painel e celular terminam em 😂 com **um** envio (conferir na aba Network: um `PUT`)
- [ ] Toggle vai e volta (👍 → remover → 👍 já existente) → nenhum `PUT`
- [ ] `PUT` direto via curl em rajada (10 em 1 s na mesma mensagem) → só as requisições espaçadas ≥ 700 ms da anterior aceita passam (tipicamente 2); as demais 429, e só as aceitas chegam ao celular
- [ ] Derrubar a sessão, reagir (erro de sessão), reconectar e reagir de novo em menos de 1 s → recebe o resultado real, nunca 429
- [ ] Rede lenta simulada (DevTools, throttling) com `PUT` expirando: reação que chegou ao celular continua visível no painel
- [ ] Emoji com ZWJ (👨‍👩‍👧‍👦) e skin tone aceitos
- [ ] Grupo com participante de número privado (`@lid`): reação dele aparece (nome ou "Participante"); reagir à mensagem dele pelo painel **chega no celular** (key com `participant` correto)
- [ ] O mesmo participante `@lid` reage duas vezes → um chip trocado, não dois
- [ ] Reagir e remover em sequência rápida (painel e celular alternados) → os dois lados terminam no último gesto
- [ ] Conversa arquivada, contato reage a mensagem nossa: desarquiva se o celular desarquiva (config "manter arquivadas"), e só nesse caso — timestamp e não lidas intactos
- [ ] Sem regressão no envio de mensagem (T8): texto, mídia e resposta com citação, individual e grupo
- [ ] Nenhuma requisição a CDN de emoji na aba Network ao abrir o picker
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
| T11 | T2, T3 | T2,T3 → T11 | ✅ |
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
| T2 | domain (tipos + `decideReactionWrite` + `aggregateReactions`) | unit (funções puras) | sim | ✅ |
| T3 | mapper + repo Prisma (SQL LWW) | unit (mapper); repo → smoke | mapper + smoke do `apply` | ✅ |
| T4 | port (tipos) — gate só com T6 | none | — | ✅ |
| T5 | evento (tipos) | none | — | ✅ |
| T6 | adapter (I/O de socket) + `ReactionEchoRegistry` puro | unit (registry) | sim | ✅ |
| T7 | adapter (normalização pura) | unit | sim | ✅ |
| T8 | refactor de use case | unit (caracterização do helper, antes de mover) | sim + smoke de envio | ✅ |
| T9 | use case | unit | sim | ✅ |
| T10 | use case | unit | sim | ✅ |
| T11 | use case (lote de reações + contatos) | unit (dublês) | sim | ✅ |
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
- Fase 2: T6 e T7 simultâneos (T4 e T6 no mesmo commit)
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
| REACT-10 | T2, T11, T16, T19, T20 |
| REACT-11 | T2, T7, T10, T11, T19 |
| REACT-12 | T17, T18, T19, T20 |
| REACT-13 | T15, T18 |
| REACT-14 | T10, T13, T23 |

**Cobertura**: 14/14 requisitos mapeados. Nenhum órfão.
