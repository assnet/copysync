# Pesquisa — link de convite e contagem de membros via Baileys

Escopo: só fatos com arquivo:linha. Sem implementação. Caminhos relativos a `api/`.

## 1. Baileys

| Item | Valor |
|---|---|
| Versão declarada | `package.json:35` → `@whiskeysockets/baileys@7.0.0-rc14` (instalada igual) |
| Fonte dos métodos de grupo | `node_modules/@whiskeysockets/baileys/lib/Socket/groups.js` / `.d.ts` |
| Tipos | `node_modules/@whiskeysockets/baileys/lib/Types/GroupMetadata.d.ts` |

### Métodos (groups.js / groups.d.ts)

| Método | Assinatura (`groups.d.ts`) | Impl. (`groups.js`) | O que faz |
|---|---|---|---|
| `groupMetadata` | `:6` `(jid: string) => Promise<GroupMetadata>` | `:19-22` — IQ `get` xmlns `w:g2` `<query request="interactive"/>` → `extractGroupMetadata` | Metadata completo. Funciona para qualquer membro |
| `groupInviteCode` | `:23` `(jid) => Promise<string \| undefined>` | `:171-175` — IQ `get` `<invite/>`; devolve `invite.attrs.code` | Só o código; link = `https://chat.whatsapp.com/` + code |
| `groupRevokeInvite` | `:24` `(jid) => Promise<string \| undefined>` | `:176-180` — IQ `set` `<invite/>`; devolve novo code | Revoga e gera novo |
| `groupGetInviteInfo` | `:39` `(code) => Promise<GroupMetadata>` | `:248-251` — IQ `get` para `@g.us` `<invite code=…/>` → `extractGroupMetadata` | Metadata de grupo por código (sem ser membro) |
| `groupFetchAllParticipating` | `:23-…` | `:23-…` | Já usado no projeto (`listParticipatingGroups`) |

### `extractGroupMetadata` (`groups.js:272-346`) — campos relevantes

| Campo | Origem | Linha |
|---|---|---|
| `subject` | `group.attrs.subject` | `:309` |
| `size` | `group.attrs.size` se presente, senão `participants.length` | `:314` |
| `desc` | `<description><body>` | `:287-295`, `:320` |
| `owner` | `group.attrs.creator` normalizado | `:316` |
| `participants[]` | `<participant>` → `{ id, phoneNumber, lid, username, admin: attrs.type \| null }` | `:331-340` |
| `addressingMode` | `'lid' \| 'pn'` | `:308` |
| `memberAddMode` | `member_add_mode === 'all_member_add'` | `:306` |

Tipo `GroupParticipant` (`GroupMetadata.d.ts:3-7`): `Contact & { isAdmin?, isSuperAdmin?, admin?: 'admin' \| 'superadmin' \| null }`. Só `admin` é preenchido pelo extractor; `isAdmin`/`isSuperAdmin` ficam undefined.
`GroupMetadata.size?: number` (`GroupMetadata.d.ts:48-49`).

### Erros no caminho IQ

| Ponto | Comportamento |
|---|---|
| `Socket/socket.js:136-137` | `query()` chama `assertNodeErrorFree(result)` |
| `WABinary/generic-utils.js:54-59` | `<error code text/>` → `throw new Boom(text \|\| 'Unknown error', { data: +code })` — **`statusCode` fica 500** (Boom 9.1.4 default, `@hapi/boom/lib/index.js:77`); o código WA vai em `err.data` |
| `groups.js:275-281` | `extractGroupMetadata` sem `<group>`: `Boom(text, { statusCode: code })` — aqui sim `output.statusCode` = código WA |

Consequência: erro de `groupInviteCode` sem permissão chega como Boom com `output.statusCode = 500`, `message = text` do WA, `data = código` (ex.: `403`/`401`).

### Admin é exigido?

