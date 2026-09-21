# Sincronização de Estado de Conversa entre Dispositivos — Design

**Spec**: `.specs/features/chat-remote-state-sync/spec.md`
**Status**: Draft

---

## 1. Princípio arquitetural

**Consumo puro.** A feature só lê o que o socket já entrega. Nenhum caminho novo de saída para o
WhatsApp é criado, e nenhum gatilho novo é ligado aos que existem (SEC-01, SEC-03). O espelhamento
painel → WhatsApp já existe em `updateChatState` (`BaileysMessagingEngineAdapter.ts:342-371`) e fica
intocado: continua disparando só por ação explícita do operador, nunca como reação a evento
recebido — do contrário o laço painel ↔ WhatsApp se fecharia. O adapter continua sendo a única fronteira que conhece o Baileys
(AGENTS.md §9): ele traduz a semântica crua da lib (`-1`, timestamp de `pinned`, epoch de
`muteEndTime`) para um evento interno de domínio, e nada disso vaza para `application` ou `domain`.

Três guardas de volume, nesta ordem, garantem que o custo cresça com ação real do usuário e não com
o tempo:

1. **Filtro de semântica** no adapter — delta positivo de `unreadCount` é descartado na origem
2. **Diff no repositório** — só grava o que mudou de fato
3. **Publicação condicional** — WebSocket só quando o diff é não vazio (SYNC-03)

---

## 2. Visão geral

```
WhatsApp (celular / Web)
        │ app-state sync  (tráfego que já existe — nada novo é solicitado)
        ▼
socket.ev 'chats.update' | 'chats.upsert' | 'messaging-history.set'
        ▼
BaileysMessagingEngineAdapter.emitChatState()        ← traduz semântica da lib
        │ CHAT_STATE_UPDATED { chatId, isGroup, read?, manuallyUnread?, archived?, pinned?, mutedUntil? }
        ▼
internalEventBus  (shared/events)
        ▼
ChatConversationStateListener  (chat/infrastructure/listeners)
        │
        ├─ conversationRepo.applyRemoteState()  → retorna campos efetivamente alterados
        │                                          (nada mudou ⇒ {} ⇒ fim do fluxo)
        ▼
chatWsPublisher 'chat.state.updated' { conversationId, ...camposAlterados }
        ▼
useChatWebSocket → ChatPage → merge parcial no item da lista
```

Caminho paralelo, só por evento do navegador — nunca por timer:

```
WebSocket reconecta após > 5 s fora   ─┐
aba volta a ficar visível             ─┴→ shouldResync() (debounce 30 s)
        ▼
GET /api/chat/conversations   ← API do projeto, nunca o WhatsApp (SEC-02)
```

A retomada de aba entra porque suspensão de máquina pode devolver um socket que o navegador ainda
considera aberto enquanto os frames do período dormido já se perderam — nesse caso `onclose` nunca
dispara e só a reconexão não basta.

---

## 3. Reuso de código

| Já existe | Como é reaproveitado |
| --- | --- |
| `emitArchiveState` no adapter (3 call sites) | Generalizado para `emitChatState`; deixa de existir como função separada |
| `CHAT_ARCHIVE_UPDATED` + `ChatArchiveListener` | Substituídos por `CHAT_STATE_UPDATED` + `ChatConversationStateListener`; a lógica de resolução chat→conversa é movida, não reescrita |
| `setArchivedByChat` (repo) | Vira caso particular de `applyRemoteState`; a resolução `phone → contactId` e `groupJid` é a mesma |
| `chatWsPublisher` | Novo membro na união de eventos; nenhum canal novo |
| `loadConversations()` no `ChatPage` | Reutilizado como resync, sem endpoint novo |
| Filtros da `ConversationSidebar` | Passam a considerar `manuallyUnread`; sem componente novo |

