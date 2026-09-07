# Sessões e Chat — problemas encontrados, causas e soluções

Registro do diagnóstico feito em **06–07/09/2026**, quando uma sessão do WhatsApp
ficou presa em `FAILED` e o painel deixou de mostrar mensagens em tempo real.

O objetivo deste documento é evitar que os mesmos becos sejam percorridos de novo:
cada item traz **o sintoma**, **a causa real** (nem sempre a aparente) e **o que
foi feito**. Vários sintomas tinham causas independentes que se pareciam entre si.

---

## 1. Sessão presa em `FAILED` após o WhatsApp revogar o dispositivo

**Sintoma:** clicar em Reconectar devolvia "A sessão encontrou um erro ou foi
desconectada", e o estado voltava para `FAILED` em segundos. Nenhum QR era gerado.

**Causa:** quando o WhatsApp revoga o dispositivo (`loggedOut`, `forbidden`,
`badSession`, `multideviceMismatch`), o adapter marcava `FAILED` mas **mantinha a
credencial morta** em `session_auth_states`. Todo reconnect reusava essa credencial,
recebia 401 e voltava para `FAILED` — laço permanente.

A única saída pela UI era **deletar a sessão**, o que criava um `sessionId` novo e
quebrava o vínculo de `chat_conversations.sessionId` → histórico bifurcado.

**Solução:** `translateDisconnect` passou a devolver `shouldClearCredentials`,
distinguindo credencial revogada de falha de transporte. Ao detectar revogação, o
adapter limpa o `statePayload` e **reabre o socket na hora**, de modo que o QR nasce
da mesma ação do usuário. Uma guarda (`pairingRestarts`) impede laço de
limpeza/reabertura.

**Cuidado ao mexer:** `connectionReplaced` **não** deve limpar credencial — ela
continua válida, e limpá-la forçaria um pareamento desnecessário.

---

## 2. Socket substituído derrubando o socket novo

**Sintoma:** `FAILED` logo após clicar em Reconectar, às vezes com
`connectionReplaced` no log.

**Causa:** `connectSession` encerrava o socket antigo e criava o novo em seguida.
O `close` do socket antigo chega **de forma assíncrona**, depois da criação do novo,
e o handler então apagava a entrada do socket novo no registry, sobrescrevia o
status e agendava outra reconexão. Dois sockets na mesma credencial fazem o
WhatsApp responder `connectionReplaced`.

**Solução:** cada socket carrega um `epoch`; eventos de gerações antigas são
descartados, e `detachSocket` remove os listeners antes de encerrar.

---

## 3. Contador de tentativas que nunca zerava

**Causa:** o número da tentativa vivia no closure do socket e não era reiniciado ao
conectar. Uma sessão que já tinha gasto as 5 tentativas ia direto para `FAILED` na
primeira queda recuperável seguinte.

**Solução:** contador movido para o registry e zerado em `connection === 'open'`.

---

## 4. Sessão morta a cada deploy, com status mentindo `CONNECTED`

**Sintoma:** depois de um deploy, o painel mostrava a sessão como `CONNECTED`, mas
nenhuma mensagem chegava. Recarregar não adiantava.

**Causa:** `SESSION_BOOTSTRAP_ON_STARTUP` tem default `false`. Sockets vivem na
memória do processo e morrem no restart, mas o status gravado antes do shutdown
sobrevive no banco. Ninguém religava e ninguém corrigia o status — indistinguível
de uma sessão saudável com quem ninguém está falando.

**Solução:**
- `SESSION_BOOTSTRAP_ON_STARTUP=true` no serviço da API (configuração de ambiente).
  As sessões voltam sozinhas, com a credencial persistida, **sem QR**.
- `SessionStatusReconciler` marca como `DISCONNECTED`, no startup, as sessões que o
  banco ainda dá como ativas — mas **apenas quando o bootstrap está desligado**.

**Cuidado ao mexer:** a reconciliação **não pode** rodar antes do bootstrap. É
justamente o status `CONNECTED` remanescente que diz ao bootstrap quem religar;
zerá-lo antes faria o bootstrap não encontrar nada.

---

## 5. Mensagens perdidas durante o deploy

**Causa:** mensagens que chegam com a sessão fora do ar são acumuladas pelo WhatsApp
e entregues na reconexão. O Baileys marca essa entrega como `append`
(`upsertMessage(msg, node.attrs.offline ? 'append' : 'notify')`) — **o mesmo tipo do
history sync**. Como `append` era descartado enquanto `BAILEYS_SYNC_FULL_HISTORY`
estivesse desligado (o padrão), tudo que chegava durante um deploy era perdido em
silêncio.

**Solução:** `append` passou a ser sempre ingerido — é mensagem real endereçada ao
tenant, não histórico antigo. O dedupe por `externalMessageId` impede duplicidade. O
despejo de histórico do pareamento continua atrás da flag, via `messaging-history.set`.

