# Chat — Anexos e mensagem de voz

Enviar documento, foto, vídeo e voz gravada no navegador, em lote, com legenda, arrastar e colar.
Spec, contexto (D1–D8) e design: `.specs/features/chat-media-attachments/`.

## Módulos

- **`media`** (novo, genérico): upload em partes, sniff, classificação, ffmpeg, arquivo.
  Singletons em `media/infrastructure/mediaContainer.ts` — rotas do `media` e do `chat` usam as
  **mesmas** instâncias (o mutex por `uploadId` só serializa com um store só).
- **`chat`**: mensagem, fila, despacho, reenvio, recuperação (`chat/infrastructure/chatMediaContainer.ts`).
  Depende só dos contratos do `media`.
- **Adapter Baileys**: `createOutboundMessageId`, `sendMediaMessage`, registro de eco e cache de
  mídia enviada — ambos **de módulo** (`outboundEchoRegistries.ts`, `sentMediaCache.ts`).

## Fluxo — envio

1. Painel: `mediaPolicy` avisa por tipo/tamanho; `chunkedUpload` cria o upload e sobe partes de
   8 MiB (`PUT` binário). Falha de rede: retry exponencial 1 s → 30 s por até ~3 min, retomando
   pelo `GET` do upload (cobre deploy).
2. Disco: `<uploadId>.bin` (esparso, escrito por posição) + `<uploadId>.json` (lateral, escrita
   atômica) em `MEDIA_UPLOAD_TMP_PATH` — mesmo disco da mídia, **fora** da raiz estática.
3. Confirmação → `SendMediaMessageUseCase`: conversa → `beginConsume` → id externo pré-gerado
   (exige socket aberto; senão 409 e nada é gravado) → sniff + probe → `classifyOutboundMedia` →
   voz: transcodifica → promove para `media/` (`rename`) → grava **`PENDING`** → `finishConsume` →
   fila → **202**. Confirmação repetida → 200 com a mesma mensagem.
4. `InMemoryOutboundMediaQueue`: serial **por conversa** (ordem do lote), até 2 por sessão e 2 no total.
5. `DispatchOutboundMediaUseCase` (tudo em `try/finally` — erro nunca deixa `PENDING`): confere
   `/tmp`, recalcula metadados do arquivo final (vídeo: probe + miniatura; voz: duração + ondas),
   envia com o id gravado e faz `transitionStatus([PENDING] → SENT|FAILED)`.
6. Adapter: recusa acima do `maxContentLengthBytes` da `mediaConn`, registra o id no eco **antes**
   do envio, entrega `{ url: caminho }` (Baileys lê e sobe por stream) e cacheia a mensagem para
   o `getMessage` (pedido de reenvio de criptografia em grupo).
7. WS `chat.message.status.updated` com `SENT`/`FAILED` (`PENDING` nunca é publicado). Recibos
   seguem o fluxo atual (`DELIVERED`/`READ`; `SENT` tardio não sobrescreve `DELIVERED`).
8. Eco `append` (`fromMe`) com id registrado → descartado antes de qualquer download. Mídia
   enviada pelo celular não está no registro e é baixada como antes.

## Classificação (tipo pelo conteúdo)

| Finalidade | Condição | Vira |
|---|---|---|
| `voice` | sniff de áudio/webm/mp4 **e** probe com áudio | nota de voz (Ogg/Opus); senão 415 |
| `media` | JPEG/PNG/WebP ≤ 16 MB | imagem |
| `media` | MP4/3GP H.264 `yuv420p` ≤ 180 MB | vídeo |
| `media` | HEIC, GIF, imagem > limite, MOV/WebM, HEVC/10 bits, vídeo sem probe | documento |
| `document` | qualquer ≤ 180 MB | documento |

O codec só a API conhece: o 202 traz o tipo final e a bolha reflete. Nome no disco:
`${sessionId}_${externalId}.${ext}` pela mesma regra do download (`shared/storage/mediaFileExtension.ts`);
o nome original vai só em `fileName`.

## Voz

- Painel grava com `MediaRecorder` (WebM no Chrome, MP4 no Safari, Ogg no Firefox). A barra
  substitui o composer: descartar, cronômetro, ondas, pausar/retomar, pré-escuta (no Safari é
  INCERTA — desabilita com tooltip) e enviar. No limite, pausa sozinha; < 1 s descarta.
- Trocar de conversa gravando (inclusive arquivamento pelo WS) encerra, libera o microfone e
  guarda **rascunho da conversa**; ao voltar, abre em pré-escuta.