Sem migration Prisma: `archived`, `pinned`, `mutedUntil`, `manuallyUnread` e `unreadCount` já
existem em `chat_conversations` (migration `20260907060000_add_conversation_state_flags`).

---

## 4. Contrato do evento interno

Substitui `CHAT_ARCHIVE_UPDATED` em `api/src/shared/events/InternalMessagingEvent.ts`. Alteração de
contrato interno ⇒ emissor e consumidor atualizados no mesmo commit e registro no CHANGELOG
(AGENTS.md §36.4).

```ts
| {
    type: 'CHAT_STATE_UPDATED';
    sessionId: string;
    tenantId: string;
    /** Telefone (conversa individual) ou groupJid sem @g.us (grupo). */
    chatId: string;
    isGroup: boolean;
    /** Estado alterado no outro aparelho. Campo ausente = sem informação, não "false". */
    state: {
      /** true = lida no outro aparelho (zera contador e marcação manual). */
      read?: true;
      /** true = marcada como não lida no outro aparelho. */
      manuallyUnread?: true;
      archived?: boolean;
      pinned?: boolean;
      mutedUntil?: Date | null;
    };
  }
```

**Regra de ausência**: campo ausente significa "o WhatsApp não falou disso", nunca "false". Isso
evita que um evento de fixação apague o estado de arquivamento.

---

## 5. Adapter Baileys

`emitChatState(chat)` substitui `emitArchiveState`, chamada nos mesmos três pontos
(`messaging-history.set`, `chats.upsert`, `chats.update`).

Tradução (única camada autorizada a conhecer esses números):

| Campo cru | Condição | Campo do evento |
| --- | --- | --- |
| `unreadCount === 0` | — | `read: true` |
| `unreadCount < 0` | — | `manuallyUnread: true` |
| `unreadCount > 0` | origem `chats.update` | **descartado** (delta) |
| `unreadCount` | origem `upsert`/history | **descartado** nesta versão |
| `archived` | `!= null` | `archived: boolean` |
| `pinned` | `!= null` | `pinned: pinned !== null` (chega como timestamp) |
| `muteEndTime` | `!= null` | `mutedUntil: ts > Date.now() ? new Date(ts) : null` |

Filtros preservados: `@broadcast`, `@lid`, `isStale()`. **Se o `state` resultante ficar vazio, não
emite** — corta a maior parte do ruído de `chats.upsert` antes mesmo do event bus.

A normalização é extraída como função pura `normalizeChatState(raw)` no mesmo diretório do adapter,
para ser testável sem socket (exigência da matriz em `.specs/codebase/TESTING.md`).

---

## 6. Repositório — `applyRemoteState`

Substitui `setArchivedByChat` em `PrismaChatConversationRepository`.

```ts
applyRemoteState(input: {
  tenantId: string;
  sessionId: string;
  isGroup: boolean;
  chatId: string;
  state: RemoteConversationState;
}): Promise<{ conversationId: string; changed: Partial<RemoteConversationState> } | null>
```

Algoritmo:

1. Resolve a conversa (grupo por `groupJid`; individual por `contactId` via `tenant_phone`) — mesma
   lógica de `setArchivedByChat`. Sem conversa ⇒ `null`, fim silencioso (SYNC-01.4)
2. Lê os campos de estado atuais no mesmo `findFirst` (`select` enxuto, sem trazer a linha inteira)
3. Calcula o diff em memória:
   - `read: true` ⇒ entra no diff se `unreadCount > 0` **ou** `manuallyUnread === true`
   - `manuallyUnread: true` ⇒ entra se `manuallyUnread === false`
   - `archived`/`pinned` ⇒ entram se diferentes do persistido
   - `mutedUntil` ⇒ entra se o instante (ou `null`) for diferente
4. Diff vazio ⇒ retorna `{ conversationId, changed: {} }` **sem gravar** (SYNC-03, supressão de eco)
5. Diff não vazio ⇒ um `updateMany` **compare-and-set**: o `where` leva `id`, `tenantId` **e os
   valores lidos no passo 2** para cada campo do diff; o `data` leva só os campos do diff
