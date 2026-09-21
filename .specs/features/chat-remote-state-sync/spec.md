# Sincronização de Estado de Conversa entre Dispositivos — Especificação

**Módulo**: `messaging` (adapter) + `chat` (api/) + `chat` feature (app/)
**Escopo**: Large (adapter Baileys → evento interno → repositório → WebSocket → painel)
**Status**: Draft

---

## Problem Statement

Quando o usuário lê, arquiva, fixa ou silencia uma conversa pelo celular ou pelo WhatsApp Web, o
painel não sabe. O adapter recebe o estado em `chats.update` mas encaminha apenas `archived`
(`BaileysMessagingEngineAdapter.ts:694`); `unreadCount`, `pinned` e `muteEndTime` são descartados.
O operador vê badge de não lida em conversa já lida no celular, e conversas arquivadas em outro
aparelho continuam aparecendo. Pior: `chat.archive.updated` é publicado pela API e **nenhum
consumidor existe no painel** — o tipo `ChatWsPayload` nem lista o evento.

O estado já chega de graça pelo socket que a sessão mantém aberto. O problema é descarte de dado,
não falta de dado.

## Goals

- [ ] Leitura feita em outro aparelho zera o badge no painel em < 2 s, sem refresh
- [ ] Arquivar / fixar / silenciar em outro aparelho reflete na lista do painel
- [ ] **Zero chamadas novas ao WhatsApp**: nenhuma requisição de saída é criada por esta feature
- [ ] Reconexão do WebSocket recupera o estado perdido durante a queda, sem polling
- [ ] Nenhuma chamada Baileys fora do adapter, nenhum Prisma fora da infra (AGENTS.md §9, §15)

## Restrição de segurança (não negociável)

O número do usuário não pode adquirir padrão de tráfego anômalo. Esta feature é **somente de
consumo**: lê eventos que o socket já entrega e nunca origina tráfego para o WhatsApp.

| Proibido nesta feature | Motivo |
| --- | --- |
| Qualquer chamada de saída **nova** — `chatModify`, `fetchStatus`, `profilePictureUrl`, `onWhatsApp`, `readMessages` | Volume de saída fora do padrão humano é o principal sinal de automação. As chamadas que já existem (`updateChatState`, `markMessagesRead`) continuam como estão, disparadas só por ação explícita do operador |
| Gatilho novo para chamada de saída existente | Reagir a um evento recebido chamando `updateChatState` fecharia laço painel ↔ WhatsApp e multiplicaria o tráfego |

**Exceção única e delimitada (SYNC-09)**: marcar leitura quando a mensagem chega na conversa que o
operador já tem aberta. É gatilho novo por evento recebido, e está autorizado porque (a) reproduz o
que o WhatsApp Web faz — o humano está olhando a conversa; (b) só ocorre com conversa selecionada,
nunca em massa; (c) é agrupado em no máximo uma chamada por 1,5 s, então uma rajada de 10 mensagens
gera 1 receipt e não 10; (d) usa `markMessagesRead`, que já existe. A proteção contra laço não depende de suposição sobre
eco: **a supressão por diff** barra qualquer estado que volte igual ao persistido. Se o receipt
retorna ou não como `chats.update` para a própria sessão é questão a observar no smoke (T17), não
premissa do desenho.
| Polling de qualquer natureza (timer que consulta WA ou a própria API em intervalo fixo) | Custo constante sem evento real; ruído de tráfego |
| Reenvio de receipt como efeito de evento recebido | Cria laço painel ↔ WhatsApp |
| Subscrição nova no socket (`presenceSubscribe` em massa, etc.) | Saída adicional sem pedido do operador |

O único tráfego HTTP adicional é entre painel e a **própria API** (resync na reconexão), nunca com
o WhatsApp.

## Out of Scope

| Item | Motivo |
| --- | --- |
| Alterar o espelhamento *do painel para o WhatsApp* | Já existe e funciona: `updateChatState` no adapter (`BaileysMessagingEngineAdapter.ts:342-371`) chama `chatModify` para arquivar, fixar, silenciar e marcar lida/não lida. Esta feature **não toca** esse caminho — nem amplia, nem acrescenta gatilho novo |
| Adotar a contagem absoluta de não lidas do WhatsApp em `chats.update` | Valores positivos ali são delta (`event-buffer.js:613-616`); o contador do painel é derivado da ingestão e continua autoritativo |
| Reconciliar o contador de conversas criadas pelo history sync | Dívida aceita e registrada em `STATE.md`: sessão recém-pareada nasce com o contador derivado só do que o painel ingeriu, e o valor absoluto de `chats.upsert` é descartado. Consumir o absoluto exigiria ordenar upsert e ingestão do mesmo lote — custo alto para um desvio que se corrige na primeira leitura real |
| Estrelar / favoritar mensagem, labels, comunidades | Estado de mensagem/rótulo, não de conversa; nada consumido hoje |
| Estado de conversas que não existem no painel | O WhatsApp entrega estado de todos os chats do aparelho; sem conversa correspondente não há o que atualizar |
| Backfill histórico de estado além do que a sync inicial já entrega | Não há fonte extra sem chamada nova |
| Bloqueio/desbloqueio de contato | Fora do domínio de conversa |

