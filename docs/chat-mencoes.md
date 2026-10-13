# Chat — Menções (@participante) em grupo

## Formato canônico

- O texto gravado (`chat_messages.body`) e o texto enviado ao WhatsApp usam **`@<telefone em dígitos>`**.
  É o formato que todo cliente WhatsApp resolve de volta para o nome do contato.
- O **nome** entra só na renderização do painel. Nunca gravar `@Nome` no banco.
- Menção estruturada no envio: além do texto, a API recebe `mentions: string[]` (telefones) e o adapter
  repassa em `socket.sendMessage(jid, { text, mentions })`, o que produz o destaque real no WhatsApp.

## Recebimento (API)

Arquivo: `api/src/modules/messaging/infrastructure/engines/baileys/BaileysMessagingEngineAdapter.ts`

1. `extractBaileysMessage` captura `contextInfo.mentionedJid`.
2. `resolveMentionsInBody` troca cada `@<lid>` do corpo pelo telefone real. Ordem de resolução:
   - `signalRepository.lidMapping` (só conhece quem já trocou chaves com a sessão);
   - fallback: metadata do grupo (`participants[].id/lid + phoneNumber`), já cacheado pelo roteamento
     da própria mensagem — sem ida extra à rede. Cobre menção feita de outro aparelho a um terceiro.
   - Se nenhum resolver, o LID fica como está (fallback silencioso, sem erro).
3. Chamado nos dois pontos de ingestão: mensagens ao vivo e history sync.

## Envio (API)

- `IMessagingEngine.sendTextMessage` aceita `mentions?: string[]` (telefones).
- `POST /conversations/:id/messages` (`chat.schema.ts`) aceita `mentions` — `additionalProperties: false` mantido.
- `SendMessageUseCase` só repassa; não valida pertencimento ao grupo (o WhatsApp ignora menção a não-membro).

## Painel

- `app/src/features/chat/mentions.ts` — `extractMentionPhones` (único ponto que decide o que vira menção:
  editar/apagar o `@<telefone>` depois de inserido remove a menção), `splitMentions` (texto → segmentos
  texto/menção, só com nome conhecido e fronteira de espaço) e `MentionNamesContext` (telefone → nome).
- `ChatPage` monta `participantNames` da conversa aberta; `ChatWindow` provê o contexto. Fora de grupo o mapa é vazio.
- `MessageComposer` — digitar `@` numa conversa de **grupo** abre popover de participantes
  (`chatService.listGroupParticipants`, busca com debounce). Selecionar insere `@Nome` no campo;
  `resolveMentionsForSend` converte para `@<telefone>` só no envio. `onSend(text, mentions?)` — o segundo
  argumento vem **só** quando há menção (nunca `undefined` explícito).
- `RichMessageText` renderiza `@<telefone>` conhecido como `@Nome` em destaque; desconhecido segue como número.
- Strings em `chatStrings.mention` (`strings.ts`) — seguir o padrão de chaves semânticas; sem nome de marca.

## Prévia da lista de conversas

- API: `ListConversationsUseCase` resolve `@<telefone>` → `@Nome` em `lastMessagePreview` de grupo
  usando `domain/services/resolveMentionNames.ts` e uma única `contactRepo.findByPhones` por listagem.
  O valor gravado em `chat_conversations.lastMessagePreview` **não muda** (segue com o telefone).
- Painel: `ChatPage` acumula `knownMentionNames` (contatos das conversas individuais já carregadas +
  participantes de todo grupo aberto na sessão; o participante vence o contato no mesmo telefone) e provê
  `MentionNamesContext` à `ConversationSidebar` **e** ao `ChatWindow`; `ConversationListItem` aplica
  `applyMentionNames` na prévia de grupo. Cobre a atualização em tempo real, que chega com `@<telefone>`,
  e mantém `@Nome` no balão mesmo quando `listGroupParticipants` falha (sessão desconectada no momento) —
  foi assim que "os nomes voltaram a ser número" após um deploy que derrubou a sessão.
- Limite conhecido: grupo nunca aberto na sessão cuja menção seja a contato **sem cadastro** no tenant
  continua mostrando o telefone até a próxima listagem com o contato criado.

## O que não fazer

- Não gravar `@Nome` no banco nem enviar `@Nome` ao WhatsApp.
- Não resolver LID fora do adapter Baileys (regra central da mensageria, AGENTS.md §9).
- Não habilitar popover de menção em conversa individual.
- Não derivar `mentions` de outro lugar que não o texto final (evita menção fantasma após edição).

## Testes

- `app/src/features/chat/mentions.test.ts` — extração, split e fronteiras.
- `api/.../baileys/BaileysErrorTranslator.test.ts` cobre `takenOverByAnotherInstance` (correlato de sessão, ver abaixo).

## Correlato: sessão tomada por outra instância (440)

`translateDisconnect` expõe `takenOverByAnotherInstance` (só `connectionReplaced`/440). No `close` com a
sessão tomada, o socket perdedor limpa o registro e sai **sem gravar status nem emitir `SESSION_DISCONNECTED`**.
Antes gravava `FAILED` por cima do `CONNECTED` da instância nova (overlap de deploy na Render), e o bootstrap
seguinte pulava a sessão. Documentado aqui porque o sintoma visível era "Nenhum participante disponível" no popover de menção.
