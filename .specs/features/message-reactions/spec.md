# Reações em Mensagens — Especificação

**Módulo**: `chat` (api/) + `chat` feature (app/)
**Escopo**: Large (multi-camada: Prisma → engine port → adapter Baileys → use cases → WS → REST → UI)
**Status**: Draft — revisado em 2026-09-24 (robustez; ver cabeçalho de `tasks.md`)

---

## Problem Statement

O painel exibe mensagens de WhatsApp mas ignora completamente reações: o adapter Baileys descarta
`reactionMessage` (`BaileysMessagingEngineAdapter.ts:1365`) e não há tabela, evento interno nem UI.
Quem opera pelo painel vê a conversa incompleta em relação ao celular — reações do contato somem, e
o operador não consegue responder com o gesto mais barato que existe (👍 em vez de uma mensagem).
Em grupos a perda é maior: reação é o principal sinal de leitura/acordo sem poluir o histórico.

## Goals

- [ ] Operador reage e remove reação em qualquer mensagem da conversa pelo painel, refletido no WhatsApp
- [ ] Reações recebidas aparecem na bolha correspondente em < 2 s (via WebSocket), sem refresh
- [ ] Reações persistidas sobrevivem a reload e paginação do histórico (vêm no `GET /messages`)
- [ ] Zero acoplamento novo: nenhuma chamada Baileys fora do adapter, nenhum Prisma fora da infra

## Out of Scope

| Item | Motivo |
| --- | --- |
| Reações no backfill/`historySync` | Decisão do usuário (ver `context.md` D2). Ordem de chegada (reação antes do alvo) e volume dobram o custo do sync; entra em iteração posterior |
| Reação em status/broadcast | Fluxo já ignorado no adapter (`@broadcast`) |
| Reação a mensagem de enquete/poll | Poll não é ingerido hoje |
| Métricas/relatórios de reações | Fase 6 do roadmap (metrics) |
| Notificação push/som ao receber reação | Não existe infra de notificação no painel |
| Reação por campanha/automação/bot | Feature de operador; automação usa outro caminho |

---

## User Stories

### P1: Reagir a uma mensagem pelo painel ⭐ MVP

**User Story**: Como operador, quero reagir com um emoji a uma mensagem da conversa para
confirmar/expressar algo sem enviar uma nova mensagem.

**Why P1**: É a metade "escrita" da feature; sem ela a entrega é só leitura passiva.

**Acceptance Criteria**:

1. WHEN o operador passa o mouse sobre uma bolha THEN o sistema SHALL exibir um botão de reação
   junto às ações já existentes (responder / menu)
2. WHEN o operador clica no botão de reação THEN o sistema SHALL abrir a barra rápida com
   👍 ❤️ 😂 😮 😢 🙏 e um botão "+" para o picker completo
3. WHEN o operador escolhe um emoji THEN o sistema SHALL exibir a reação na bolha imediatamente
   (otimista) e enviar `PUT /api/chat/messages/:id/reaction`
4. WHEN a API confirma THEN o sistema SHALL persistir a reação e emiti-la no WhatsApp pela sessão
   dona da conversa
5. WHEN o envio pela engine falha THEN o sistema SHALL reverter a reação otimista e exibir um alerta
   não bloqueante
6. WHEN o operador já reagiu àquela mensagem e escolhe outro emoji THEN o sistema SHALL substituir a
   reação anterior (uma reação por autor por mensagem, como no WhatsApp)

**Independent Test**: reagir a uma mensagem no painel e ver o emoji aparecer no WhatsApp do celular.

---

### P2: Remover a própria reação

**User Story**: Como operador, quero remover a reação que dei para corrigir um clique errado.

**Why P2**: Depende da mesma rota do P1, mas a feature já é útil sem ela por um ciclo.

**Acceptance Criteria**:

1. WHEN o operador clica no chip da reação que ele mesmo deu THEN o sistema SHALL remover a reação
2. WHEN o operador reabre a barra rápida e clica no emoji já ativo THEN o sistema SHALL remover a reação
3. WHEN a remoção é confirmada THEN o sistema SHALL enviar reação vazia ao WhatsApp (`text: ''`),
   gravar tombstone (`emoji = NULL`, ver `context.md`) e publicar o novo agregado por WebSocket

**Independent Test**: reagir, remover, e confirmar que o emoji sumiu no celular.

---

### P1: Ver reações recebidas na bolha ⭐ MVP

**User Story**: Como operador, quero ver as reações que o contato (ou participantes do grupo) deram
às mensagens para entender a conversa como ela realmente está no celular.

**Why P1**: É o gap funcional que motiva a feature; sem isso o painel continua mentindo.

**Acceptance Criteria**:

1. WHEN o WhatsApp emite uma reação para uma mensagem conhecida THEN o sistema SHALL persistir e
   publicar `chat.message.reaction.updated` para o tenant
2. WHEN o painel recebe o evento com a conversa aberta THEN o sistema SHALL atualizar a bolha sem recarregar
3. WHEN reações iguais existem de autores diferentes THEN o sistema SHALL agrupar por emoji exibindo
   `emoji + contagem` (contagem oculta quando = 1)
4. WHEN o operador passa o mouse sobre um chip THEN o sistema SHALL exibir tooltip com os nomes dos autores
5. WHEN a reação é removida no celular (`text` vazio) THEN o sistema SHALL apagar o chip correspondente
6. WHEN a conversa é carregada/paginada THEN `GET /api/chat/conversations/:id/messages` SHALL trazer
   as reações agregadas de cada mensagem
7. WHEN uma reação é recebida ou enviada THEN o sistema SHALL manter inalterados `lastMessageAt`,
   `lastMessagePreview`, `unreadCount` e `status` da conversa — reação não reordena a lista nem
   marca a conversa como não lida
8. WHEN um contato reage a mensagem nossa numa conversa arquivada e a conta tem "manter conversas
   arquivadas" desligado THEN a conversa SHALL desarquivar — pelo caminho de espelhamento de estado
   (`chats.update` → `CHAT_STATE_UPDATED`), nunca pelo de reação. É o que o celular faz
   (`process-message.js:200-205`); o caminho de reação continua sem escrever na conversa

**Independent Test**: reagir pelo celular a uma mensagem e ver o chip surgir no painel com a conversa aberta.

---

### P3: Reações em grupo com identificação do autor

**User Story**: Como operador de grupo, quero saber quem reagiu para atribuir a reação à pessoa certa.

**Why P3**: Refinamento visual — o P1 já grava o autor; aqui é a resolução de nome/avatar.

**Acceptance Criteria**:

1. WHEN a reação vem de um participante de grupo THEN o sistema SHALL guardar o telefone e o pushName do autor
2. WHEN o autor for conhecido em `ChatContact` THEN o tooltip SHALL exibir o nome do contato em vez
   do telefone, resolvido no mesmo lote `findByPhones` já usado para avatares de participante
3. WHEN o autor chega como `@lid` THEN o sistema SHALL tentar o telefone por `participantAlt`/
   `remoteJidAlt` e depois pelo mapeamento LID→telefone da sessão — a mesma resolução que o adapter
   já usa para remetente de grupo (`extractParticipantJid` + `resolveParticipantPhone`)
4. WHEN nenhuma resolução dá telefone THEN o sistema SHALL exibir "Participante" e não descartar a reação
5. WHEN o mesmo autor reage duas vezes e o telefone passou a resolver entre uma e outra THEN o
   sistema SHALL tratar como o mesmo autor — a identidade da reação é a crua do protocolo, não o
   telefone resolvido (`context.md`, `reactorKey`)

---

## Edge Cases

- WHEN a reação chega para uma mensagem que não existe no banco (fora da janela ingerida) THEN o
  sistema SHALL descartar silenciosamente com log `debug` — não criar mensagem fantasma
- WHEN o mesmo evento de reação chega duas vezes (upsert + reaction, reconexão) THEN o sistema SHALL
  ser idempotente via `@@unique([messageId, reactorKey])` + escrita last-write-wins (`apply`)
- WHEN chegam duas reações do mesmo autor fora de ordem THEN o sistema SHALL manter a de
  `reactedAt` maior e ignorar a mais antiga — **inclusive quando uma delas é remoção**: remoção
  atrasada não apaga reação mais nova, e reação atrasada não ressuscita reação removida (tombstone)
- WHEN o relógio do celular do operador diverge do servidor THEN a ordem entre gestos nossos
  (painel × celular) SHALL seguir o relógio do servidor, não o carimbo do aparelho
- WHEN o operador clica dois emojis em sequência rápida pelo painel THEN o estado final SHALL ser o
  do último clique, mesmo que os ecos ou as respostas HTTP cheguem fora de ordem
- WHEN o `PUT` falha no cliente (timeout) mas a reação foi aplicada e o WS chegou THEN o painel
  SHALL manter a reação visível, não voltar ao estado anterior
- WHEN o operador clica vários emojis em sequência na mesma mensagem THEN o painel SHALL mostrar
  cada gesto na hora e enviar ao WhatsApp **só o último** — rajada de reações é volume de saída
  fora do padrão humano e arrisca o número (`STATE.md`)
- WHEN a API recebe reações acima do limite por mensagem ou por sessão THEN SHALL responder 429
  sem enviar nem gravar