6. `count === 0` ⇒ outro caminho gravou entre a leitura e a escrita. Retorna `changed: {}`: quem
   venceu a corrida já publicou o estado final, e republicar aqui emitiria um valor obsoleto

**Corrida com mensagem nova (comportamento esperado, não defeito)**: se `incrementUnread` da
ingestão gravar entre a leitura e a escrita, o CAS descarta o evento de leitura e a conversa volta a
exibir badge. É o resultado correto — a mensagem chegou depois da leitura no outro aparelho, e ela
de fato está por ler. A publicação fica a cargo do `chat.unread.updated` da própria ingestão.

O passo 5 existe porque o listener é assíncrono e um lote de sync pode trazer dois eventos do mesmo
chat: sem CAS, o segundo `updateMany` sobrescreveria o primeiro com dado lido antes dele.

Duas queries no pior caso, uma no caso comum de eco. Multi-tenancy preservado em ambas
(AGENTS.md §36.8).

---

## 7. Listener

`ChatConversationStateListener` (renomeia e amplia `ChatArchiveListener`, mesmo diretório):

```ts
internalEventBus.on<ChatStateUpdatedEvent>('CHAT_STATE_UPDATED', async (payload) => {
  const result = await conversationRepo.applyRemoteState({ ...payload });
  if (!result || Object.keys(result.changed).length === 0) return;   // nada mudou → nenhum frame
  chatWsPublisher.publish(payload.tenantId, {
    event: 'chat.state.updated',
    data: { tenantId, conversationId: result.conversationId, ...toWsShape(result.changed) },
  });
});
```

`toWsShape` converte `read: true` em `{ unreadCount: 0, manuallyUnread: false }` — o painel recebe
valores, não intenções, e o merge do lado do cliente vira trivial.

Erro é `warn` por chat e o laço continua (SYNC-01.6): um chat problemático no lote de sync inicial
não pode derrubar os outros.

---

## 8. Contrato WebSocket

Evento novo, aditivo. `chat.unread.updated` continua existindo (emitido pela ingestão de mensagem e
pela rota `POST /conversations/:id/read`) — não é removido nesta feature para não tocar caminhos que
já funcionam.

**`chat.unread.updated` ganha um campo opcional**, em vez de um segundo evento na mesma rota:

```ts
| { event: 'chat.unread.updated'; data: {
      tenantId: string; conversationId: string; unreadCount: number;
      manuallyUnread?: boolean;      // ← novo, opcional
  } }
```

Motivo: a rota de leitura precisa anunciar `manuallyUnread: false` (SYNC-11), senão as demais abas
seguem destacando a conversa depois que T13 torna a flag visível. Publicar um `chat.state.updated`
extra ali dobraria os frames de uma ação corriqueira (abrir conversa); um campo opcional é aditivo,
não quebra consumidor algum e o handler existente no `ChatPage` só ganha mais um campo no merge.

O `chat.state.updated` segue sendo o veículo do espelhamento remoto **e** da propagação entre abas
(SYNC-10): `PATCH /conversations/:id/state` passa a publicá-lo ao concluir. Hoje essa rota não
publica nada, e o painel fica cego ao outro operador da mesma conta — a mesma classe de divergência
que a feature corrige em relação ao celular. Nenhuma chamada de saída nova: a rota já chama
`updateChatState`.

```ts
| { event: 'chat.state.updated'; data: {
      tenantId: string;
      conversationId: string;
      // espelhados do WhatsApp — o emissor remoto preenche só estes
      unreadCount?: number;
      manuallyUnread?: boolean;
      archived?: boolean;
      pinned?: boolean;
      mutedUntil?: string | null;   // ISO
      // marcações do painel — só a rota PATCH os preenche
      favorite?: boolean;
      lists?: string[];
  } }
```