- O gravador vive num provider próprio, fora do `ChatPage`: estado que muda a cada quadro não
  pode re-renderizar a lista de mensagens.
- API: Ogg/Opus mono 48 kHz, `-application voip` (receita do legado2), enviado com `ptt`,
  `seconds` e `waveform` de 64 níveis. Sem ffmpeg/libopus → `capabilities.voiceNotes: false` e o
  microfone fica desabilitado com tooltip.

## Painel

- Bolhas `tmp-<uuid>` com `blob:` ficam no `useOutgoingMedia` e são **sobrepostas** à lista do
  servidor (`overlayOutgoing`): recarregar, buscar ou paginar não as apaga. Status do WS que chega
  antes do 202 fica em `earlyStatusById`.
- Decisão por `error.code`: rede → retoma; `SESSION_NOT_CONNECTED` → só reconfirma;
  `UPLOAD_IN_PROGRESS` → reconfirma a cada 2 s; `UPLOAD_INCOMPLETE` → retoma partes;
  `UPLOAD_NOT_FOUND` → sobe de novo do `File` retido; 413/415/422 → só descartar;
  `FAILED` do servidor → `POST /messages/:id/retry`.
- Reagir e responder ficam bloqueados em `sending`/`failed` (a API também recusa reação: 409).

## HTTP

Todas com auth + tenant. Upload de outro usuário/tenant → 404.

| Método | Rota | Resposta |
|---|---|---|
| GET | `/api/media/uploads/config` | `{ chunkSizeBytes, maxFilesPerBatch, maxVoiceSeconds, maxCaptionLength, limits, capabilities: { voiceNotes, videoMetadata } }` |
| POST | `/api/media/uploads` `{ fileName, sizeBytes, purpose, declaredMimeType? }` | 201 `{ uploadId, chunkSizeBytes, totalParts, receivedParts, expiresAt }` |
| PUT | `/api/media/uploads/:uploadId/parts/:index` (octet-stream) | `{ receivedParts, complete }` |
| GET | `/api/media/uploads/:uploadId` | `{ receivedParts, complete, state, messageId }` |
| DELETE | `/api/media/uploads/:uploadId` | 204 (idempotente) |
| POST | `/api/chat/conversations/:id/messages/media` `{ uploadId, caption?, quotedMessageId? }` | 202 mensagem `PENDING` (200 se repetida) |
| POST | `/api/chat/messages/:messageId/retry` | 202 (só `OUTBOUND` + `FAILED` + arquivo presente; reusa o id) |

`purpose`: `media` \| `document` \| `voice`. Legenda ≤ 4096. 413/400 gerados pelo próprio Fastify
saem como `HTTP_ERROR` — o painel decide pelo status.

| Código | HTTP | Quando |
|---|---|---|
| `MEDIA_TOO_LARGE` | 413 | limite do tipo ou `maxContentLengthBytes` do WhatsApp |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | voz que não é áudio |
| `MEDIA_PROCESSING_FAILED` | 422 | ffmpeg falhou ou estourou tempo |
| `MEDIA_PROCESSOR_UNAVAILABLE` | 503 | voz sem ffmpeg |
| `UPLOAD_NOT_FOUND` | 404 | inexistente, expirado ou de outro dono |
| `UPLOAD_INCOMPLETE` / `UPLOAD_IN_PROGRESS` | 409 | confirmação antes do fim / concorrente |
| `INSUFFICIENT_STORAGE` | 507 | disco sem folga na criação do upload (`/tmp` sem folga no despacho vira `FAILED`) |
| `TOO_MANY_REQUESTS` | 429 | uploads abertos por usuário acima do teto |

## Configuração (`api/src/shared/config/env.ts`)

Todas opcionais. Única obrigatória na Render: `MEDIA_PENDING_RECOVERY_ENABLED=true`.