- WHEN o `PUT` do painel e o eco da engine gravam ao mesmo tempo, em qualquer ordem THEN o sistema
  SHALL serializar as duas escritas e publicar **um** evento WS — só quem mudou o estado visível publica
- WHEN a conversa não tem `sessionId` ou não há engine disponível THEN o sistema SHALL falhar com
  `SESSION_NOT_CONNECTED` — **não** repetir o fallback do `SendMessageUseCase`, que grava a mensagem
  sem enviar (`SendMessageUseCase.ts:53-78`). Reação gravada sem envio mente para o operador
- WHEN a mensagem alvo não tem `externalMessageId` (enviada sem engine, ainda sem id do WhatsApp)
  THEN o painel SHALL ocultar o botão de reagir e a API SHALL responder 409 se chamada direto
- WHEN a mensagem alvo é de grupo, de terceiro, e não tem `fromParticipant` THEN o sistema SHALL
  recusar o envio com erro interno em vez de mandar uma key sem `participant` (o WhatsApp aceita e
  não aplica — falha silenciosa)
- WHEN a sessão está desconectada e o operador reage THEN o sistema SHALL falhar com
  `SESSION_NOT_CONNECTED` traduzido e NÃO persistir a reação
- WHEN o emoji recebido não é um emoji válido (string arbitrária do protocolo) THEN o sistema SHALL
  rejeitar no envio quando: vazio; acima de 64 bytes; composto inteiramente de ASCII; ou contendo
  qualquer caractere de whitespace ou controle.
  Keycap (`1️⃣`, `#️⃣`, `*️⃣`) contém ASCII e SHALL ser aceito
- WHEN a mensagem alvo foi apagada (`isDeleted`) THEN o painel SHALL ocultar o botão de reagir
- WHEN a conversa tem 500+ mensagens carregadas THEN a listagem SHALL buscar reações em uma única
  query por lote de mensagens (sem N+1)
- WHEN a reação parte do próprio celular do operador (fromMe) THEN o sistema SHALL registrá-la como
  reação nossa e o chip SHALL aparecer marcado como "sua"
- WHEN a reação enviada pelo painel volta como eco da própria engine (`emitOwnEvents`) THEN o
  sistema SHALL tratá-la como no-op — mesma `reactorKey`, agregado idêntico, sem segundo evento WS
- WHEN o emoji tem múltiplos code points (ZWJ, tag sequence, skin tone) THEN o sistema SHALL aceitá-lo
  — a validação é por tamanho (≤ 64 bytes), não por contagem de code points

---

## Requirement Traceability

| ID | Story | Fase | Status |
| --- | --- | --- | --- |
| REACT-01 | P1 Reagir | Design | Pending |
| REACT-02 | P1 Reagir (persistência + unicidade por autor) | Design | Pending |
| REACT-03 | P1 Reagir (envio pela engine) | Design | Pending |
| REACT-04 | P1 Reagir (rollback otimista em falha) | Design | Pending |
| REACT-05 | P2 Remover reação | Design | Pending |
| REACT-06 | P1 Receber (evento engine → evento interno) | Design | Pending |
| REACT-07 | P1 Receber (persistência idempotente) | Design | Pending |
| REACT-08 | P1 Receber (WS `chat.message.reaction.updated`) | Design | Pending |
| REACT-09 | P1 Receber (agregado no `GET /messages`) | Design | Pending |
| REACT-10 | P1 Exibir (chips agrupados por emoji na bolha) | Design | Pending |
| REACT-11 | P3 Autoria em grupo (nome/telefone no tooltip) | Design | Pending |
| REACT-12 | Transversal (tema claro/escuro/sistema + acessibilidade) | Design | Pending |
| REACT-13 | Transversal (strings centralizadas, white label) | Design | Pending |
| REACT-14 | P1 Receber (reação não altera ordenação/preview/não lidas da conversa) | Design | Pending |

**Cobertura**: 14 requisitos, mapeados em `tasks.md`.

---

## Success Criteria

- [ ] Reagir/remover pelo painel reflete no celular em < 3 s
- [ ] Reagir/remover no celular reflete no painel em < 2 s com a conversa aberta
- [ ] `tsc --noEmit` limpo em `api/` e `app/`
- [ ] Nenhuma reação duplicada após reconexão de sessão (teste: derrubar e subir a sessão)
- [ ] Listagem de 200 mensagens com reações não adiciona mais de 1 query extra
- [ ] Chips legíveis nos três temas (claro, escuro, sistema) e navegáveis por teclado
- [ ] Reagir a uma mensagem antiga não altera a posição da conversa na lista nem o contador de não lidas
- [ ] Remover e reagir em sequência rápida (painel e celular) converge para o último gesto nos dois lados