---

## 6. Painel não atualizava em tempo real

Três causas distintas, descobertas em sequência. Todas se pareciam com "o WebSocket
não funciona", e nenhuma era isso.

### 6.1 URL do WebSocket apontando para uma porta inexistente

`pnpm dev` roda `vite --mode dev`, então o Vite carrega **`.env.dev`**
(`VITE_API_URL=/api`), não o `.env`. O hook contornava o proxy do Vite montando a URL
com `window.location.hostname` + `VITE_API_PORT` (default `3000`) — onde não havia
API. O REST funcionava (passa pelo proxy) e o WS falhava com
`ERR_CONNECTION_REFUSED` em backoff infinito.

**Solução:** com `VITE_API_URL` relativo, o WS usa a origem da página. Em dev isso é
o proxy do Vite (`ws: true` já estava em `vite.config.ts`); em produção, o domínio do
painel.

### 6.2 Mensagem chegando com a conversa fechada

O handler só anexava a bolha se a conversa estivesse **aberta**, e a abertura
reaproveita o cache sem refetch. Toda mensagem recebida com a conversa fechada
atualizava só o card da lista e sumia ao reabrir.

**Solução:** o cache passa a ser atualizado também com a conversa fechada. Conversa
**ainda não carregada** é ignorada de propósito — criar um cache de um item faria a
abertura reaproveitá-lo e pular o fetch.

### 6.3 Bolha duplicada

O append não checava se o `id` já estava na lista. Duplicava com duas conexões WS
(StrictMode monta o efeito duas vezes em dev), com reentrega após reconexão, ou na
corrida entre evento e refetch.

**Solução:** dedupe por `id` antes de anexar.

---

## 7. Mensagens recentes não apareciam na conversa

**Sintoma:** o card da lista mostrava a última mensagem, mas a janela parava meses
atrás.

**Causa:** a listagem paginava com `orderBy sentAt asc` + `take limit`, devolvendo as
mensagens **mais antigas**. Em qualquer conversa maior que a página (ex.: 78
mensagens com `PAGE_SIZE` 40), as recentes nunca chegavam. O card usa
`lastMessagePreview`, campo separado, e por isso parecia certo.

**Solução:** a janela passou a ser sempre as `limit` mais recentes, respeitando o
cursor `before`. `orderDir` controla apenas a ordem do resultado.

---

## 8. Rolagem "maluca" ao abrir a conversa

**Causa:** o scroll ao fundo vinha de um contador global e a animação era inferida
dele (`'auto'` só quando valia 1). Como o contador nunca volta a 1, toda abertura a
partir da segunda usava `smooth` e rolava da mensagem mais antiga até a mais recente.

**Solução:** o sinal passou a carregar a intenção — abrir/trocar de conversa salta
direto ao fim; mensagem nova e envio próprio animam.

---

## 9. Identificadores internos exibidos como telefone

Ocorreu **duas vezes**, com origens diferentes. Vale como padrão de atenção: o
WhatsApp tem vários identificadores que *parecem* números e não são.

- **JID do grupo** (`<criador>-<timestamp>`, ex.: `554799247313-1615683047`) era
  publicado em `contact.phone` do DTO sintético de grupos e exibido onde vai o
  número. Corrigido: campo vazio para grupos, UI mostra "Grupo".
- **LID do participante** (ex.: `144285148151969`) era gravado em `fromParticipant`.
  `extractParticipantJid` ignorava `key.participantAlt` — onde vem o telefone real —
  e `resolveParticipantPhone` devolvia o LID como fallback. Corrigido: `participantAlt`
  é preferido e, sem resolução, o campo fica nulo.

**Regra:** nunca use LID ou JID de grupo como telefone. Sem telefone real, prefira
não exibir número.

---

## 10. Mídia de grupo não baixada

**Sintoma:** áudios não tocavam.

**Causa:** não é defeito — em grupos, a mídia só é baixada com
`autoDownloadMedia` ligado na conversa, e o padrão é desligado
(`shouldAutoDownloadGroupMedia`). No banco havia 295 de 337 áudios e 561 de 576
imagens sem `mediaUrl`.

**Limitação conhecida:** as mídias não baixadas são **irrecuperáveis**. Baixar depois
exigiria `mediaKey`/`directPath` da mensagem original, e nada disso é persistido —
`chat_messages` não guarda o payload cru, e o modelo `Message`, que tem `rawPayload`,
está sem uso (0 registros).

**Pendência de UX:** a bolha exibe um player completo para mídia inexistente. O certo
é indicar o estado "não baixada".

---

## 11. Avatares dos participantes sempre em iniciais