| Var | Padrão |
|---|---|
| `MEDIA_UPLOAD_TMP_PATH` | `dirname(STORAGE_PATH)/media-uploads` (`/var/data/media-uploads` na Render) |
| `MEDIA_UPLOAD_CHUNK_BYTES` / `MEDIA_UPLOAD_TTL_MINUTES` / `MEDIA_UPLOAD_MAX_OPEN_PER_USER` | 8388608 / 120 / 30 |
| `MEDIA_DISK_RESERVE_BYTES` | relativo ao disco: `max(100 MiB, 10%)` — protege a mídia recebida |
| `MEDIA_UPLOAD_MAX_OPEN_BYTES` | relativo ao disco: `min(2 GB, 50%)` |
| `MEDIA_TMP_RESERVE_BYTES` | 268435456 (folga no `/tmp` além do arquivo) |
| `MEDIA_MAX_IMAGE_BYTES` / `MEDIA_MAX_INLINE_VIDEO_BYTES` / `MEDIA_MAX_DOCUMENT_BYTES` | 16000000 / 180000000 / 180000000 |
| `MEDIA_MAX_VOICE_SECONDS` / `MEDIA_MAX_FILES_PER_BATCH` | 900 / 30 |
| `MEDIA_SEND_CONCURRENCY` / `MEDIA_SEND_PER_SESSION` / `MEDIA_SEND_QUEUE_MAX_PER_SESSION` | 2 / 2 / 100 |
| `MEDIA_PROCESS_CONCURRENCY` | 2 |
| `MEDIA_UPLOAD_IDLE_TIMEOUT_MS` | 60000 (ociosidade do socket, não tempo total) |
| `MEDIA_ECHO_TTL_MS` / `MEDIA_ECHO_MAX_PER_SESSION` | 3600000 / 200 |
| `MEDIA_PENDING_RECOVERY_ENABLED` | `false` — **`true` só na Render** |
| `MEDIA_PENDING_STALE_MINUTES` | 60 |
| `FFMPEG_PATH` / `FFPROBE_PATH` | `ffmpeg` / `ffprobe` |

Os limites de disco relativos vêm do `statfs` a cada criação: aumentar o disco basta.

## ffmpeg

- Binário do sistema. Produção: runtime nativo da Render — ffmpeg/ffprobe **5.1.9** (Debian 12)
  com `libopus`. `api/Dockerfile` instala ffmpeg **só** para o `docker-compose` local.
- `spawn` com array (`shell: false`), `-protocol_whitelist file`, `-format_whitelist`/`-f` com o
  demuxer do sniff, timeout com `SIGKILL` (voz 120 s, probe 15 s, miniatura 20 s, ondas 30 s),
  semáforo `MEDIA_PROCESS_CONCURRENCY`.
- Boot roda `-version`: ausência só desliga capacidades (log `warn`). Sem ffprobe, vídeo vira documento.

## Limites, disco e operação

- **180 MB** (vídeo inline e documento) é o limite confirmado no WhatsApp Web (D5), em decimal.
- Disco da Render: 10 GB desde 2026-09-25 (era 974 MB). Livre abaixo de 2× a reserva → `warn`
  na varredura de uploads (a cada 10 min; apaga o que passou do TTL).
- Recuperação (só com a flag): no boot, todo `PENDING` vira `FAILED` reenviável; a cada 5 min,
  `PENDING` com mais de 60 min fora da fila também. Flag desligada: o boot não escreve no banco.
- Boot reconcilia uploads em `CONSUMING` (só leitura no banco). Shutdown: `drain` de 25 s da
  fila antes do `app.close()`.
- Deploy: migration `PENDING` roda no build; API primeiro, painel depois.

## Logs úteis

| Mensagem | Nível | Sentido |
|---|---|---|
| `Media send started` | info | upload ao WhatsApp começou (`maxBytes` da `mediaConn`) |
| `Media sent` | info | aceito, com `durationMs` |
| `Media above engine upload limit — not sent` | info | acima do `maxContentLengthBytes`; nada subiu |
| `Skipping own media echo` | debug | eco da própria mídia descartado sem download |
| `Reply quote attached` | info | citação anexada (autor e tipo citado) |
| `Media echo registry full — dropped id still within TTL` | warn | teto atingido; o id mais antigo perde a marca e o eco dele seria baixado — subir `MEDIA_ECHO_MAX_PER_SESSION` |

## O que NÃO fazer

- Carregar o arquivo inteiro em `Buffer` na API (upload, envio ou ffmpeg).
- Baixar o eco da mídia própria — descartar pelo registro antes do download.
- Registro de eco ou cache por instância do adapter: há duas no processo (`server.ts` e
  `session.routes.ts`) compartilhando sockets.
- Gravar mídia sem sessão conectada ("gravar sem enviar", como o fallback do texto).
- Confiar no MIME ou no nome vindos do navegador — tipo é magic bytes + probe.
- Shell ou argumento vindo do usuário no ffmpeg.
- Pasta de upload dentro da raiz estática (seria servida; o `@fastify/static` usa `dotfiles: 'allow'`).
- `bodyLimit` na rota de upload: o da rota vence o do parser `octet-stream`.
- Boot escrevendo em massa no banco sem flag: `api/.env` aponta para **produção**.
- `useVoiceRecorder` no `ChatPage`: cada quadro de onda re-renderiza a lista.
- Logar no painel de produção para conferência visual — usar banco local.
