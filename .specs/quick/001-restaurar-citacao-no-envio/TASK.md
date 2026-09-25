# Quick 001 — Restaurar a citação no envio de texto

**Branch**: `fix/chat-reply-quote` (a partir de `develop`, AGENTS.md §31 — não misturar com a feature de mídia)
**Status**: Implementado (2026-09-25) — ver `SUMMARY.md`; smoke com sessão real pendente
**Pré-requisito de**: `.specs/features/chat-media-attachments` (T19 reusa o builder)

## Problema

"Responder" funciona só no painel. O WhatsApp recebe a mensagem solta, sem citação.

- `dea6c36` (2026-03-21) — `fix(chat): reply entregue no WhatsApp…` montava `{ quoted }` no `sendMessage`
- `b45f4e7` (2026-03-22) — `refactor(baileys): simplifica adapter — remove grupos, midia, avatares e reply`
- Grupos, mídia e avatares voltaram depois; o reply não. Hoje:
  `sendMessage(jid, { text: input.body })` (`BaileysMessagingEngineAdapter.ts:198`), sem opções
- O painel mostra o bloco citado porque grava `quotedMessageId` localmente (`SendMessageUseCase.ts:72`)
  — por isso parece funcionar

## Quick Task

```
Quick Task: fix(baileys): envia a citação ao WhatsApp ao responder
Files:
  api/src/modules/messaging/domain/contracts/IMessagingEngine.ts        (+ participant? em QuotedMessageRef)
  api/src/modules/chat/application/use-cases/resolveConversationTarget.ts (ref leva fromParticipant em grupo)
  api/src/modules/messaging/infrastructure/engines/baileys/buildBaileysQuotedMessage.ts (+ .test.ts) — novo, puro
  api/src/modules/messaging/infrastructure/engines/baileys/BaileysMessagingEngineAdapter.ts (sendTextMessage)
  api/src/modules/chat/application/use-cases/SendMessageUseCase.ts (+ .test.ts) — citada de outra conversa ignorada
  api/package.json, app/package.json (0.11.0 → 0.11.1), CHANGELOG.md (Fixed)
Approach: builder puro monta o WAMessage citado (key + proto mínimo por tipo, como em dea6c36,
  mais participant em grupo — mesmo critério da reação, SetMessageReactionUseCase.ts:84-86);
  sendTextMessage passa { quoted } quando houver ref.
Verify: unit do builder (texto, imagem, vídeo, áudio, documento, grupo com/sem participant,
  fromMe) + smoke: responder no painel → celular do contato mostra a citação (individual e grupo).
```

## Regras

- Proto mínimo por tipo (lição de `dea6c36`: `proto.Message.create` descarta string vazia e o
  Baileys quebra): texto → `conversation: body || ' '`; imagem/vídeo → `caption`; áudio →
  `audioMessage { seconds: 0, ptt: false }`; documento → `documentMessage { title }`
- Grupo: `key.participant` = `fromParticipant` normalizado quando a citada não é nossa; sem
  participante → envia sem citação e loga `warn` (nunca falha o envio por causa da citação)
- Ref ausente/sem `externalId` → envio sem citação, como hoje
- Nenhum tipo do Baileys fora do adapter; reação sem diff de comportamento

## Gate

`cd api && pnpm typecheck && pnpm test` + smoke com sessão real e **banco local**
(`api/.env` aponta para produção).

**Commit**: `fix(baileys): envia a citacao ao WhatsApp ao responder`