**Causa:** pipeline pela metade — o evento `CONTACT_AVATAR_UPDATED` e o
`ChatContactAvatarListener` existem, mas **nenhum ponto do adapter os emite**. Por
isso `chat_contacts.avatarUrl` estava nulo em 1503 de 1503 contatos.

**Solução:** `getGroupParticipants` busca a foto via `profilePictureUrl`, com limite
de 60 por listagem (é uma consulta de rede por participante). A URL do WhatsApp é
temporária e por isso **não é persistida**.

---

## 12. N+1 na listagem de conversas

**Causa:** o contato de cada conversa individual era buscado com `findById` dentro do
laço, em série. Com 51 conversas (19 individuais, 3 sessões): 23 consultas onde
bastavam 3, cada uma pagando a latência até o Postgres. Medido: ~125 ms de tempo de
servidor, contra ~33 ms da rota de mensagens.

**Solução:** carga em lote (`findByIds`) resolvida por `Map`. O cache de sessões já
existia.

---

## 13. Recursos de grupo aparecendo em conversa de contato

**Sintoma:** o painel de contexto de uma conversa individual exibia a seção
"Participantes" (vazia, com o texto "Nenhum participante adicional") e outros
controles que só fazem sentido em grupo.

**Causa:** a seção era renderizada sempre, deixando o dado vazio falar por si.

**Regra do projeto:** *nada exclusivo de grupo é renderizado em conversa de contato.*
Isso vale para a seção de participantes, o diálogo "Ver todos" (`GroupMembersDialog`),
o toggle de download automático de mídia e "Sair do grupo". O critério é
`conversation.isGroup`, e o componente responsável é
`app/src/features/chat/components/ConversationDetailsPanel.tsx`. Ao adicionar um
recurso novo de grupo, coloque-o dentro de um bloco `{isGroup && (…)}` — não confie em
"a lista virá vazia mesmo".

**Por que importa além do visual:** o `ChatPage` só busca participantes quando
`isGroup`; renderizar a seção fora disso sugere ao operador que existe um dado que
nunca será carregado.

---

## 14. Barreiras de interface (cópia e DevTools) sem efeito

**Sintoma:** `installUiGuards` executava (efeito confirmado no navegador), mas o
`<style>` não existia no `<head>`, `user-select` continuava `auto` e nenhum evento de
cópia ou menu de contexto era bloqueado.

**Duas causas somadas:**

1. O `DomGuardian` remove do `<head>` qualquer `<style>` sem um atributo reconhecido
   (`data-emotion`, `data-styled`, `data-vite-dev-id`, `data-app`). O estilo das
   barreiras era injetado com `data-ui-guards` e removido no mesmo instante. Estilos
   próprios do painel precisam carregar `data-app`.
2. `installUiGuards` resolvia a configuração com `{ ...DEFAULTS, ...options }`. O hook
   repassa `blockCopy`/`blockDevTools`/`blockContextMenu` mesmo quando não informados,
   e o `undefined` explícito **sobrescreve** o default — todas as barreiras ficavam
   desligadas sem nenhum erro. A resolução passou a ser campo a campo, com `??`.

**Alcance real:** essas barreiras criam atrito, não segurança. As DevTools abrem pelo
menu do navegador, o conteúdo aparece na aba de rede e uma captura de tela ignora
tudo. O que não pode vazar não deve chegar ao cliente — por isso a lista de membros é
paginada no servidor com cursor assinado (`api/src/shared/http/pagination/OpaqueCursor.ts`),
sem `limit`/`offset` vindos do front.

---

## Armadilhas de diagnóstico

Erros que custaram tempo e que vale reconhecer de longe:

1. **Status no banco não prova conexão viva.** `CONNECTED` sobrevive ao restart. Para
   saber se a sessão está de pé, olhe `lastConnectedAt` e a `version` de
   `session_auth_states` — se estão sendo atualizados, há socket.
2. **Erros de CORS, `ERR_FAILED` e WS com handshake 500, todos juntos**, são a
   assinatura da API reiniciando durante um deploy. Não investigue configuração antes
   de confirmar que o serviço está no ar.
3. **Testar tempo real exige tráfego real.** Um listener WebSocket sem mensagem
   chegando não prova nada — só que o canal está aberto.
4. **O painel mostrar o dado errado não significa que o backend errou.** Confirme
   antes na fonte: banco, depois a resposta HTTP da API, e só então o front.

---

## Configuração relevante

| Variável | Default | Efeito |
|---|---|---|
| `SESSION_BOOTSTRAP_ON_STARTUP` | `false` | Religa as sessões ativas no startup, com a credencial persistida, sem QR |
| `BAILEYS_SYNC_FULL_HISTORY` | `false` | Ingere o despejo de histórico do pareamento (`messaging-history.set`). Não afeta mais a entrega offline |
| `SESSION_BOOTSTRAP_MAX_CONCURRENT` | `1` | Sessões religadas em paralelo no startup |
