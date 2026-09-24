# Sincronização de Estado de Conversa entre Dispositivos — Tasks

**Design**: `.specs/features/chat-remote-state-sync/design.md`
**Status**: Draft
**Branch**: `feature/chat-remote-state-sync` (a partir de `develop`, AGENTS.md §31)
**Versão alvo**: minor (funcionalidade nova, contrato HTTP inalterado). O número sai na criação da
`release/*`, não aqui: `feature/chat-message-reactions` ainda não entrou em `develop` e disputa a
mesma minor. Quem fizer o merge por último bumpa a partir do que estiver em `develop`.

---

## Gates

| Gate | Comando |
| --- | --- |
| `quick` | `pnpm typecheck && pnpm test` no app tocado pela task (`api/` ou `app/`) |
| `full` | `quick` nos dois apps |
| `smoke` | Roteiro da T17, com sessão WhatsApp real conectada |

**Gate de fase para a Fase 1**: T1, T2, T7 e T10 alteram contratos e, isoladas, deixam consumidores
quebrados por construção. O `quick` da `api/` é cobrado **ao fim da Fase 2** (depois de T4, T6, T8);
o do `app/`, ao fim da T12. Nenhuma dessas quatro declara gate próprio — gate que se espera ver
falhar não é gate.

Testes são **co-locados**, nunca task separada. Pela matriz de `.specs/codebase/TESTING.md`:
use cases e funções puras de normalização do adapter exigem **unit**; repositórios Prisma, rotas e
`ChatPage` ficam no smoke; componentes do painel com lógica visível exigem **unit** com Testing
Library e ao menos uma asserção no tema escuro.

## Restrição que vale para TODAS as tasks (SEC-01, SEC-03)

Nenhuma task pode introduzir chamada de saída **nova** ao WhatsApp, nem ligar gatilho novo às que já
existem. O adapter hoje chama `sendMessage`, `readMessages`, `presenceSubscribe`,
`profilePictureUrl`, `onWhatsApp` e `chatModify` (este via `updateChatState`, usado pelo painel para
arquivar/fixar/silenciar/marcar lida). Essas permanecem como estão.

Proibição específica: **nenhum handler de evento recebido pode chamar `updateChatState`** — fecharia
o laço painel ↔ WhatsApp. Se uma implementação parecer precisar disso, **pare e reporte**.

## Bloqueio conhecido — i18n

O AGENTS.md exige cobertura de i18n, mas o painel **não tem sistema de i18n** hoje (nenhuma
biblioteca instalada; strings pt-BR direto no JSX). As tasks de UI mantêm os textos novos
centralizados no topo do componente, prontos para extração, e **não** montam um i18n ad-hoc.
Registrar em `.specs/project/STATE.md` como blocker de projeto.

## Skills do repositório (`.agents/skills/`) por task

| Skill | Onde entra |
| --- | --- |
| `ui-ux-pro-max`, `frontend-design` | T13 — estado de não lida (ponto x número) sem virar template genérico |
| `web-design-guidelines` | T13 — contraste do indicador de não lida e alvo de toque |
| `agent-browser` / `playwright-cli` | T17 — conferir os três temas e capturar evidência |
| `the-fool` | Antes da T1 — stress test das premissas, opcional |

---

## Execution Plan

### Fase 1 — Contratos (paralela, sem gate próprio)

```
T1 [P] ──→ T7
T2 [P]
T10 [P]
```

### Fase 2 — Backend

```
T1 → T3 → T4
T2 → T5 ─┐
T7 ──────┴→ T6 → T8
T9 (independente)
```

### Fase 3 — Painel

```
T10 → T11 ─┐
T10 → T14 ─┼→ T12 → T13
                 └─→ T15
```

T14 é extração de código existente e vem **antes** de T12, que a consome.

### Fase 4 — Entrega

```
T4,T6,T7,T8,T9,T13,T14,T15 ─┐
T7,T12 → T18 ───────────────┴→ T16 → T17
```