---

## Semântica do `unreadCount` no Baileys 7.0.0-rc14 (fonte da regra)

Verificado em `chat-utils.js:711` e `event-buffer.js:613-616`:

| Valor recebido | Origem | Ação do painel |
| --- | --- | --- |
| `null` / ausente | sync inicial já lida | ignorar |
| `0` | `markChatAsReadAction` com `read: true` | zera contador + limpa `manuallyUnread` |
| `< 0` (`-1`) | `markChatAsReadAction` com `read: false` | marca `manuallyUnread = true`, **não mexe no contador** |
| `> 0` em `chats.update` | delta de mensagem nova | **ignorar** — a ingestão já incrementou |
| `>= 0` em `chats.upsert` / history | contagem absoluta da sync inicial | ignorar nesta versão (ver Out of Scope) |

`pinned` chega como **timestamp ou `null`** (`chat-utils.js:741`), não booleano.
`muteEndTime` chega como **epoch ms ou `null`** (`chat-utils.js:669`).

---

## User Stories

### P1: Leitura em outro aparelho zera o badge ⭐ MVP

**User Story**: Como operador, quero que a conversa que eu li no celular apareça como lida no
painel, para não perseguir badge fantasma.

**Why P1**: É a divergência que o usuário relata; as outras são consequência do mesmo descarte.

**Acceptance Criteria**:

1. WHEN o adapter recebe `chats.update` com `unreadCount === 0` para um chat com conversa no painel
   THEN o sistema SHALL zerar `unreadCount` e `manuallyUnread` da conversa e publicar o novo estado
   por WebSocket
2. WHEN o painel recebe esse evento THEN o sistema SHALL remover o badge da conversa na lista sem
   recarregar a página
3. WHEN o `unreadCount` recebido é positivo THEN o sistema SHALL ignorá-lo (é delta)
4. WHEN o chat recebido não tem conversa correspondente no painel THEN o sistema SHALL ignorar em
   silêncio, sem publicar WebSocket
5. WHEN o estado recebido é igual ao já persistido THEN o sistema SHALL **não** gravar e **não**
   publicar (supressão de eco)
6. WHEN o processamento de um chat falha THEN o sistema SHALL registrar `warn` e seguir para os
   demais chats do lote

**Independent Test**: com sessão conectada, abrir a conversa no celular e ver o badge sumir no
painel sem refresh.

---

### P1: Marcar como não lida em outro aparelho ⭐ MVP

**User Story**: Como operador, quero que "marcar como não lida" feito no celular apareça no painel.

**Why P1**: Mesma via de evento do story anterior; separá-lo em outra entrega duplicaria o trabalho.

**Acceptance Criteria**:

1. WHEN o adapter recebe `unreadCount < 0` THEN o sistema SHALL definir `manuallyUnread = true` sem
   alterar `unreadCount`
2. WHEN a conversa tem `manuallyUnread = true` e `unreadCount === 0` THEN o painel SHALL exibi-la
   como não lida na lista, no filtro "não lidas" e somá-la como 1 no total de não lidas (como no
   WhatsApp Web)
3. WHEN o operador abre a conversa no painel THEN o sistema SHALL limpar `manuallyUnread` junto com
   o contador, **no servidor e no estado local da aba que originou a ação**
4. WHEN a leitura é persistida THEN o sistema SHALL anunciar `manuallyUnread: false` junto do
   contador zerado, para que as demais abas/operadores também deixem de destacar a conversa

**Independent Test**: marcar como não lida no celular; a conversa fica destacada no painel.

---

### P1: Reconexão recupera estado perdido ⭐ MVP

**User Story**: Como operador, quero que o painel se realinhe depois de uma queda de conexão, para
não operar sobre estado velho.

**Why P1**: Sem isso, qualquer queda de WS deixa a UI mentindo até o próximo F5 — o bug volta.

**Acceptance Criteria**:

1. WHEN o WebSocket reconecta após ficar fora por mais de 5 s THEN o painel SHALL recarregar a lista
   de conversas uma única vez
