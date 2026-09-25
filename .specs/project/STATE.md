# STATE

Memória entre sessões: decisões, bloqueios, lições.

## Decisões

- **2026-09-21 — A sincronização de estado vinda de outro aparelho é somente de consumo.**
  O painel reflete o que o socket já entrega (`chats.update`) e não origina nem amplia chamada ao
  WhatsApp para isso. Motivo: volume de saída fora do padrão humano é sinal de automação e arrisca o
  número do usuário. O sentido inverso (painel → WhatsApp) já existe em `updateChatState`
  (`BaileysMessagingEngineAdapter.ts:342-371`, via `chatModify`) e permanece disparado só por ação
  explícita do operador — nenhum handler de evento recebido pode chamá-lo, sob pena de fechar laço.
  Ver `.specs/features/chat-remote-state-sync/spec.md`.

- **2026-09-21 — O contador de não lidas do painel é autoritativo.**
  `unreadCount` positivo em `chats.update` é delta (`event-buffer.js:613-616`), não valor absoluto.
  Só `0` (lida) e `< 0` (marcada como não lida) são consumidos.

- **2026-09-24 — Reconciliação do contador é monotônica para baixo.**
  O total que vem do history sync só é aplicado quando reduz o `unreadCount`. Os lotes do
  history sync não têm ordem garantida, então um retrato antigo faria o badge voltar numa
  conversa já lida. O painel superestima por natureza (conta por ingestão, inclusive o que
  já fora lido no celular antes), então corrigir para baixo é onde essa fonte agrega;
  para cima a ingestão já cobre. Ver `diffRemoteState`.

- **2026-09-24 — Reação removida vira tombstone, não `DELETE`.** Plano de
  `message-reactions` revisado: set e remoção passam por uma única escrita last-write-wins em
  `reactedAt`, serializada por (mensagem, autor) com `pg_advisory_xact_lock` e decidida por função
  pura (`decideReactionWrite`). Sem a linha, remoção e reação fora de ordem não têm com o que
  comparar. Só publica no WS quem mudou o estado visível. A identidade do autor (`reactorKey`) é a
  crua do protocolo (`lid:`/`pn:`), nunca o telefone resolvido; gestos nossos usam o relógio do
  servidor, nunca o do celular do operador, e o eco do painel (reconhecido por id pré-gerado)
  mantém o carimbo original. O painel ordena agregados por `reactionsRevision` (maior
  `updatedAt`, tombstones incluídos), porque resposta HTTP não tem ordem entre requisições.
  Reação respeita a regra de volume da decisão de 2026-09-21 (sincronização só de consumo): o painel envia só o último gesto de uma
  sequência e a API limita por mensagem e por sessão (429). Ver `.specs/features/message-reactions/design.md` §4.

## Bloqueios

- **i18n não existe no painel.** Nenhuma biblioteca de internacionalização instalada em `app/`;
  strings em pt-BR direto no JSX. O AGENTS.md exige cobertura de i18n em toda feature, o que hoje é
  impossível de cumprir literalmente. Features novas mantêm os textos centralizados no topo do
  componente, prontos para extração. Decidir a biblioteca e fazer a extração em chore próprio.

## Resolvidos

- **2026-09-24 — infra de testes chegava a `develop` por duas linhagens.**

  **O que era**: o merge da branch de reações tinha sido feito só localmente e nunca enviado.
  Depois, um `git pull --tags origin feature/chat-remote-state-sync` reaplicou os commits da
  feature sobre a linha remota, que já trazia os mesmos arquivos de Vitest e CI com **outros
  SHAs**. `git log develop..HEAD | grep -i vitest` listava commits que `develop` já tinha sob
  outro hash, e `git merge-tree` acusava conflito em cinco arquivos — `CHANGELOG.md`, os dois
  `package.json`, `vitest.config.mts` e `utils.test.ts`.

  **Como foi resolvido**: o merge de reações subiu ao remoto e a feature foi rebaseada sobre
  `origin/develop`. O git reconheceu os patches idênticos e pulou sozinho os três commits
  duplicados (`6bb0c94`, `c6779f5`, `302ab2a`), restando só os 17 da feature. `develop` recebeu
  por fast-forward, sem conflito e sem histórico duplicado; o `git diff` entre o estado testado
  e o publicado veio vazio.

  **Por que fica registrado**: a causa se repete a cada pull que reescreve commits já
  publicados. O sintoma a procurar é conteúdo idêntico com SHAs diferentes dos dois lados.

  **O que o rebase desfez junto**: enquanto durou, os commits da feature ficaram intercalados
  com os de infra e nenhuma base linear separava os dois — por isso a auditoria de chamadas de
  saída foi escrita para varrer por commit. Em `develop` a intercalação não existe mais
  (`git log 4a1c122..develop` traz os 17 commits da feature contíguos), então o intervalo
  voltou a ser confiável. A varredura por commit permanece no script porque protege contra o
  caso voltar, não porque ele esteja ativo.

## Dívidas assumidas