**Um evento, campos opcionais, cada emissor preenche o que sabe.** `favorite` e `lists` não existem
no protocolo do WhatsApp e o `ChatConversationStateListener` **nunca** os envia — a fronteira
"só o que o WhatsApp entrega" é do emissor, não do transporte. Para o painel, o que importa é o
campo, não a procedência: um evento só evita dois handlers escrevendo o mesmo item da lista.
A alternativa (evento separado para marcações locais) duplicaria transporte e merge para ganhar uma
distinção que nenhum consumidor usa.

Consequência para a T18: `PATCH /conversations/:id/state` publica o `ConversationStateDto` inteiro
menos `syncedToWhatsApp` — que é resposta HTTP para quem pediu, não estado da conversa.

`chat.archive.updated` é **removido**: era publicado e nunca consumido, e seu payload usava `chatId`
em vez de `conversationId`. Remoção documentada no CHANGELOG como mudança de contrato interno.

**Dívida assumida**: `unreadCount` **e** `manuallyUnread` passam a chegar ao painel por dois eventos
(`chat.unread.updated` da ingestão/rota de leitura, `chat.state.updated` do espelhamento e da rota
de estado), com dois handlers no `ChatPage` escrevendo as mesmas flags. É inofensivo porque ambos
aplicam valores absolutos e idempotentes, nunca alternância. Unificar exigiria mexer em caminhos que
funcionam hoje; registrado em `STATE.md` para uma iteração futura.

---

## 9. Painel

**`useChatWebSocket`** ganha um segundo parâmetro opcional:

```ts
useChatWebSocket(onEvent, { onResync })
```

- marca `disconnectedAt` no `onclose` e `hiddenAt` no `visibilitychange` para oculto
- no `onopen` (se havia conexão anterior) e na volta da aba a visível, consulta a função pura
  `shouldResync({ reason, awayMs, lastResyncAt, now })`
- janelas distintas por motivo: **5 s** para reconexão (houve perda real de frames) e **60 s** para
  retomada de aba (alt-tab de poucos segundos não perdeu nada; janela curta aqui viraria um GET a
  cada 30 s em operação normal — polling por outro nome)
- em ambos, debounce de 30 s desde a última chamada (SYNC-06.3)
- nenhum timer periódico é criado; o backoff exponencial existente (2 s → 30 s) fica intacto

**`ChatPage`** ganha um handler para `chat.state.updated` que faz merge parcial no item da lista —
campos ausentes não sobrescrevem nada — e passa `loadConversations` como `onReconnect`.

**Lista**: `hasUnread` passa a ser `unreadCount > 0 || manuallyUnread` em `ConversationListItem`, e o
mesmo critério vale no filtro e no contador da `ConversationSidebar`. Com isso o hack
`Math.max(1, c.unreadCount)` (`ChatPage.tsx:608`) sai: marcação manual deixa de ser simulada com
contador falso e passa a ser a flag real.

**Indicadores e ordenação (P2): nada a construir.** Tudo já existe e o trabalho é de *ligação*:

| Peça | Onde já está | O que muda |
| --- | --- | --- |
| Ícones de fixado / silenciado | `ConversationListItem.tsx:113-116`, `isMuted` em `:28` | nada — reagem sozinhos ao merge |
| Ordem fixadas-primeiro no servidor | `PrismaChatConversationRepository.ts:60` | nada |
| Re-sort local ao fixar | `ChatPage.tsx:628-632` | o comparador é **extraído** para função pura e passa a ser usado também pelo evento remoto |
| Conversa ao topo em mensagem nova | `ChatPage.tsx:250-256` (`splice`/`unshift`) | **permanece como está** |

O comparador extraído (`byPinnedThenRecent`) preserva byte a byte a regra de hoje: fixadas primeiro,
depois `lastMessageAt` decrescente. O caminho local (`handleConversationStateChange`) passa a
chamá-lo em vez do `sort` inline — mesmo resultado, agora testável e compartilhado. Nenhuma
autoridade de ordenação é criada nem removida.

