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

## Bloqueios

- **2026-09-24 — `develop` local tem um merge que nunca foi enviado.** O merge da branch de
  reações (infra de testes + CI) foi feito localmente; um `git pull --tags origin
  feature/chat-remote-state-sync` depois reaplicou os commits da feature sobre a linha remota,
  e a branch deixou de descender desse merge. Consequência prática: `git diff develop...HEAD`
  dá merge-base errado e traz conteúdo alheio à feature — usar a base real dos commits.
  Resolver enviando `develop` ou refazendo a integração antes do próximo merge.

- **i18n não existe no painel.** Nenhuma biblioteca de internacionalização instalada em `app/`;
  strings em pt-BR direto no JSX. O AGENTS.md exige cobertura de i18n em toda feature, o que hoje é
  impossível de cumprir literalmente. Features novas mantêm os textos centralizados no topo do
  componente, prontos para extração. Decidir a biblioteca e fazer a extração em chore próprio.

## Dívidas assumidas

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

## Decisões (continuação)

- **2026-09-24 — Reconciliação do contador é monotônica para baixo.**
  O total que vem do history sync só é aplicado quando reduz o `unreadCount`. Os lotes do
  history sync não têm ordem garantida, então um retrato antigo faria o badge voltar numa
  conversa já lida. O painel superestima por natureza (conta por ingestão, inclusive o que
  já fora lido no celular antes), então corrigir para baixo é onde essa fonte agrega;
  para cima a ingestão já cobre. Ver `diffRemoteState`.

## Lições

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