| Fonte | Diz |
|---|---|
| README Baileys (fetch `raw.githubusercontent.com/WhiskeySockets/Baileys/master/README.md`) | Seção Groups: "To change group properties you need to be admin". Exemplos de `groupInviteCode`/`groupRevokeInvite`/`groupGetInviteInfo`/`groupMetadata` sem nota extra |
| `baileys.wiki/docs/socket/groups` e `/docs/category/socket/` | 404 em 2026-10-28 — sem confirmação na wiki |
| Comportamento WhatsApp | Link de convite é recurso de admin; membro comum recebe `<error code="403" text="forbidden"/>` (ou `401 not-authorized`) no IQ `<invite/>`. Exceção: grupo com `memberAddMode` (todos podem adicionar) pode liberar o link a membros. **Validar empiricamente** em sessão de teste antes de fixar a regra |
| `groupRevokeInvite` | Sempre admin |
| `groupMetadata` | Qualquer membro; é o que já roda em `getGroupParticipants` |

Recomendação: não inferir permissão só por `isSelfAdmin`; tentar `groupInviteCode` e traduzir o erro (ver §4). `isSelfAdmin` serve para a UI avisar antes.

## 2. Encaixe no projeto

### Port — `src/modules/messaging/domain/contracts/IMessagingEngine.ts`

| Linha | Membro | Retorno |
|---|---|---|
| `:238` | `getGroupParticipants(sessionId, groupJid)` | `Promise<GroupParticipantInfo[]>` |
| `:244` | `listParticipatingGroups(sessionId)` | `Promise<ParticipatingGroupInfo[]>` (`:290-294` → `{ groupJid (sem @g.us), name }`) |
| `:255` | `fetchProfilePicture(sessionId, jid, isGroup)` | `Promise<string \| null>` |
| `:296-309` | `GroupParticipantInfo` | `{ jid, phone \| null, name \| null, avatarUrl \| null, isAdmin: boolean }` |

Convenção: `groupJid` **sem** `@g.us` (`:241`, `:253`); adapter completa.

### Implementações do port

| Arquivo | Tipo |
|---|---|
| `src/modules/messaging/infrastructure/engines/baileys/BaileysMessagingEngineAdapter.ts:122` | única `implements IMessagingEngine` |
| `src/modules/messaging/infrastructure/MessagingEngineFactory.ts:23-34` | só `case 'baileys'` |
| `src/shared/engine/activeEngine.ts:10-16` | singleton `getActiveEngine()` |
| `src/modules/sessions/application/use-cases/sessionTestFakes.ts:46` | fake `as unknown as IMessagingEngine` (parcial — não quebra ao adicionar método) |
| Testes do chat (`SendMessageUseCase.test.ts:55,174` etc.) | fakes parciais `as unknown as IMessagingEngine` — idem |

Nenhuma outra engine/fake completa: adicionar método ao port exige mudar **só o adapter Baileys**.

### Adapter — `BaileysMessagingEngineAdapter.ts`

| Linha | O quê |
|---|---|
| `:94-95` | `PROFILE_PICTURE_TTL_MS = 6h`, `PARTICIPATING_GROUPS_TTL_MS = 60s` |
| `:124-125` | `groupMetadataCache: Map<string, GroupMetadataSnapshot>`, `groupMetadataPending` (dedupe de consultas simultâneas) |
| `:462-476` | `listParticipatingGroups` — `requireConnectedEntry` + `groupFetchAllParticipating`, cache 60s, `translateEngineError` |
| `:478-547` | `getGroupParticipants` — `requireConnectedEntry(:479)`, completa `@g.us` (`:480`), `groupMetadata` via cast `BaileysSocketWithGroupHelpers` (`:483`), avatares em lote, mapeia `isAdmin: p.admin === 'admin' \|\| 'superadmin'` (`:533`), `translateEngineError` (`:545`). **Sem cache de metadata** — consulta WA toda vez |
| `:1348-1385` | `getGroupMetadataSnapshot(socket, sessionId, tenantId, groupRemoteJid, groupJid)` — chave `${sessionId}:${groupJid}`; **sem TTL** (cache até limpar); `groupName` vazio → não cacheia (`:1370-1373`); erro → `null` (nunca lança) |
| `:1657-1667` | `GroupMetadataSnapshot = { groupName, addressingMode: 'lid'\|'pn'\|null, lidToPhone: Record<lid, phone> }` — **não guarda `size` nem admins** |
| `:1669-…` | `buildLidToPhoneMap(participants)` |
| `:1411-1420` | `clearSessionGroupMetadata(sessionId)` — invalidação por prefixo; chamada em disconnect `:193`, logout `:216`, close/reconnect `:727` |
| `:1558-1562` | `requireConnectedEntry` → `SessionNotConnectedError` |
| `:1691-1703` | `type BaileysSocketWithGroupHelpers` — tipagem local de `groupMetadata` com só `subject`, `participants`, `addressingMode` (precisaria ganhar `size?`; ou usar o tipo real do socket, já que `groupMetadata` existe em `groups.d.ts:6`) |