---

## Tasks

### T1 [P] — Evento interno `CHAT_STATE_UPDATED`

**O quê**: substituir `CHAT_ARCHIVE_UPDATED` pelo evento de estado com `state` parcial.
**Onde**: `api/src/shared/events/InternalMessagingEvent.ts`
**Depende de**: —
**Reusa**: a variante atual `CHAT_ARCHIVE_UPDATED` (linhas 86-93) como base do shape
**Feito quando**: a união exporta `CHAT_STATE_UPDATED` com `state: { read?, manuallyUnread?, archived?, pinned?, mutedUntil? }`, a variante antiga não existe mais e o campo ausente está documentado como "sem informação", não `false`
**Testes**: nenhum (só tipos — `tsc` cobre)
**Gate**: nenhum próprio — gate de fase (ver Gates)
**Requisitos**: SYNC-01, SYNC-04, SYNC-07, SYNC-08

---

### T2 [P] — Contrato `applyRemoteState` no repositório

**O quê**: trocar `setArchivedByChat` por `applyRemoteState` e declarar `RemoteConversationState`.
**Onde**: `api/src/modules/chat/domain/contracts/IChatConversationRepository.ts`
**Depende de**: —
**Reusa**: assinatura de `setArchivedByChat`
**Feito quando**: o contrato declara `applyRemoteState(input): Promise<{ conversationId, changed } | null>` e nenhum tipo do Baileys aparece no `domain`
**Testes**: nenhum (só tipos)
**Gate**: nenhum próprio — gate de fase
**Requisitos**: SYNC-01, SYNC-03

---

### T3 — `normalizeChatState` (função pura) + testes

**O quê**: traduzir o payload cru do Baileys para o `state` do evento interno.
**Onde**: `api/src/modules/messaging/infrastructure/engines/baileys/normalizeChatState.ts` (+ `.test.ts`)
**Depende de**: T1
**Reusa**: tabela de semântica da §5 do design
**Feito quando**: `unreadCount === 0 → { read: true }`; `< 0 → { manuallyUnread: true }`; `> 0 → {}`; `archived` mapeado; `pinned` (timestamp) → booleano; `muteEndTime` no passado → `null`; estado vazio retorna `{}`
**Testes**: **unit** — um caso por linha da tabela, mais delta positivo descartado e `muteEndTime` no passado
**Gate**: `quick` na `api/`
**Requisitos**: SYNC-01, SYNC-02, SYNC-04, SYNC-08

---

### T4 — `emitChatState` no adapter

**O quê**: substituir `emitArchiveState` nos três call sites e emitir só quando houver estado.
**Onde**: `api/src/modules/messaging/infrastructure/engines/baileys/BaileysMessagingEngineAdapter.ts` (~linha 640-700)
**Depende de**: T3
**Reusa**: filtros `@broadcast`/`@lid`/`isStale()` e a resolução `chatId`/`isGroup` já existentes
**Feito quando**: `messaging-history.set`, `chats.upsert` e `chats.update` chamam `emitChatState`; `state` vazio não emite; o diff do adapter não introduz nenhum `socket.<método>` novo (conferir com `git diff -- <arquivo> | grep 'socket\.'`)
**Testes**: nenhum direto (o adapter não sobe sem socket) — a lógica testável está na T3
**Gate**: `quick` na `api/`
**Requisitos**: SYNC-01, SYNC-02, SYNC-08, SEC-01

---

### T5 — `applyRemoteState` no repositório Prisma