2. WHEN a queda dura menos de 5 s THEN o painel SHALL **não** recarregar
3. WHEN ocorrem várias reconexões em sequência THEN o painel SHALL recarregar no máximo uma vez a
   cada 30 s (debounce)
4. WHEN o resync roda THEN o sistema SHALL usar exclusivamente a API do projeto — nenhuma chamada ao
   WhatsApp
5. WHEN a aba volta a ficar visível após ficar oculta por mais de 60 s THEN o painel SHALL aplicar a
   regra de resync com o mesmo debounce de 30 s, porque suspensão de máquina pode manter o socket
   aparentemente vivo enquanto frames se perdem
5.1. WHEN a aba fica oculta por menos de 60 s (alt-tab comum) THEN o painel SHALL **não** recarregar —
   janela curta aqui equivaleria a polling a cada 30 s
6. WHEN nenhum desses gatilhos ocorre THEN o painel SHALL **não** consultar nada — não existe timer
   periódico

**Independent Test**: derrubar a API por 20 s, ler a conversa no celular nesse intervalo, subir a
API e ver o painel realinhar sozinho.

---

### P2: Arquivamento em outro aparelho reflete na lista

**User Story**: Como operador, quero que conversa arquivada no celular saia da lista ativa do painel.

**Why P2**: Backend já emite `chat.archive.updated`; falta só o consumidor. Não é o sintoma relatado.

**Acceptance Criteria**:

1. WHEN o painel recebe estado com `archived` alterado e o novo valor difere da visão carregada
   (`showArchived`) THEN o sistema SHALL remover a conversa da lista e ajustar `archivedCount` —
   o filtro de arquivadas é do servidor (`GET /conversations?archived=true`), não um filtro de
   cliente, então marcar o campo no item não basta
2. WHEN o novo valor coincide com a visão carregada THEN o sistema SHALL apenas atualizar o campo,
   mantendo a conversa na lista
3. WHEN a conversa removida da visão é a selecionada THEN o sistema SHALL limpar a seleção —
   **mesmo comportamento já aplicado ao arquivar pelo painel** (`ChatPage.tsx:619-624`). Divergir
   aqui criaria duas regras para a mesma situação

---

### P2: Fixação e silenciamento em outro aparelho

**User Story**: Como operador, quero ver no painel o que está fixado e silenciado no celular.

**Why P2**: Chega na mesma mensagem `chats.update`; custo marginal quase nulo depois do P1.

**Acceptance Criteria**:

1. WHEN o adapter recebe `pinned` (timestamp ou `null`) THEN o sistema SHALL persistir
   `pinned = valor !== null`
2. WHEN o adapter recebe `muteEndTime` THEN o sistema SHALL persistir `mutedUntil` como data ou
   `null`
3. WHEN o painel recebe `pinned` alterado THEN o sistema SHALL reordenar a lista com o **mesmo
   critério já usado** ao fixar pelo painel (fixadas primeiro, depois `lastMessageAt` — ordem que o
   servidor também aplica em `orderBy: [{ pinned: 'desc' }, { lastMessageAt: 'desc' }]`)
4. WHEN a conversa está fixada ou silenciada THEN o painel SHALL exibir os indicadores que **já
   existem** (`ConversationListItem.tsx:113-116`) — nada de UI nova
5. WHEN a conversa fixada remotamente está fora da página carregada (a lista pagina em 50) THEN o
   sistema SHALL deixá-la subir apenas no próximo carregamento — limitação aceita

---

### P2: Ação de estado feita por outro operador chega às demais abas

**User Story**: Como operador, quero ver no painel o que outro operador da mesma conta arquivou,
fixou, silenciou ou marcou como não lida.

**Why P2**: A feature faz o painel refletir o celular; deixá-lo cego ao colega na mesma conta
produziria a mesma classe de divergência que estamos corrigindo. `PATCH /conversations/:id/state`
hoje não publica evento nenhum.

**Acceptance Criteria**:

1. WHEN `PATCH /conversations/:id/state` conclui THEN o sistema SHALL publicar por WebSocket, no
   evento já criado para o espelhamento remoto, exatamente estes campos: `archived`, `pinned`,
   `mutedUntil`, `manuallyUnread`, `favorite` e `lists` — todo o `ConversationStateDto` menos
   `syncedToWhatsApp`, que é resposta HTTP a quem pediu, não estado da conversa
2. WHEN a aba que originou a ação recebe esse evento THEN o sistema SHALL convergir para o mesmo
   estado que já aplicou de forma otimista, sem piscar nem duplicar efeito