### Onde encaixar os métodos novos

| Peça | Local | Nota |
|---|---|---|
| Port `getGroupInviteLink(sessionId, groupJid): Promise<string>` | `IMessagingEngine.ts` após `:244` (junto de `listParticipatingGroups`) | Devolver link completo ou só code? Decidir no spec; sugerido devolver o code e montar URL no use case (`https://chat.whatsapp.com/<code>`) |
| Port `getGroupSummary(sessionId, groupJid): Promise<GroupSummaryInfo>` | idem; tipo novo ao lado de `ParticipatingGroupInfo` (`:290`) | `{ name: string \| null, memberCount: number, isSelfAdmin: boolean }` |
| Adapter `getGroupInviteLink` | ao lado de `getGroupParticipants` (`:478`) | `requireConnectedEntry` → `${groupJid}@g.us` → `entry.socket.groupInviteCode(remoteJid)` → `undefined` = erro → `translateGroupInviteError` (novo, §4) |
| Adapter `getGroupSummary` | idem | `groupMetadata(remoteJid)`: `name = subject`, `memberCount = metadata.size ?? participants.length`, `isSelfAdmin` (§3). Cache opcional: reaproveitar `groupMetadataCache` **só** se o snapshot ganhar `size`/`selfAdmin` e TTL — hoje não tem TTL, então contagem ficaria estagnada |
| Fakes | nenhum ajuste obrigatório | fakes são parciais via cast |
| Opcional `revokeGroupInviteLink` | idem | `groupRevokeInvite`; só admin |

## 3. Como saber se o próprio número é admin

| Fato | Local |
|---|---|
| Admin de participante | `BaileysMessagingEngineAdapter.ts:533` — `p.admin === 'admin' \|\| p.admin === 'superadmin'`; único ponto de leitura |
| `isAdmin` exposto ao chat | `IMessagingEngine.ts:308`; `ListGroupParticipantsUseCase.ts:30,110` só repassa — **ninguém hoje calcula "eu sou admin"** |
| Próprio JID (PN) | `entry.socket.user.id` (`:290`, `:374`) — formato `55…:<device>@s.whatsapp.net`; `state.creds.me?.id` (`:706`) → `Session.phone` via `sessionRepo.updatePhone` |
| Próprio LID | `socket.user?.lid` (`:454`, `:1623`) — normalizado com `jidNormalizedUser` (`:1624`) |
| Participante em grupo LID | `id` = `@lid`, telefone em `phoneNumber` (`:519-526`); em grupo PN `id` = `@s.whatsapp.net`, `lid` opcional (`buildLidToPhoneMap :1669+`) |

Regra sugerida para `isSelfAdmin` (dentro do adapter): `me = { pn: jidNormalizedUser(socket.user.id), lid: socket.user.lid && jidNormalizedUser(socket.user.lid) }`; participante é "eu" se `p.id ∈ {me.pn, me.lid}` ou `p.phoneNumber === me.pn` ou `p.lid === me.lid`; então `admin !== null`. Comparar sempre normalizado (sem sufixo `:device`).