**O quê**: resolver a conversa, calcular o diff e gravar só o que mudou.
**Onde**: `api/src/modules/chat/infrastructure/repositories/PrismaChatConversationRepository.ts`
**Depende de**: T2
**Reusa**: resolução grupo/`contactId` de `setArchivedByChat` (linhas 88-115)
**Feito quando**: retorna `null` sem conversa; retorna `changed: {}` sem gravar quando nada muda; a gravação é um `updateMany` **compare-and-set** (o `where` carrega `id`, `tenantId` e os valores lidos dos campos do diff) e `count === 0` retorna `changed: {}` por corrida perdida; `read: true` limpa `unreadCount` **e** `manuallyUnread`; todas as queries filtram por `tenantId`
**Testes**: nenhum automatizado (sem banco de teste — decisão da matriz); coberto pelo smoke da T17
**Gate**: `quick` na `api/`
**Requisitos**: SYNC-01, SYNC-03, SYNC-04, SYNC-07, SYNC-08

---

### T6 — `ChatConversationStateListener`

**O quê**: consumir o evento, aplicar o estado e publicar só quando houver mudança.
**Onde**: `api/src/modules/chat/infrastructure/listeners/ChatConversationStateListener.ts` (substitui `ChatArchiveListener.ts`) + `.test.ts` para `toWsShape`
**Depende de**: T1, T2, T5, **T7** (usa o payload de `chat.state.updated`; sem ela o `quick` quebra por typecheck)
**Reusa**: estrutura e tratamento de erro do `ChatArchiveListener`
**Feito quando**: diff vazio não publica; `read: true` vira `{ unreadCount: 0, manuallyUnread: false }` no payload WS; **`favorite` e `lists` nunca são preenchidos** — não existem no protocolo do WhatsApp e este emissor só fala do que chegou de lá; erro por chat vira `warn` sem interromper o lote; **o handler não chama `updateChatState` nem qualquer método da engine** (SEC-03)
**Testes**: **unit** de `toWsShape` (função pura de tradução)
**Gate**: `quick` na `api/`
**Requisitos**: SYNC-01, SYNC-03, SYNC-04

---

### T7 — Evento WS `chat.state.updated`

**O quê**: adicionar o evento na união do publisher e remover `chat.archive.updated`.
**Onde**: `api/src/modules/chat/infrastructure/ws/ChatWebSocketPublisher.ts`
**Depende de**: T1
**Reusa**: o canal e a união de eventos existentes
**Feito quando**: o novo evento existe com todos os campos opcionais — `unreadCount`, `manuallyUnread`, `archived`, `pinned`, `mutedUntil` (espelhados do WhatsApp) mais `favorite` e `lists` (marcações do painel, preenchidas só pela rota da T18); `chat.archive.updated` não existe mais (nenhum consumidor — verificado no painel); `chat.unread.updated` permanece intacto
**Testes**: nenhum (só tipos)
**Gate**: nenhum próprio — gate de fase
**Requisitos**: SYNC-01, SYNC-07, SYNC-08

---

### T8 — Registro do listener no bootstrap

**O quê**: trocar `registerChatArchiveListener` pelo novo listener.
**Onde**: `api/src/app/server.ts:20` (import) e `:83` (chamada)
**Depende de**: T6
**Reusa**: a linha de registro existente
**Feito quando**: a API sobe com o listener registrado e o log de startup nomeia o novo listener
**Testes**: nenhum
**Gate**: `quick` na `api/`
**Requisitos**: SYNC-01

---

### T9 — Marcar como lida limpa `manuallyUnread` (servidor + anúncio)

**O quê**: `resetUnread` passa a limpar a marcação manual, e a rota de leitura anuncia isso.
**Onde**: `api/src/modules/chat/infrastructure/repositories/PrismaChatConversationRepository.ts` (`resetUnread`), `api/src/modules/chat/application/use-cases/MarkConversationAsReadUseCase.ts` (+ `.test.ts`), `api/src/modules/chat/presentation/routes/chat.routes.ts:245-249`, `api/src/modules/chat/infrastructure/ws/ChatWebSocketPublisher.ts`
**Depende de**: —
**Reusa**: o use case e o evento `chat.unread.updated`, que ganha `manuallyUnread?: boolean` — campo **opcional**, aditivo, sem quebrar consumidor
**Feito quando**: abrir a conversa zera contador **e** marcação manual no banco; a rota publica `{ unreadCount: 0, manuallyUnread: false }` no mesmo evento de hoje (nenhum evento extra, nenhum frame a mais); o envio de receipt ao WhatsApp continua sendo **um só**, o da última inbound (nenhuma chamada nova)
**Testes**: **unit** do use case com repositório e engine dublês — inclui asserção de que a engine é chamada no máximo uma vez
**Gate**: `quick` na `api/`
**Requisitos**: SYNC-05, SYNC-11, SEC-01

