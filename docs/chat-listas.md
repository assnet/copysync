# Chat — Listas de conversa (catálogo)

## Modelo

- `chat_lists` (`ChatList`): `id`, `tenantId`, `name`, timestamps. Único por (`tenantId`, `name`);
  a API compara nomes **sem diferenciar maiúsculas** e grava o nome **aparado** (1..40).
- A associação conversa ↔ lista continua em `chat_conversations.tags` (`String[]`), exposta ao
  painel como `lists`. O catálogo existe para a lista sobreviver sem conversa e para
  renomear/excluir refletir em todas as conversas do tenant.
- Dado antigo (nome só em `tags`) aparece no `GET` com `id: null`; a primeira escrita pelo
  catálogo (`PATCH/DELETE /by-name`, ou `PATCH /conversations/:id/state { lists }`) cria a entrada.
- Migration: `20260925180000_add_chat_lists` (tabela + GIN em `tags`; aditiva, sem migração de dados).

## Rotas (`/api/chat/lists`, `[authHook, tenantHook]`, envelope `{ success, data }`)

| Rota | Resposta |
| --- | --- |
| `GET /lists` | 200 `[{ id, name, conversationCount }]` — catálogo ∪ nomes em `tags`, ordem alfabética |
| `POST /lists { name }` | 201; nome já existente → 200 com a existente (idempotente); inválido → 400 |
| `PATCH /lists/:id { name }` | 200; renomeia + cascata em `tags`; nome de outra lista → 409 `CONFLICT`; id inexistente → 404 |
| `PATCH /lists/by-name { name, newName }` | 200; para `id: null` — mesma cascata, cria a entrada com o nome novo |
| `DELETE /lists/:id` | 204; remove do catálogo + de `tags` de todas as conversas |
| `DELETE /lists/by-name/:name` | 204; idem por nome (URL-encoded), idempotente |

## Cascata

`chatConversationTagsSql` (`infrastructure/repositories/`) faz `array_replace`/`array_remove` com
`tags @> ARRAY[nome]` (usa o GIN). O replace deduplica preservando a ordem — conversa que já tinha o
nome novo não fica com dois. `PrismaChatListRepository.rename*/delete*` chamam isso com o `tx` da
transação da mudança no catálogo: ou muda tudo, ou nada.

## O que não fazer

- **Nunca editar `tags` fora do catálogo** (renomear/remover nome direto em `chat_conversations`):
  o catálogo e as conversas divergem e a lista "some" ou duplica no painel.
- Não gravar `lists` numa conversa sem passar por `UpdateConversationStateUseCase` (é ele que
  chama `ensure`).
- Não comparar nomes com igualdade estrita em código novo — use `sameChatListName`
  (`domain/services/normalizeChatListName.ts`) ou `mode: 'insensitive'` no Prisma.
- Não juntar catálogo e `tags` por `lower(name)` no `listWithCounts`: duas variantes de caixa em
  `tags` colidiriam numa mesma entrada e a contagem ficaria errada. A junção é pelo nome exato.