**Arquivamento remoto**: merge de campo **não basta**. `showArchived` decide a *consulta*
(`GET /conversations?archived=true`, `ChatPage.tsx:115`), não a renderização. O handler remoto
reaproveita exatamente a lógica de `ChatPage.tsx:619-624`: quando o novo valor difere de
`showArchived`, remove da lista, ajusta `archivedCount` e limpa a seleção se for a conversa aberta.
Mesma regra do arquivamento feito no painel — uma situação, um comportamento.

**Convergência da aba que originou a ação** (SYNC-10.2): o merge remoto é idempotente — aplica
valores, não alterna estados. A aba que já fez a atualização otimista recebe o mesmo valor e
converge sem piscar; `archived` que não muda de lado em relação a `showArchived` não remove nada.

**Limitação aceita**: a lista pagina em 50 (`repo:61-62`). Reordenação e remoção agem sobre a página
carregada; conversa fixada remotamente que esteja fora dela só sobe no próximo carregamento.

**Conversa aberta** (P3): o handler de `chat.message.created` não aplica badge quando
`conversationId === selectedId`, e dispara `markAsRead` com debounce trailing de 1,5 s. O debounce
existe para que uma rajada de 10 mensagens não vire 10 receipts de saída — é a única parte da
feature que toca tráfego de saída, e só para **reduzi-lo**.

---

## 10. Nomenclatura (white label)

Nada carrega nome de produto ou de lib: `CHAT_STATE_UPDATED`, `applyRemoteState`,
`ChatConversationStateListener`, `chat.state.updated`, `normalizeChatState`. "Remote" = outro
dispositivo do mesmo usuário, não um serviço externo.

---

## 11. Riscos

| Risco | Mitigação |
| --- | --- |
| Laço painel → WA → painel | Caminho real e ativo: `updateChatState` já emite `chatModify`. Supressão por diff (§6.4) corta o eco antes da gravação; nenhum handler de evento recebido pode chamar `updateChatState` (SEC-03) |
| Dois eventos do mesmo chat no mesmo lote | Compare-and-set no `updateMany` (§6.5-6); perdedor da corrida não republica |
| Tempestade de eventos na sessão recém-pareada | `state` vazio não emite (§5); diff vazio não publica (§6); `setImmediate` mantém fora do caminho crítico |
| Interpretar delta como absoluto e corromper o contador | Delta positivo descartado no adapter, com teste unitário dedicado |
| Remoção de `chat.archive.updated` quebrar consumidor | Nenhum consumidor existe (verificado: o tipo `ChatWsPayload` não lista o evento) |
| Conversa não encontrada na sync inicial | Ignorada em silêncio — comportamento já vigente para arquivamento |
| Conversa criada pelo history sync nasce com contador só da ingestão | Dívida aceita (spec, Out of Scope): o absoluto de `chats.upsert` é descartado e o desvio se corrige na primeira leitura real |
| Aba suspensa devolve socket "vivo" sem frames | Resync também no `visibilitychange`, com janela de 60 s (§9) |
| Resync virar polling disfarçado | Janela de 60 s para retomada de aba + debounce de 30 s; sem timer periódico em nenhum caminho |
| Duplicar lógica de lista já existente no `ChatPage` | Comparador de ordenação extraído e compartilhado; remoção por arquivamento reaproveita o caminho local (§9) |
| Estado remoto de conversa fora da página carregada | Aceito: a página tem 50 itens e o próximo carregamento corrige |
| Relógio do aparelho adiantado em `muteEndTime` | Comparação contra `Date.now()`; passado ⇒ `null` |
| `mutedUntil` expirar sem evento | Aceito: o painel calcula "silenciada" comparando com o agora na renderização, sem timer |