---

### T10 [P] — Tipos WS no painel

**O quê**: adicionar `chat.state.updated` à união `ChatWsPayload`.
**Onde**: `app/src/hooks/useChatWebSocket.ts` (bloco de tipos, linhas 1-75)
**Depende de**: —
**Reusa**: o padrão das demais interfaces `Ws*Data`
**Feito quando**: campos opcionais espelham o payload da API; `mutedUntil` é `string | null`
**Testes**: nenhum (só tipos)
**Gate**: nenhum próprio — gate de fase
**Requisitos**: SYNC-01, SYNC-07, SYNC-08

---

### T11 — `onResync` no hook de WebSocket

**O quê**: detectar reconexão real **e** retomada de aba, avisando o consumidor com janela mínima e debounce.
**Onde**: `app/src/hooks/useChatWebSocket.ts` (+ `shouldResync.ts` e `.test.ts`)
**Depende de**: T10
**Reusa**: o backoff exponencial existente (não alterar)
**Feito quando**: dispara no `onopen` (só se houve conexão anterior) quando o socket ficou fora por mais de **5 s**, e no `visibilitychange` de volta a visível quando a aba ficou oculta por mais de **60 s**; em ambos os casos respeitando debounce de 30 s; o listener de visibilidade é removido no cleanup; nenhum timer periódico é criado; o StrictMode continua sem disparar
**Testes**: **unit** de `shouldResync({ reason, awayMs, lastResyncAt, now })` — função pura, testável sem WebSocket: abaixo da janela em cada `reason`, dentro do debounce, primeiro disparo, alt-tab de 10 s não dispara, aba oculta 2 min dispara
**Gate**: `quick` no `app/`
**Requisitos**: SYNC-06, SEC-02

---

### T12 — `ChatPage` consome `chat.state.updated` e resync

**O quê**: merge parcial do estado na lista e `loadConversations` como `onReconnect`.
**Onde**: `app/src/pages/ChatPage.tsx` (handler WS ~linha 300-325; chamada do hook ~linha 226)
**Depende de**: T10, T11, **T14** (usa o comparador extraído — T14 está descrita adiante neste documento, mas executa antes)
**Reusa**: o handler de `chat.unread.updated` como molde; `loadConversations` como `onResync`; a lógica de arquivamento de `ChatPage.tsx:619-624` e o comparador da T14
**Feito quando**:
- campos ausentes não sobrescrevem estado local; conversa desconhecida é ignorada
- `archived` alterado: quando o novo valor difere de `showArchived`, remove da lista, ajusta `archivedCount` e limpa `selectedId` se for a selecionada — **mesma regra de `ChatPage.tsx:619-624`**, sem inventar variante; quando coincide, só atualiza o campo
- `pinned` alterado: reordena com `byPinnedThenRecent` (T14)
- `favorite` e `lists` alterados (só chegam da rota da T18): merge simples, sem efeito de lista
- o `splice`/`unshift` de `ChatPage.tsx:250-256` não é tocado
- o resync não cria endpoint novo
- **nenhum handler de evento recebido chama `chatService.updateConversationState`** — o painel não devolve ao WhatsApp o que veio dele (SEC-03)
**Testes**: nenhum (`ChatPage` fica no smoke pela matriz); a lógica testável está na T14
**Gate**: `quick` no `app/`
**Requisitos**: SYNC-01, SYNC-06, SYNC-07

---

### T13 — Não lida real (`manuallyUnread`) na lista