## 4. Tradução de erros

| Fato | Local |
|---|---|
| Tradutor | `src/modules/messaging/infrastructure/engines/baileys/BaileysErrorTranslator.ts:147-168` `translateEngineError(err)` |
| Boom é detectado por `output.statusCode` | `:22-31` (`isBoomLike`); só `loggedOut` → `SessionExpiredError`; qualquer outro Boom → `EngineTemporarilyUnavailableError` (503) |
| `Error` genérico | `not open/not connected` → `SessionNotConnectedError`; `timeout` → `RecoverableConnectionError`; resto → `EngineNotReadyError` |
| Variantes por operação | `translateSendError :176`, `translatePairingError :194` — padrão: envolver `translateEngineError` e trocar o fallback por erro específico da operação |
| Erros internos de mensageria | `src/shared/errors/internal/MessagingErrors.ts` — `MESSAGE_SEND_FAILED` 502, `ENGINE_NOT_READY` 503, `ENGINE_TEMPORARILY_UNAVAILABLE` 503, `RECOVERABLE_CONNECTION_ERROR` 503, `PAIRING_FAILED` 400 |
| Sessão | `SessionErrors.ts` — `SESSION_NOT_CONNECTED` 409, `SESSION_EXPIRED` 401, etc. |
| Genéricos | `AuthErrors.ts:11` `ForbiddenError` (`FORBIDDEN` 403) — é de auth do painel, **não reutilizar** para permissão de grupo (código ambíguo para o front) |
| Padrão de nome | `<Recurso><Problema>Error` + código `UPPER_SNAKE` + status, em `shared/errors/internal/*Errors.ts` (ex.: `GroupMonitorErrors.ts:16` `GroupMonitorGroupConflictError` → `GROUP_MONITOR_GROUP_CONFLICT` 409) |

Problema concreto: um `403 forbidden` do WA em `groupInviteCode` chega como `Boom{ output.statusCode: 500, message: 'forbidden', data: 403 }` (§1) → `translateEngineError` devolve `ENGINE_TEMPORARILY_UNAVAILABLE` (503) — mensagem errada para o usuário.

Sugestão (sem implementar):

| Peça | Proposta |
|---|---|
| Erro novo | `GroupInviteNotAllowedError(groupJid)` → código `GROUP_INVITE_NOT_ALLOWED`, status **403**, em `MessagingErrors.ts` (ou `GroupErrors.ts` novo se vierem mais erros de grupo) |
| Erro novo (opcional) | `GroupNotFoundError` → `GROUP_NOT_FOUND` 404 (sessão saiu do grupo: WA devolve `404 item-not-found`) |
| Tradutor | `translateGroupInviteError(err)` ao lado de `translateSendError`: se `err` tem `data ∈ {401, 403}` ou `message` contém `forbidden`/`not-authorized` → `GroupInviteNotAllowedError`; `data === 404`/`item-not-found` → `GroupNotFoundError`; senão `translateEngineError` |
| i18n front | chave por código (`GROUP_INVITE_NOT_ALLOWED`: "Só administradores do grupo podem obter o link de convite") |

## Resumo

- `groupInviteCode`/`groupRevokeInvite`/`groupMetadata` existem em `7.0.0-rc14`, assinaturas simples; `size` vem em `groupMetadata`.
- Admin: README só generaliza ("to change group properties you need to be admin"); wiki 404. Tratar como admin-only e confirmar o código de erro em teste real.
- Encaixe: 1 port (`IMessagingEngine.ts`), 1 adapter (único `implements`), fakes parciais não quebram. Cache atual de metadata não serve para contagem (sem TTL, sem `size`).
- Erro: criar `GROUP_INVITE_NOT_ALLOWED` (403) + tradutor específico, pois o Boom do IQ carrega o código WA em `data`, não em `output.statusCode`.
