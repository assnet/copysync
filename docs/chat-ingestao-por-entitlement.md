# Ingestão do chat por entitlement (`chat_enabled`)

Status: **implementado atrás de flag desligada** (api 0.74.0, 2026-11-09). Plano:
[`.specs/features/monitoring-queue-isolation/`](../.specs/features/monitoring-queue-isolation/) entrega D.

## Por quê

O chat (`/chat`) só é produto do super admin, mas toda mensagem recebida de todo tenant passava
pela ingestão completa: contato, conversa, mensagem, não lidos, push WS, download de mídia (1:1
sempre). Tenant só de afiliados pagava essa carga no processo dono do socket sem usar o chat.

## Como funciona

- Flag `CHAT_INGEST_ENTITLEMENT_GATE_ENABLED` (default `false` = ingestão de hoje para todos).
- Ligada: cada tenant é avaliado por `IEntitlementReader.getBoolean(tenantId, 'chat_enabled')`.
  Chave ausente = **desligado**. Cache por tenant de 45 s (`CachedChatEntitlementGate`); leitura
  com prazo de 1 s. Falha ou prazo = **último valor conhecido** do tenant; sem valor prévio = chat **ligado** (custo de hoje, nunca perda de dado), guardado
  por 10 s com um warn por tenant por janela (banco lento não é consultado a cada mensagem).
- Chat desligado no tenant:
  - `IngestIncomingMessageUseCase`: 1:1 grava só o `ChatContact` (telefone + `lid`); grupo não grava nada.
  - `IngestHistorySyncUseCase` (`append`): não grava nada.
  - Listeners de status, reação, presença, avatar e estado de conversa retornam cedo.
  - Mídia recebida: `IIncomingMediaPolicy` no adapter (Baileys `notify`/`append`/prévia e Telegram)
    baixa **só imagem de grupo monitorado ao vivo** (`sourceMediaUrl` da captura depende desse
    download). O contexto leva `origin` (`live` = `notify`, `history` = `append`): `history` nunca
    baixa, pois a ingestão descarta o histórico e o `append` não emite `MESSAGE_RECEIVED`.
    1:1, vídeo, áudio, documento e `fromMe` não baixam. Chat ligado: regra atual nas duas origens.
- `MESSAGE_RECEIVED`, monitoramento e disparo de ofertas não mudam. Disparo usa SENT/FAILED do
  retorno do envio; DELIVERED/READ não são gravados sem chat.
- Composição única em `messaging/infrastructure/ingestGate/chatIngestComposition.ts`, usada por
  `server.ts` e por `localEngineContainer` (worker). Não criar uma segunda.
- Eco de mensagem enviada: o `notify` só **espia** a marca (`OutboundEchoRegistry.has`) e pula
  download e bus, com chat ligado ou não — **vale também com a flag `false`** (antes era download
  desperdiçado; o dedup já descartava a mensagem). A marca é **consumida só no `append`**, que pode
  trazer a mesma mensagem depois; consumir no `notify` faria o `append` baixar o binário de volta.

## LID do contato

`MESSAGE_RECEIVED.authorLid` (dígitos) e `chat_contacts.lid` (nullable, índice `tenantId+lid`,
sem backfill). Gravado só no 1:1. Menções e autor de citação consultam o par no banco antes da engine,
com prazo de 500 ms (`withTimeout`): prazo ou erro = miss, segue o caminho de sempre (vale com a flag `false`).
Par LID de participante de grupo mora no Saver ([`saver.md`](saver.md)): ele guarda telefone e LID de cada membro lido
na base de contatos da plataforma, sem tocar `chat_contacts`.

## Gate de produto `CHAT`

Com `PRODUCT_ACCESS_GATE_MODE=enforce`, `chatIngestComposition` usa `ProductAwareChatEntitlementGate`, **com ou sem**
`CHAT_INGEST_ENTITLEMENT_GATE_ENABLED`: tenant com `CHAT` inativo (acompanha a linha `AFFILIATES`) = chat desligado
(mesma regra acima). Com a flag ligada, o gate de produto embrulha o de `chat_enabled`. Fora de `enforce` nada muda.
Rotas `/chat` e WebSocket do chat passam pelo gate HTTP `CHAT` ([`acesso-por-produto.md`](acesso-por-produto.md)).

## Ativação

1. Central publica `chat_enabled=true` para o tenant do super admin e tenants de teste.
2. `CHAT_INGEST_ENTITLEMENT_GATE_ENABLED=true` na Render; reverter = `false` + restart, nada a reprocessar.
3. Super admin vê só o chat do próprio tenant (não há troca de tenant). Para inspecionar um
   cliente, ligar `chat_enabled` nele: o histórico anterior à ativação não existe.

## O que não fazer

- Gate no adapter Baileys ou no bus: o adapter não conhece entitlement; a decisão é da porta.
- Baixar mídia de tenant sem chat "por garantia": é o maior custo que o gate remove.
- Invalidar cache por evento: não há evento entre processos; TTL basta.
- Gravar participante de grupo como contato neste fluxo (é do Saver).
- Consumir a marca de eco no `notify` ou consultar o banco no loop do `notify` sem prazo.