**O quê**: `hasUnread = unreadCount > 0 || manuallyUnread`, no item, no filtro e no contador; remover o hack `Math.max(1, c.unreadCount)`.
**Decisão de produto**: conversa marcada manualmente **conta como 1** em `totalUnread`
(`ConversationSidebar.tsx:99`) — como no WhatsApp Web. Total dizendo "0" com conversa destacada na
lista seria contradição visível.
**Onde**: `app/src/features/chat/components/ConversationListItem.tsx:26` (`hasUnread`), `ConversationSidebar.tsx:27` (contagem do filtro), `:90` (filtro), `:99` (`totalUnread`), `ChatPage.tsx:608` (merge otimista de marcação manual) e `ChatPage.tsx:399-401` (abertura da conversa)
**Depende de**: T12
**Reusa**: o badge existente — sem componente novo
**Feito quando**: conversa com `unreadCount: 0` e `manuallyUnread: true` aparece como não lida, entra no filtro "não lidas", soma 1 em `totalUnread` e exibe ponto (sem número) em vez de "1" falso; o merge otimista de `ChatPage.tsx:608` passa a gravar `manuallyUnread: change.unread` no lugar de `Math.max(1, c.unreadCount)`, preservando o feedback imediato ao marcar não lida pelo painel; **`ChatPage.tsx:399-401` (abrir conversa) zera `unreadCount` e `manuallyUnread` juntos** — sem isso a conversa recém-aberta continua destacada até o próximo fetch, porque `hasUnread` passou a olhar as duas flags
**Testes**: **unit** com Testing Library no `ConversationListItem` — não lida por contador, não lida por marcação manual, lida; ao menos uma asserção no tema escuro. **Unit** da agregação de `totalUnread` com mistura de contador e marcação manual
**Gate**: `quick` no `app/`
**Requisitos**: SYNC-04, SYNC-05, SYNC-11

---

### T14 — Extrair o comparador de ordenação da lista

**O quê**: transformar o `sort` inline de `ChatPage.tsx:628-632` em função pura reutilizável, sem
mudar o resultado. **Nada de UI nova**: os indicadores de fixado/silenciado já existem
(`ConversationListItem.tsx:113-116`, `isMuted` em `:28`), o servidor já ordena fixadas primeiro
(`PrismaChatConversationRepository.ts:60`) e o `splice`/`unshift` de `ChatPage.tsx:250-256`
**permanece intocado**.
**Onde**: `app/src/features/chat/utils/byPinnedThenRecent.ts` (+ `.test.ts`); uso em `ChatPage.tsx:628-632`
**Depende de**: T10
**Reusa**: a regra atual, copiada sem alteração — fixadas primeiro, depois `lastMessageAt` decrescente
**Feito quando**: `handleConversationStateChange` usa o comparador extraído e produz exatamente a mesma ordem de antes; nenhum outro comportamento da página muda; a função fica pronta para o handler remoto da T12
**Testes**: **unit** do comparador — fixada sobe; entre duas fixadas vence a mais recente; `lastMessageAt` nulo não quebra a ordenação
**Gate**: `quick` no `app/`
**Requisitos**: SYNC-08

---

### T15 — Conversa aberta sem badge + debounce de leitura

**O quê**: mensagem que chega na conversa selecionada não gera badge e a marcação de leitura é agrupada.
**Onde**: `app/src/pages/ChatPage.tsx` (handler `chat.message.created`, ~linha 232-247)
**Depende de**: T12
**Reusa**: `chatService.markAsRead` sem alteração
**Exceção autorizada à SEC-03**: esta é a única task que liga gatilho novo a uma chamada de saída existente — ver a seção "Exceção única e delimitada" na spec. Vale só para a conversa **selecionada**, sempre agrupada.
**Feito quando**: rajada de N mensagens na conversa aberta gera **uma** chamada `markAsRead` por janela de 1,5 s; conversa não selecionada mantém o comportamento atual — nenhuma chamada; o debounce é cancelado ao trocar de conversa e no unmount
**Testes**: **unit** da função pura de debounce/decisão, se extraída; caso contrário coberto pelo smoke
**Gate**: `quick` no `app/`
**Requisitos**: SYNC-09, SEC-01