3. WHEN a publicação é adicionada THEN o sistema SHALL **não** criar chamada de saída ao WhatsApp —
   a rota já chama `updateChatState`, e isso não muda
4. WHEN `syncedToWhatsApp` é `false` (sessão fora do ar) THEN o sistema SHALL publicar o estado
   mesmo assim — a mudança local aconteceu, e as demais abas precisam vê-la; o campo não vai no
   evento porque descreve a tentativa de sincronização, não a conversa

**Independent Test**: abrir o painel em duas abas, arquivar numa, ver sair da lista na outra.

---

### P3: Mensagem recebida na conversa aberta não gera badge

**User Story**: Como operador, quero que mensagem que chega na conversa que estou lendo não marque
não lida.

**Why P3**: Incômodo cosmético; independente da sincronização remota.

**Acceptance Criteria**:

1. WHEN chega mensagem para a conversa selecionada THEN o painel SHALL mantê-la sem badge
2. WHEN chegam várias mensagens em rajada na conversa aberta THEN o painel SHALL enviar no máximo
   uma marcação de leitura por janela de 1,5 s (debounce trailing), para não multiplicar receipts

---

## Edge Cases

- WHEN `chats.update` chega antes de a conversa existir (sync inicial de sessão recém-pareada)
  THEN o sistema SHALL ignorar em silêncio
- WHEN a sessão recém-pareada entrega centenas de chats de uma vez THEN o sistema SHALL processar
  fora do caminho crítico e publicar no máximo um evento por conversa efetivamente alterada
- WHEN o painel arquiva/fixa/silencia/marca lida (via `updateChatState`, que já existe) e o WhatsApp
  devolve o mesmo estado como eco THEN a supressão de não-mudança SHALL impedir gravação e
  publicação — é o laço mais provável, porque esse caminho de saída está ativo hoje
- WHEN o chat é `@broadcast` ou `@lid` THEN o sistema SHALL ignorar (regra já existente no adapter)
- WHEN o evento chega para tenant/sessão diferente da conversa THEN o filtro por `tenantId` +
  `sessionId` SHALL impedir atualização cruzada
- WHEN `muteEndTime` chega com valor no passado THEN o sistema SHALL tratar como não silenciada
- WHEN o socket entrega o mesmo estado repetidamente THEN nenhum frame WebSocket SHALL ser emitido

---

## Requirement Traceability

| ID | Story | Fase | Status |
| --- | --- | --- | --- |
| SYNC-01 | P1: Leitura remota | Design | Pending |
| SYNC-02 | P1: Leitura remota (ignorar delta positivo) | Design | Pending |
| SYNC-03 | P1: Leitura remota (supressão de eco) | Design | Pending |
| SYNC-04 | P1: Marcar como não lida remota | Design | Pending |
| SYNC-05 | P1: `manuallyUnread` visível e limpo ao abrir | Design | Pending |
| SYNC-06 | P1: Resync na reconexão | Design | Pending |
| SYNC-07 | P2: Arquivamento consumido no painel | Design | Pending |
| SYNC-08 | P2: Fixação e silenciamento | Design | Pending |
| SYNC-09 | P3: Conversa aberta sem badge + debounce de receipt | Design | Pending |
| SYNC-10 | P2: Ação de estado propagada entre abas/operadores | Design | Pending |
| SYNC-11 | P1: `manuallyUnread` limpo no servidor, no local e nas demais abas | Design | Pending |
| SEC-01 | Restrição: nenhuma chamada de saída nova ao WhatsApp | Design | Pending |
| SEC-02 | Restrição: nenhum polling; resync só por reconexão/retomada de aba, com debounce | Design | Pending |
| SEC-03 | Restrição: nenhum gatilho novo para chamada de saída existente (sem laço) | Design | Pending |

**Coverage**: 14 requisitos, 0 mapeados em tasks (pendente fase Tasks)

---

## Success Criteria

- [ ] Ler no celular reflete no painel em < 2 s, sem refresh, com sessão real
- [ ] Nenhuma chamada de saída de **tipo novo** ao WhatsApp: `git diff` da feature não introduz
      nenhum `socket.<método>` no adapter (hoje: `sendMessage`, `readMessages`, `presenceSubscribe`,
      `profilePictureUrl`, `onWhatsApp`, `chatModify`)
- [ ] Volume de saída **≤ baseline** no mesmo roteiro de smoke — a T15 reduz receipts em rajada, então
      igualdade exata não é esperada
- [ ] Nenhum frame WebSocket emitido quando o estado recebido não muda nada
- [ ] Sessão recém-pareada com 300+ chats não gera 300 frames WebSocket
- [ ] `pnpm typecheck && pnpm test` verdes em `api/` e `app/`
