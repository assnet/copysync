# Chat — Reações em mensagens

Reagir, trocar e remover reação pelo painel e receber as do WhatsApp em tempo real.
Spec e design: `.specs/features/message-reactions/`.

## Modelo

- Tabela `chat_message_reactions`: uma linha por (mensagem, autor) — `@@unique([messageId, reactorKey])`.
- `emoji = NULL` é **tombstone** (remoção). A linha fica para guardar o carimbo.
- Escrita única `apply`: last-write-wins em `reactedAt`, serializada por
  `pg_advisory_xact_lock` e decidida por `decideReactionWrite` → `{ applied, changed }`.
  - `applied`: gravou (carimbo ≥ o atual). `changed`: o emoji visível mudou — só então publica.
- `reactorKey`: `self` (nossa conta), `lid:<id>` ou `pn:<dígitos>` — identidade crua do protocolo.
- Relógio: gesto do painel e do celular do operador usam o relógio do servidor; eco do painel
  mantém o carimbo enviado; terceiros usam o `senderTimestampMs`.
- `reactionsRevision` = maior `updatedAt` das linhas (tombstones incluídos). O painel só aceita
  agregado com revisão ≥ à atual.

## Fluxo — envio pelo painel

1. Clique em `ReactionBar`/`MessageReactions` → `ChatPage` marca `pending` (otimista).
2. `reactionDispatcher` (fora do React, singleton por aba) agrupa: envia só o último gesto,
   após 400 ms parado e ≥ 1000 ms desde o envio anterior da mensagem. Gesto igual à base não envia.
3. `PUT /api/chat/messages/:messageId/reaction` → `SetMessageReactionUseCase`:
   carrega (tenant) → valida emoji → pré-condições → resolve alvo → **throttle** → engine → `apply` → publica se `changed`.
4. `InMemoryReactionSendThrottle` (instância única): 700 ms por mensagem, 30/min por sessão; falha da engine devolve a vaga.
5. `BaileysMessagingEngineAdapter.sendReaction`: id pré-gerado registrado no `ReactionEchoRegistry` antes do envio.
6. Resposta HTTP e WS `chat.message.reaction.updated` trazem o agregado; o painel substitui `server`.

## Fluxo — recebimento

1. Baileys `messages.reaction` → `normalizeReactionEvent` (alvo = `item.key`, autor = `item.reaction.key`;
   `isEcho` se o id estiver no registro).
2. `MESSAGE_REACTION_UPDATED` no bus interno.
3. `ChatMessageReactionListener` → `IngestMessageReactionUseCase` → `apply`.
4. Resultado `null` (mensagem desconhecida, evento velho, eco sem mudança) não publica;
   senão publica `chat.message.reaction.updated`. A conversa nunca é tocada.

## HTTP

`PUT /api/chat/messages/:messageId/reaction` (auth + tenant)

```json
{ "emoji": "👍" }   // null remove; campo obrigatório, sem outros campos
```

| Status | Quando |
|---|---|
| 200 | `{ success, data: { messageId, conversationId, reactionsRevision, reactions } }` |
| 400 | corpo inválido ou emoji inválido (`VALIDATION_ERROR`) |
| 404 | mensagem/conversa inexistente no tenant |
| 409 | sessão desconectada (`SESSION_NOT_CONNECTED`), sem `externalMessageId`, apagada, grupo sem participante |
| 429 | limite de envio (`TOO_MANY_REQUESTS`) — nada enviado nem gravado |
| 503 | banco indisponível/transação expirada |

`reactions[]`: `{ emoji, count, reactedByMe, reactors: [{ name, phone, isMe }] }` (até 10 autores).
`GET` de mensagens traz `reactions` e `reactionsRevision` em cada item.

## WebSocket

```ts
{ event: 'chat.message.reaction.updated',
  data: { tenantId, conversationId, messageId, reactionsRevision, reactions } }
```

Agregado completo, nunca delta. `chat.message.created` também leva `externalMessageId`.

## Configuração (`api/src/shared/config/env.ts`)

| Var | Padrão | Uso |
|---|---|---|
| `REACTION_ECHO_TTL_MS` | 120000 | janela de reconhecimento do eco |
| `REACTION_MAX_PER_MINUTE` | 30 | teto por sessão (janela deslizante) |
| `REACTION_MIN_INTERVAL_MS` | 700 | intervalo mínimo por mensagem (menor que os 1000 ms do painel) |

`REACTION_ECHO_MAX_PER_SESSION` é derivado (não configurar).

## O que NÃO fazer

- Chamar Baileys fora de `messaging/infrastructure/engines/baileys/`.
- Fazer merge incremental do agregado — sempre substituir, respeitando `reactionsRevision`.
- Apagar reação com `DELETE` — remoção é tombstone.
- Derivar `reactorKey` do telefone resolvido (LID muda de resolução; duplicaria o autor).
- Gravar reação sem envio à engine (o contato nunca veria).
- Publicar no WS sem `changed` (duplica evento com o eco).
- Usar `\p{C}` na validação de emoji — rejeita ZWJ; controle é `\p{Cc}`.
- Enviar reação do painel direto, sem o `reactionDispatcher`.
- Criar throttle por requisição — zera o limite.
- Rodar `prisma migrate dev` com `api/.env`: aponta para **produção**. Use banco local.
- Backfill de reações do history sync: fora de escopo.