---

### T18 — Propagar ação de estado do painel entre abas

**O quê**: `PATCH /conversations/:id/state` passa a publicar `chat.state.updated` com o resultado.
**Onde**: `api/src/modules/chat/presentation/routes/chat.routes.ts:209-230`
**Depende de**: T7 (o evento), T12 (o consumidor no painel)
**Reusa**: o `chatWsPublisher` e o evento da T7; o presenter/resultado do `UpdateConversationStateUseCase`, que já devolve os campos
**Feito quando**: publica `archived`, `pinned`, `mutedUntil`, `manuallyUnread`, `favorite` e `lists` — o `ConversationStateDto` inteiro **menos `syncedToWhatsApp`**, que descreve a tentativa de sincronização e não a conversa; arquivar/fixar/silenciar/favoritar/listar/marcar não lida numa aba reflete nas demais sem refresh; **publica também quando `syncedToWhatsApp` é `false`** (sessão fora do ar) — a mudança local aconteceu e as demais abas precisam vê-la; a aba que originou converge sem piscar (o merge é idempotente, aplica valor e não alterna); **nenhuma chamada de saída nova** — a rota já chama `updateChatState` e isso não muda
**Testes**: nenhum automatizado (rota fica no smoke pela matriz); coberto pelos itens 11 e 12 da T17
**Gate**: `quick` na `api/`
**Requisitos**: SYNC-10, SEC-01

---

### T16 — CHANGELOG e versão

**O quê**: entrada `[Unreleased]` descrevendo problema e solução por arquivo, e bump da minor a partir da versão que estiver em `develop` no momento do merge (ver cabeçalho — não fixar `0.11.0` aqui).
**Onde**: `CHANGELOG.md`, `api/package.json`, `app/package.json`
**Depende de**: T4, T6, T7, T8, T9, T13, T14, T15, T18
**Feito quando**: a entrada cobre `Added`, `Changed` e `Removed`, documenta a mudança de contrato de evento interno (`CHAT_ARCHIVE_UPDATED` → `CHAT_STATE_UPDATED`) e a remoção de `chat.archive.updated`, e registra que **nenhuma migration Prisma é necessária**
**Testes**: nenhum
**Gate**: `full`
**Requisitos**: AGENTS.md §32, §36.1, §36.4

---

### T17 — Smoke com sessão real

