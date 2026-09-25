# Quick 001 — Resumo

**Status**: Implementado na branch `fix/chat-reply-quote` — smoke com sessão real pendente
**Versão**: `0.11.0` → `0.11.1` → `0.11.2` (`api/` e `app/`)

## O que mudou

| Arquivo | Mudança |
| --- | --- |
| `api/.../engines/baileys/buildBaileysQuotedMessage.ts` | Novo, puro. Key com o JID do destino; `participant` normalizado só em grupo e citada de terceiro; conteúdo mínimo nunca vazio por tipo. Pula citação de outra conversa e grupo sem autor |
| `api/.../engines/baileys/BaileysMessagingEngineAdapter.ts` | `sendTextMessage` passa `{ quoted }`; `buildQuoted` nunca lança (sem citação possível → envia sem ela e loga `Reply sent without quote` com o motivo) |
| `api/.../messaging/domain/contracts/IMessagingEngine.ts` | `QuotedMessageRef.participant?` |
| `api/.../use-cases/resolveConversationTarget.ts` | Referência em grupo leva `fromParticipant` quando a citada não é nossa |
| `api/.../use-cases/SendMessageUseCase.ts` | Vínculo só com citada encontrada nesta conversa; citada apagada não vai ao WhatsApp (vínculo no painel mantido) |
| `app/.../components/MessageBubble.tsx` | Mensagem apagada não oferece Responder (botão e menu) |
| `CHANGELOG.md`, `STATE.md` | Entrada `Fixed`; resolvido + lições |

## Verificação

- `api`: `pnpm typecheck` ok; `pnpm test` 209 passando (+45: builder 31, use case 10, referência 4); `pnpm build` ok, teste fora do `dist/`
- `app`: `pnpm typecheck` ok; `pnpm test` 85 passando (+4: `MessageBubble`)
- Revisão: revisor independente sem achados; revisão própria achou citação de apagada (🟡) e vínculo entre conversas (🔵) — corrigidos antes do commit
- Contrato com o Baileys real: o teste do builder passa a saída pelo `generateWAMessage` e confere
  `stanzaId`, `participant` e ausência de `contextInfo.remoteJid` depois de serializar o proto

## Comportamento conferido na lib (sem socket)

| Caso | `contextInfo` |
| --- | --- |
| Individual, citada do contato | `participant` = contato, sem `remoteJid` |
| Citada nossa | `participant` = número da sessão (sem device) |
| Grupo, citada de terceiro | `participant` = autor |
| Grupo **sem** autor (evitado) | `participant` = o próprio grupo — por isso não cita |
| Outra conversa (evitado) | `contextInfo.remoteJid` preenchido — "citação de outro chat" |

## Smoke pendente (sessão real, banco local)

- [ ] Individual: responder texto, foto, áudio, documento → celular mostra a citação e tocar nela leva à mensagem
- [ ] Grupo: responder mensagem de outro participante e mensagem nossa
- [ ] Grupo com participante sem número resolvido (`@lid`): envia sem citação e loga o motivo
- [ ] Figurinha e contato citados renderizam no celular (conteúdo mínimo `stickerMessage {}` / `contactMessage` — INCERTO até ver)
- [ ] Mensagem sem resposta, reação e envio sem sessão: iguais a antes

## Rodada 2 — `0.11.2` (após teste em produção, 2026-09-25)

**Relato**: no grupo "Teste 1", duas respostas a uma imagem **nossa** foram gravadas com o vínculo
certo (consulta somente leitura: `quotedMessageId` preenchido, citada `OUTBOUND`/`IMAGE` com id
externo), mas o outro aparelho não mostrou a citação. Reações funcionam. Foco não ia ao campo.

**Causa provável (a confirmar no teste)**: o Baileys envia em grupo com o **LID** da sessão como
autor (`messages-send.js:544-545`, modo `lid` por padrão), mas monta a citação de mensagem nossa
com o **número** (`Utils/messages.js`, `TODO: Add support for LIDs`). Clientes oficiais citam pelo
LID em grupo ([Baileys #1667](https://github.com/WhiskeySockets/Baileys/issues/1667)).

**Mudanças**: autor LID em grupo LID (sessão e participante via `lidMapping`, com fallback para o
número); citada de mídia com MIME/nome/duração; foco no campo ao responder; log
`Reply quote attached` (autor e tipo citado).

**Teste para fechar o diagnóstico** — cada caso, olhando o outro aparelho e o log da API:

| Caso | Log esperado (`author`) |
| --- | --- |
| Individual, responder mensagem do contato (texto) | `chat` |
| Individual, responder mensagem nossa | `session` |
| Grupo, responder mensagem nossa (texto e imagem) | `lid` |
| Grupo, responder mensagem de outro participante | `lid` (ou `pn`, se o LID não resolver) |

Se o individual funcionar e o grupo não, o problema segue no autor; se nenhum funcionar, está no
envio em si (conferir `Reply quote attached` no log — sem ele, o deploy não tem este código).