- **Dois CHANGELOGs, um só em uso.** O da raiz recebe todas as entradas desde maio; `api/CHANGELOG.md`
  parou em 2026-09-07, mas é o que o AGENTS.md §31.3 cita. Novas entradas vão para o da raiz até
  o AGENTS.md ser alinhado.

- **`messages.upsert` roteia antes de descartar.** `buildIncomingMessageRoutingInfo` roda antes de
  `extractBaileysMessage` descartar reação/protocolo (adapter, ~linhas 547-555): em grupo, consulta
  metadados e resolve LID para nada. Pré-existente. Reordenar pede smoke próprio do recebimento.

- **`chat_messages` sem índice em `externalMessageId`.** A busca por id externo (status de entrega)
  é scan. Resolvida pela migration de `message-reactions` (T1), que depende do índice.

- **Versionamento fora de sincronia desde a 0.2.0.** Os `package.json` chegaram a `0.11.0`, mas
  o repositório tem uma única TAG (`v0.2.0`) e o CHANGELOG uma única seção fechada. Todo o
  trabalho posterior vive em `[Unreleased]`. AGENTS.md §31.3 pede versão nos três lugares ao
  mesmo tempo; §36.9 proíbe deploy sem TAG e entrada correspondente — e houve deploys. Sanar
  exige decidir o recorte das versões intermediárias, decisão de produto, não de código. Ver a
  nota no topo do CHANGELOG.

- **`unreadCount` e `manuallyUnread` chegam ao painel por dois eventos WS**: `chat.unread.updated`
  (ingestão + rota de leitura, este último com o campo `manuallyUnread` opcional) e
  `chat.state.updated` (espelhamento remoto + rota `PATCH /state`), com dois handlers no `ChatPage`
  escrevendo as mesmas flags. Inofensivo porque ambos aplicam valores absolutos e idempotentes,
  nunca alternância. Unificar exigiria mexer em caminhos que funcionam; fica para iteração futura.

- **`chat.state.updated` carrega campos de duas origens**: espelhados do WhatsApp (`archived`,
  `pinned`, `mutedUntil`, `unreadCount`, `manuallyUnread`) e marcações só do painel (`favorite`,
  `lists`). A separação é responsabilidade do **emissor** — o listener de espelhamento nunca
  preenche os dois últimos. Decisão tomada para evitar dois eventos e dois handlers escrevendo o
  mesmo item da lista; se um dia um consumidor precisar distinguir a procedência, aí sim vale
  separar.

- ~~Conversa criada pelo history sync nasce com contador só da ingestão.~~ **Resolvido em
  2026-09-21**, depois do primeiro teste com sessão real: o total do `messaging-history.set` passou
  a ser adotado. A dívida se mostrou grave, não cosmética — na sincronização inicial de app-state o
  WhatsApp entrega `unreadCount: null` para conversa já lida (`chat-utils.js:707`), então sem essa
  fonte o passivo acumulado antes da conexão ficava para sempre.

- **Reações — i18n pendente.** Textos centralizados em `app/src/features/chat/strings.ts`, prontos
  para extração. O que o `emoji-picker-react` não expõe por prop fica em inglês ("No results found",
  alguns `aria-label`).

- **Reações vindas do history sync fora de escopo.** Só `messages.reaction` em tempo real é
  ingerido; sem backfill.

- **`MessageBubble` sem `memo`.** Uma reação re-renderiza a lista inteira da conversa
  (item "sem re-render da lista" da T21 não cumprido).

- **`handleLoadMore` no `ChatPage` fecha sobre `messages` velho.** Bug pré-existente; atenuado
  para reações por `keepNewerReactions`, não corrigido.

- **Smoke de reações (T23) e de envio após o refactor da T8 pendentes.** Exigem banco local
  (Docker) e sessão WhatsApp real — `api/.env` aponta para produção.

## Lições

- **`ChatPresenter` escolhe campo a campo.** Os testes unitários dos use cases passavam e a
  listagem ainda descartava `reactions`/`externalMessageId`. Ao adicionar campo em DTO, conferir
  os pontos de integração: presenter e payload WS (`chat.message.created`).


- **Ler a lib não substitui rodar com sessão real.** A semântica de `unreadCount` foi lida direto do
  código do Baileys e ainda assim faltou o caso que mais importa: `isInitialSync && read` emite
  `null`, não `0`. O primeiro print de produção mostrou o painel com badge 50 numa conversa lida —
  algo que nenhuma leitura estática tinha apontado.

- Evento publicado sem consumidor passa despercebido: `chat.archive.updated` existia na API há
  tempos e o painel nunca o tratou — o tipo `ChatWsPayload` sequer o listava. Ao criar evento WS,
  fechar o par emissor/consumidor no mesmo commit.

- **Conferir o que já existe antes de planejar UI.** O plano previa construir indicadores de fixado
  e silenciado que já estavam prontos em `ConversationListItem.tsx:113-116`; faltava só a ordenação.
  Grep no componente antes de escrever a task teria evitado a task inteira.