**O quê**: validar o caminho completo e provar que o tráfego de saída não aumentou.
**Onde**: painel em execução, sessão WhatsApp conectada
**Depende de**: T16
**Feito quando** — todos os itens verificados:
1. Ler a conversa no celular → badge some no painel em < 2 s, sem refresh
2. Marcar como não lida no celular → conversa destaca no painel
3. Arquivar no celular → sai da lista ativa
4. Fixar e silenciar no celular → indicadores existentes reagem; fixada sobe na página carregada
4.1. Arquivar no celular com a conversa **selecionada** → sai da lista, `archivedCount` incrementa e a seleção é limpa, igual ao arquivar pelo painel
4.2. **regra: ✅ verificada em 2026-09-24** — as duas linhas do corpo de `byPinnedThenRecent` são textualmente idênticas às que estavam embutidas no `ChatPage` antes da extração (comparadas a partir dos arquivos, não de cópia digitada). **comportamento: pendente** — a identidade textual não cobre os call sites: o handler local continua ordenando ao fixar, e o handler remoto passou a ordenar também. Só a tela mostra se a lista se comporta igual
5. Abrir a conversa no painel → limpa contador e marcação manual
6. Derrubar a API 20 s, ler no celular, subir → painel realinha sozinho, uma única requisição
7. Rajada de 5 mensagens na conversa aberta → **uma** chamada `markAsRead`
8. ✅ **parte estática verificada em 2026-09-24** por
   `python3 scripts/diagnostics/audit_outbound_calls.py`, que devolve
   `chatService.markAsRead (1)` — a exceção declarada da T15 — e mais nada: nenhum método de
   socket e nenhuma chamada de engine adicionados.

   O script existe porque a verificação em uma linha de shell falha **devolvendo vazio**, e
   vazio aqui é indistinguível de "nada foi adicionado". Quatro modos de falha silenciosa, cada
   um hoje erro explícito com código de saída 1 (todos verificados):

   | Falha | Quando acontece |
   | --- | --- |
   | intervalo vazio | a feature entrou em `develop` e o merge-base virou o próprio HEAD |
   | commit de merge | `git show -- <paths>` não o expande; excluídos com `--no-merges` |
   | filtro sem match | escopo mudou ou trailer esquecido |
   | nenhum commit tocou código | `CAMINHOS` desatualizado, ou filtro pegando só documentação |

   Seleção de commits: o escopo não identifica uma feature (`chat` é compartilhado com
   reações), e o trailer sozinho também não basta — commit da feature pode ter escopo
   diferente, como o `chore(diagnostics)` que criou este script. O script usa a **união** dos
   dois critérios e avisa quantos entraram só pelo escopo.

   Arquivos de teste ficam de fora do diff auditado: dublês citam a engine sem chamá-la, e
   contá-los transformaria um mock em "chamada de saída nova".

   Inventário aberto do adapter (`grep -oE 'socket\.[a-zA-Z]+\('`, sem lista fixa de métodos):
   `chatModify` (4), `end` (3), `sendMessage` (2), `profilePictureUrl` (2), `readMessages`,
   `presenceSubscribe`, `onWhatsApp`, `logout`. `end` fecha o socket localmente; `logout`
   **emite requisição ao servidor** para desparear o dispositivo — é tráfego de saída, só não
   de conversa, e dispara apenas por ação explícita de desconectar a sessão.

   Falta a medição de **volume**: ativar `LOG_LEVEL=debug` e conferir que o roteiro produz
   **menos** linhas de envio que o baseline (a T15 agrupa receipts). Não existe contador
   dedicado no adapter e esta feature não adiciona um
9. Sessão com muitos chats: estado repetido não gera frames WS (observar o console do painel)
10. Três modos de tema conferidos
11. Duas abas abertas: arquivar/fixar/silenciar/favoritar/mudar listas/marcar não lida numa reflete na outra sem refresh, e a aba de origem não pisca
11.1. Repetir o item 11 com a sessão WhatsApp desconectada (`syncedToWhatsApp: false`) → a outra aba recebe o estado mesmo assim
12. Abrir conversa marcada como não lida: destaque some na aba que abriu **e** na outra
13. Observar no log se o receipt enviado pelo painel retorna como `chats.update` para a própria sessão — responde a pergunta em aberto da spec; em qualquer caso a supressão por diff deve impedir gravação e frame
14. **Repareamento da sessão** (history sync completo): conversa que o painel não tinha nasce com o retrato do aparelho — não lidas, arquivamento, fixação e silenciamento — em vez de nascer lida e desarquivada
15. **Reconexão com contadores divergentes**: os totais do aparelho reduzem o que o painel superestimava, **sem** ressuscitar badge em conversa que acabou de ser lida (regra monotônica). Conferir também que o log `Remote chat state received` aparece com `source: 'history'`
16. **Chat entregue por LID**: nasce com estado, não em branco. Se o log `History chats skipped: LID without pnJid` aparecer com contagem alta, o `pnJid` não está vindo e a semeadura desses chats precisa de outra fonte
**Verificado sem sessão em 2026-09-24**: itens 4.2 e 8 (parte estática), mais `pnpm build`
limpo nos dois apps e nenhum arquivo de teste no `dist/` da API.
**Pendente**: tudo que exige aparelho e sessão conectada — itens 1-4.1, 5-7, 9-16.
**Testes**: manual
**Gate**: `smoke`
**Requisitos**: todos

---

## Cross-check diagrama × dependências

| Task | `Depende de` | Aparece no diagrama como | OK |
| --- | --- | --- | --- |
| T1 | — | Fase 1 `[P]` | ✅ |
| T2 | — | Fase 1 `[P]` | ✅ |
| T3 | T1 | `T1 → T3` | ✅ |
| T4 | T3 | `T3 → T4` | ✅ |
| T5 | T2 | `T2 → T5` | ✅ |
| T6 | T1, T2, T5, T7 | `T5 → T6`, `T7 → T6` | ✅ |
| T7 | T1 | `T1 → T7` (Fase 1) | ✅ |
| T8 | T6 | `T6 → T8` | ✅ |
| T9 | — | Fase 2, independente | ✅ |
| T10 | — | Fase 1 `[P]` | ✅ |
| T11 | T10 | `T10 → T11` | ✅ |
| T12 | T10, T11, T14 | `T11 → T12`, `T14 → T12` | ✅ |
| T13 | T12 | `T12 → T13` | ✅ |
| T14 | T10 | `T10 → T14` | ✅ |
| T15 | T12 | `T12 → T15` | ✅ |
| T18 | T7, T12 | Fase 4 (antes de T16) | ✅ |
| T16 | T4,T6,T7,T8,T9,T13,T14,T15,T18 | Fase 4 | ✅ |
| T17 | T16 | `T16 → T17` | ✅ |

## Cross-check de testes co-locados

| Task | Camada tocada | Tipo exigido pela matriz | Na task | OK |
| --- | --- | --- | --- | --- |
| T1, T2, T7, T10 | contratos/tipos | nenhum | nenhum | ✅ |
| T3 | normalização pura do adapter | unit | unit | ✅ |
| T4 | adapter (socket) | nenhum | nenhum | ✅ |
| T5 | repositório Prisma | nenhum (smoke) | smoke T17 | ✅ |
| T6 | listener + função pura | unit na pura | unit de `toWsShape` | ✅ |
| T8 | bootstrap | nenhum | nenhum | ✅ |
| T9 | use case | unit | unit | ✅ |
| T11 | função pura do painel | unit | unit de `shouldResync` | ✅ |
| T12 | `ChatPage` | nenhum (smoke) | smoke T17 | ✅ |
| T13 | componente com lógica visível | unit (Testing Library, tema escuro) | unit | ✅ |
| T14 | função pura de ordenação (extração) | unit | unit | ✅ |
| T15 | `ChatPage` / função pura | unit se extraída, senão smoke | ambos previstos | ✅ |
| T18 | rota Fastify | nenhum (smoke) | smoke T17 item 12 | ✅ |

Todos os tipos exigidos são parallel-safe pela matriz; os `[P]` marcados dependem só de código.

## Cobertura de requisitos

| Requisito | Tasks |
| --- | --- |
| SYNC-01 | T1, T3, T4, T5, T6, T7, T8, T10, T12 |
| SYNC-02 | T3, T4 |
| SYNC-03 | T2, T5, T6 |
| SYNC-04 | T1, T3, T5, T6, T13 |
| SYNC-05 | T9, T13 |
| SYNC-06 | T11, T12 |
| SYNC-07 | T1, T5, T7, T12 (remoção da lista + `archivedCount`) |
| SYNC-08 | T1, T3, T4, T5, T7, T12, T14 |
| SYNC-09 | T15 |
| SYNC-10 | T18, T12 |
| SYNC-11 | T9, T13 |
| SEC-01 | T4, T9, T15, T18, T17 (item 8) |
| SEC-02 | T11, T17 (item 6) |
| SEC-03 | T6, T12, T17 (item 8) — T15 é exceção autorizada e delimitada, documentada na spec |

14 requisitos, 14 mapeados, 0 órfãos.
