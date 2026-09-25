# Anexos e Mensagem de Voz — Tasks

**Design**: `.specs/features/chat-media-attachments/design.md`
**Status**: Aprovado em 2026-09-25 — em execução
**Branch**: `feature/chat-media-attachments` (a partir de `develop`, AGENTS.md §31)
**Pré-requisito**: `fix/chat-reply-quote` em `develop` — **cumprido** (`2df4dc6`, 0.11.2, smoke aprovado)

---

## Pré-voo (manual, antes da T1 — sem código)

- [x] `fix/chat-reply-quote` mergeado em `develop` e esta branch atualizada a partir dela (2026-09-25)
- [x] Render (runtime nativo — `context.md` D7/D8): `STORAGE_PATH=/var/data/storage`, mesmo
      dispositivo, escrita ok, RAM 2 GiB, Node 26 (2026-09-25)
- [x] Shell da Render: ffmpeg/ffprobe `5.1.9` com `libopus` e demuxers `ogg`, `webm`, `mp4`
- [x] Disco da API aumentado para **10 GB** (2026-09-25; era 974 MB com 287 MB livres — `context.md` D8)
- [ ] **Banco local obrigatório** para T15, T29, T44, T47 e T49: `api/.env` aponta para o banco
      de **produção** com `NODE_ENV=production` (`STATE.md`). Usar `api/.env.dev` + Postgres do
      `docker-compose.yml`. AGENTS.md: nunca alterar dados de produção sem autorização
- [ ] Opcional: `the-fool` sobre a versão revisada do `design.md`

## Gates

| Gate | Comando |
| --- | --- |
| `quick` | `pnpm typecheck && pnpm test` no app tocado (`api/` ou `app/`) |
| `full` | `quick` nos dois + `pnpm prisma:generate` quando o schema mudar |
| `build` | `docker build ./api` (só `docker-compose` local; produção é runtime nativo) |
| `smoke` | T49, com sessão WhatsApp real e banco local |

Testes co-locados, nunca em task separada (`.specs/codebase/TESTING.md`). "Sem remoção" = a
contagem só cresce. Repositórios Prisma, hooks com efeitos e `ChatPage` ficam no smoke. Exceção
justificada: o plugin de upload ganha teste com `fastify.inject` (T15) — isolamento do parser é
o tipo de erro que só aparece em produção (TESTING.md, "Dívida conhecida").

## Skills por task (`.agents/skills/`)

| Skill | Tasks |
| --- | --- |
| `ui-ux-pro-max`, `frontend-design` | T40, T41, T42, T43, T46 |
| `web-design-guidelines` | T41, T42, T46, T47 |
| `copywriting` | T33 |
| `agent-browser` / `playwright-cli` | T44, T47, T49 |
| `caveman-commit` | commit de cada task |

---

## Execution Plan

### Fase 1 — Fundação da API (paralela)

```
T1 → T2
T3 [P]   T4 [P]   T5 [P]   T8 [P]   T9 [P]
T6 [P] → T7
```

### Fase 2 — Upload em partes

```
T5,T8 → T10 ─┬→ T11 (T4,T5,T7) ─┐
             ├→ T12 (T4) ────────┼→ T15 (T13)
             └→ T14              │
T13 [P] ─────────────────────────┘
```

### Fase 3 — Processamento, arquivo e engine

```
T4,T5,T9 → T16
T5,T7    → T17
T5 → T18 → T19 (T4,T17) ─┬→ T20
                         └→ T21
```

### Fase 4 — Envio

```
T22 [P]
T2,T3,T10,T16,T17,T19,T22 → T23 ─┐
T2,T16,T17,T19,T22 → T24 ────────┤
T22 → T25 ───────────────────────┤
T2,T22 → T26 ────────────────────┼→ T29 (T15)
T2,T10,T25 → T27 ────────────────┤
T2 → T28 ────────────────────────┘
T30 [P]
```

### Fase 5 — Painel: base (paralela)

```
T31 ─┬→ T32 → T35
     ├→ T34
     └→ T36
T33 [P]   T37 [P]   T38 [P]
```

### Fase 6 — Painel: anexos

```
T32,T34,T35,T36 → T39 ─┐
T33 → T40 ─────────────┤
T33,T34 → T41 ─────────┼→ T44 (T29)
T33,T36 → T42 ─────────┤
T33,T37 → T43 ─────────┘
```

### Fase 7 — Painel: voz

```
T38 → T45 ─┐
T33,T38 → T46 ┼→ T47 (T44)
```

### Fase 8 — Fechamento

```
T14,T20,T21,T30,T47 → T48 → T49
```

---

## Task Breakdown

### T1: Status `PENDING` + `create` com status opcional

**What**: `PENDING` no enum Prisma e de domínio; `create` aceita `status` (padrão `SENT`); versão da feature.
**Where**: `api/prisma/schema.prisma`, `api/prisma/migrations/<ts>_add_pending_chat_message_status/`, `api/src/modules/chat/domain/enums/ChatMessageEnums.ts`, `IChatMessageRepository.ts`, `PrismaChatMessageRepository.ts`, `PrismaChatMessageMapper.test.ts` (novo), `api/package.json`, `app/package.json`, `CHANGELOG.md`
**Depends on**: None
**Requirement**: MEDIA-09

**Done when**:
- [ ] SQL gerado só com `ALTER TYPE "ChatMessageStatus" ADD VALUE 'PENDING'`; nenhuma migration existente editada
- [ ] `create` grava `data.status ?? 'SENT'` (hoje fixo em `PrismaChatMessageRepository.ts:124`)
- [ ] Enum de domínio com `PENDING`, sem reordenar os demais
- [ ] Teste do mapper: `PENDING`, `SENT` e `null`
- [ ] `pnpm prisma:generate` ok
- [ ] Versão `0.12.0` nos dois `package.json` (minor a partir da `0.11.2` do fix — `context.md` D6) e entrada `Added` iniciada em `[Unreleased]` do CHANGELOG da raiz, citando a migration

**Tests**: unit (mapper) · **Gate**: full
**Commit**: `feat(prisma): adiciona status PENDING em mensagens do chat`

---

### T2: Transição condicional e varredura de pendentes

**What**: `transitionStatus` e `failPending` no contrato e no Prisma.
**Where**: `IChatMessageRepository.ts`, `PrismaChatMessageRepository.ts`
**Depends on**: T1
**Reuses**: `updateStatusByExternalId` (`:131-146`)
**Requirement**: MEDIA-09, MEDIA-19, MEDIA-27

**Done when**:
- [ ] `transitionStatus(id, tenantId, from[], to, sentAt?)`: `updateMany WHERE id, tenantId, status IN from`; entidade só com `count === 1`
- [ ] `failPending({ olderThan, excludeIds })` devolve `{ id, tenantId, conversationId }[]` afetados; comentário explica a ausência de `tenantId` (exceção ao AGENTS.md §36.8, registrada no `STATE.md` pela T48)
- [ ] Nenhum model Prisma sai da infra

**Tests**: none (repositório — smoke) · **Gate**: quick (api)
**Commit**: `feat(chat): adiciona transicao condicional de status de mensagem`

---

### T3: Extrair `buildMessagePreview` [P]

**What**: `buildPreview` vira função pura de domínio.
**Where**: `api/src/modules/chat/domain/services/buildMessagePreview.ts` (+ teste), `IngestIncomingMessageUseCase.ts`
**Depends on**: None
**Requirement**: MEDIA-25

**Done when**:
- [ ] Teste trava cada rótulo atual, o corte em 100 com `…` e o `📎 Mídia`
- [ ] Ingestão só troca a chamada; testes dela sem alteração

**Tests**: unit · **Gate**: quick (api)
**Commit**: `refactor(chat): extrai previa da ultima mensagem para o dominio`

---

### T4: Erros internos de mídia [P]

**What**: 8 erros da design §10, estendendo `AppError`.
**Where**: `api/src/shared/errors/internal/MediaErrors.ts`
**Depends on**: None
**Requirement**: MEDIA-06, MEDIA-22, MEDIA-28

**Done when**:
- [ ] Códigos e status da tabela §10; `errorHandler` sem mudança (lê `statusCode`/`code` de `AppError`)
- [ ] `meta` nunca carrega caminho de disco

**Tests**: none (classes) · **Gate**: quick (api)
**Commit**: `feat(api): adiciona erros internos de midia e upload`

---

### T5: Configuração de mídia e capacidades [P]

**What**: Variáveis da §13, tipo `MediaCapabilities` e montagem do config público.
**Where**: `api/src/shared/config/env.ts`, `api/src/modules/media/domain/services/mediaUploadConfig.ts` (+ teste), `api/.gitignore`, `api/.dockerignore`
**Depends on**: None
**Requirement**: MEDIA-06, MEDIA-07, MEDIA-21

**Done when**:
- [ ] Todas as variáveis com padrão; `MEDIA_UPLOAD_TMP_PATH` = `path.join(path.dirname(STORAGE_PATH), 'media-uploads')`
- [ ] `media-uploads/` no `.gitignore` e no `.dockerignore` da API (em dev cai em `api/media-uploads`)
- [ ] `buildMediaUploadConfig(env, capabilities)` com teste (padrões, `voiceBytes`, capacidades)
- [ ] `diskBudget({ totalBytes, env })` puro com teste: reserva `max(100 MiB, 10%)` e teto `min(2 GB, 50%)` sem env; env sobrepõe; disco de 974 MB → reserva 100 MiB, teto ~487 MB
- [ ] API sobe sem nenhuma variável nova definida

**Tests**: unit · **Gate**: quick (api)
**Commit**: `feat(media): adiciona configuracao de upload e limites`

---

### T6: Sniff por magic bytes [P]

**What**: `sniffMediaType(head)` → `{ mimeType, demuxer }` (tabela §6).
**Where**: `api/src/modules/media/domain/services/sniffMediaType.ts` (+ teste)
**Depends on**: None
**Requirement**: MEDIA-22

**Done when**:
- [ ] Um teste por linha (bytes montados no teste); cabeçalho curto não quebra
- [ ] Sem dependência nova (`file-type` é ESM-only; API é CommonJS)

**Tests**: unit · **Gate**: quick (api)
**Commit**: `feat(media): identifica tipo de arquivo pelo conteudo`

---

### T7: Classificação e nome

**What**: `classifyOutboundMedia` e `sanitizeFileName`.
**Where**: `api/src/modules/media/domain/services/` (+ testes)
**Depends on**: T6
**Requirement**: MEDIA-02, MEDIA-03, MEDIA-04, MEDIA-05, MEDIA-06, MEDIA-22

**Done when**:
- [ ] Um teste por linha da tabela §6, com limites exatos (= passa, +1 rejeita), `yuv420p10le` → documento, vídeo sem probe → documento, acima do inline → documento
- [ ] `sanitizeFileName`: traversal, `C:\`, controle, bidi (U+202E), 300 caracteres, só espaços

**Tests**: unit · **Gate**: quick (api)
**Commit**: `feat(media): classifica anexo por tipo e limite`

---

### T8: Plano de partes [P]

**What**: `planUpload`, `expectedPartLength`, `validatePart`.
**Where**: `api/src/modules/media/domain/services/uploadPlan.ts` (+ teste)
**Depends on**: None
**Requirement**: MEDIA-07

**Done when**:
- [ ] Múltiplo exato, menor que um chunk, 1 byte, 180.000.000 bytes
- [ ] Índice negativo/fracionário/≥ total e tamanho errado → inválidos

**Tests**: unit · **Gate**: quick (api)
**Commit**: `feat(media): calcula e valida partes do upload`

---

### T9: Forma de onda e leitura do probe [P]

**What**: `buildWaveform` e `parseProbeOutput` (com `pix_fmt`).
**Where**: `api/src/modules/media/domain/services/` (+ testes)
**Depends on**: None
**Reuses**: algoritmo de `getAudioWaveform` (Baileys `messages-media.js:196-234`)
**Requirement**: MEDIA-04, MEDIA-12

**Done when**:
- [ ] Onda: 64 valores 0–100; silêncio → zeros; < 64 níveis sem `NaN`
- [ ] Probe: duração arredondada; rotação ±90/270 troca dimensões; `pixelFormat`; sem vídeo → `null`; `hasAudio`; JSON inválido → erro de domínio

**Tests**: unit · **Gate**: quick (api)
**Commit**: `feat(media): gera forma de onda e le metadados do probe`

---

### T10: Store de upload no disco

**What**: `IUploadSessionStore` + `DiskUploadSessionStore` (§5).
**Where**: `api/src/modules/media/domain/contracts/IUploadSessionStore.ts`, `api/src/modules/media/infrastructure/uploads/DiskUploadSessionStore.ts` (+ teste)
**Depends on**: T5, T8
**Requirement**: MEDIA-07, MEDIA-27, MEDIA-28, MEDIA-29

**Done when**:
- [ ] Métodos: `create`, `get`, `writePart`, `beginConsume`, `setExternalId`, `releaseConsume`, `finishConsume`, `discard`, `listByState`, `listExpired(now)`, `countOpenByUser`, `openReservedBytes`, `freeBytes`, `readHead`, `binPath`
- [ ] `.bin` dimensionado com `fileHandle.truncate(size)`; escrita posicional; lateral atômico; mutex por `uploadId`
- [ ] Boot: cria a pasta, testa escrita, compara `stat.dev` com a pasta de mídia (`warn` se diferente)
- [ ] Teste (pasta temporária única): partes fora de ordem; parte repetida; escrita concorrente da mesma parte; nova instância lê o estado; `openReservedBytes` soma só `OPEN`/`CONSUMING`; dono diferente → `null`

**Tests**: unit (disco temporário, parallel-safe) · **Gate**: quick (api)
**Commit**: `feat(media): persiste sessoes de upload em disco`

---

### T11: Criar upload e ler config

**What**: `CreateUploadSessionUseCase` e `GetMediaUploadConfigUseCase`.
**Where**: `api/src/modules/media/application/use-cases/` (+ testes)
**Depends on**: T4, T5, T7, T10
**Requirement**: MEDIA-06, MEDIA-07, MEDIA-21, MEDIA-28

**Done when**:
- [ ] Criação: sanitiza nome; 413 por finalidade; 429 por abertos do usuário; 507 por `livre − reservado − size < reserva` ou soma aberta > teto — reserva e teto de `diskBudget` (T5) sobre o `statfs` atual
- [ ] Config com capacidades recebidas (porta de T5; implementação vem da T16)
- [ ] Testes com dublês (`makeDeps`) para cada rejeição e o caminho feliz

**Tests**: unit · **Gate**: quick (api)
**Commit**: `feat(media): cria sessao de upload com limites e reserva de disco`

---

### T12: Parte, consulta e cancelamento

**What**: `AppendUploadPartUseCase`, `GetUploadSessionUseCase`, `CancelUploadSessionUseCase`.
**Where**: `api/src/modules/media/application/use-cases/` (+ testes)
**Depends on**: T4, T10
**Requirement**: MEDIA-07, MEDIA-18

**Done when**:
- [ ] Parte inválida → `VALIDATION_ERROR`; upload não-`OPEN` recusa parte (409)
- [ ] Consulta devolve `receivedParts`, `complete`, `state`, `messageId`
- [ ] Cancelar idempotente; `CONSUMED` não apaga mensagem nem arquivo promovido
- [ ] Dono diferente → `UPLOAD_NOT_FOUND`

**Tests**: unit · **Gate**: quick (api)
**Commit**: `feat(media): recebe partes, consulta e cancela upload`

---

### T13: Endurecer a rota estática [P]

**What**: `dotfiles: 'deny'`, `allowedPath` normalizado e `Content-Disposition` por allowlist (§12).
**Where**: `api/src/app/app.ts`, `api/src/shared/storage/staticMediaPolicy.ts` (+ teste)
**Depends on**: None
**Requirement**: MEDIA-22

**Done when**:
- [ ] `isAllowedMediaPath(pathName)` puro: normaliza e exige `/media/`; teste com `/media/../x`, `/.uploads/x`, `/media/.x`, `/avatar.jpg`
- [ ] `contentDispositionFor(ext)` puro: inline só na allowlist; `svg`, `html`, `xml` → `attachment`
- [ ] `setHeaders` mantém o CORP atual; `nosniff` conferido (helmet, `app.ts:70`)
- [ ] Mídia antiga e avatares abrem como hoje (conferência manual com arquivo existente)

**Tests**: unit (funções puras) · **Gate**: quick (api)
**Commit**: `fix(api): restringe rota estatica a midia e forca download de tipos ativos`

---

### T14: Limpeza de uploads

**What**: `UploadSessionSweeper` (boot + 10 min) com alerta de espaço.
**Where**: `api/src/modules/media/infrastructure/uploads/UploadSessionSweeper.ts` (+ teste), `api/src/app/server.ts`
**Depends on**: T10
**Requirement**: MEDIA-27

**Done when**:
- [ ] Expirados por `updatedAt`; `.bin` sem lateral; `CONSUMED` só perde o lateral no TTL
- [ ] `warn` quando livre < 2× a reserva de `diskBudget`
- [ ] `setInterval(...).unref()`, parado no shutdown; só disco (nenhum acesso ao banco)
- [ ] Teste com store falso e relógio injetado

**Tests**: unit · **Gate**: quick (api)
**Commit**: `feat(media): limpa uploads abandonados`

---

### T15: Rotas de upload e composição do módulo

**What**: Plugin com as 5 rotas (§10), parser binário encapsulado e `mediaContainer` (singletons).
**Where**: `api/src/modules/media/presentation/routes/media.upload.routes.ts` (+ `.test.ts` com `inject`), `schemas/`, `api/src/modules/media/infrastructure/mediaContainer.ts`, `api/src/app/routes.ts`
**Depends on**: T11, T12, T13
**Requirement**: MEDIA-07, MEDIA-22

**Done when**:
- [ ] Parser só no plugin; **sem `bodyLimit` na rota**
- [ ] Plugin recebe dependências por opção (testável sem banco); `mediaContainer` cria um único store/processador/store de arquivo para o processo
- [ ] Teste `inject`: parte de 8 MiB aceita; parte de chunk + 2 KiB → 413; `POST /api/chat/.../messages` com 2 MiB continua 413 (parser não vazou); `uploadId` inválido → 400
- [ ] `userId` de `request.user`, tenant de `request.tenantContext`
- [ ] Curl com **banco local**: criar, 3 partes fora de ordem, consultar, cancelar

**Tests**: unit (inject) · **Gate**: quick (api)
**Commit**: `feat(media): expoe rotas de upload em partes`

---

### T16: Processador ffmpeg

**What**: `IMediaProcessor` + `FfmpegMediaProcessor` (§7).
**Where**: `api/src/modules/media/domain/contracts/IMediaProcessor.ts`, `api/src/modules/media/infrastructure/ffmpeg/` (`FfmpegMediaProcessor.ts`, `ffmpegArgs.ts` + teste, `runProcess.ts` + teste)
**Depends on**: T4, T5, T9
**Reuses**: receita de voz do legado2 (`whatsapp.baileys.service.ts:3102-3204`)
**Requirement**: MEDIA-04, MEDIA-12, MEDIA-21, MEDIA-22

**Done when**:
- [ ] `ffmpegArgs` gera exatamente os argumentos da §7, sempre com `-protocol_whitelist file -format_whitelist <d> -f <d>`
- [ ] `runProcess`: `spawn` sem shell; timeout → `SIGKILL`; stderr truncado; semáforo
- [ ] Onda lida em stream do stdout
- [ ] `capabilities()` no boot; ausência só `warn`
- [ ] Integração opcional (pulada sem ffmpeg): WebM curto gerado pelo próprio ffmpeg → Ogg com duração
- [ ] Comandos da §7 validados no **ffmpeg 5.1.9** de produção (container `debian:bookworm` com `apt install ffmpeg`, ou no Shell da Render com arquivo gerado na hora), não só no 8.x local — incluindo `-format_whitelist` e `stream_side_data` do ffprobe

**Tests**: unit (args + runner com `spawn` falso) · **Gate**: quick (api)
**Commit**: `feat(media): processa voz, probe e miniatura com ffmpeg`

---

### T17: Store de arquivo e extensão compartilhada

**What**: `IMediaFileStore` + `LocalMediaFileStore`; `mimeTypeToExt` sai do adapter para `shared/storage`.
**Where**: `api/src/modules/media/domain/contracts/IMediaFileStore.ts`, `api/src/modules/media/infrastructure/storage/LocalMediaFileStore.ts` (+ teste), `api/src/shared/storage/mediaFileExtension.ts` (+ teste), `BaileysMessagingEngineAdapter.ts` (só import)
**Depends on**: T5, T7
**Requirement**: MEDIA-10, MEDIA-22

**Done when**:
- [ ] Teste trava o mapa atual (`adapter:1294-1311`) e acrescenta Office, zip, png, webp, gif, pdf, 3gp, `octet-stream → bin`; nenhuma saída atual muda
- [ ] Adapter importa a função; download sem diff de comportamento
- [ ] `promote(src, sessionId, externalId, mime)` → `{ publicUrl, localPath, sizeBytes }` por `rename`; `EXDEV` → cópia por stream + unlink
- [ ] `resolveLocalPath(mediaUrl)` só aceita prefixo público + `basename` limpo; traversal → `null`
- [ ] `remove` idempotente; teste em pasta temporária

**Tests**: unit · **Gate**: quick (api)
**Commit**: `feat(media): promove arquivo enviado com a mesma regra de nome do download`

---

### T18: Registros de eco de módulo

**What**: `OutboundEchoRegistry` genérico + `outboundEchoRegistries()` de módulo (reação e mídia).
**Where**: `api/src/modules/messaging/infrastructure/engines/baileys/OutboundEchoRegistry.ts` (+ teste), `ReactionEchoRegistry.ts` (reexporta), `outboundEchoRegistries.ts`, `BaileysMessagingEngineAdapter.ts`
**Depends on**: T5
**Requirement**: MEDIA-10

**Done when**:
- [ ] `ReactionEchoRegistry.test.ts` passa **sem alteração** (import pelo arquivo antigo)
- [ ] Adapter usa o registro de módulo no lugar de `this.reactionEchoes` (`adapter:99`) — corrige o eco de reação com bootstrap ligado
- [ ] Teste: duas chamadas a `outboundEchoRegistries()` devolvem as mesmas instâncias; registro de mídia com `MEDIA_ECHO_TTL_MS`/`MEDIA_ECHO_MAX_PER_SESSION`

**Tests**: unit · **Gate**: quick (api)
**Commit**: `fix(baileys): compartilha registro de eco entre instancias do adapter`

---

### T19: Porta de mídia v2 e envio no adapter

**What**: Contrato novo (§9), `buildBaileysMediaContent`, `createOutboundMessageId` e `sendMediaMessage`.
**Where**: `IMessagingEngine.ts`, `.../baileys/buildBaileysMediaContent.ts` (+ teste), `BaileysMessagingEngineAdapter.ts`, `BaileysErrorTranslator.ts`
**Depends on**: T4, T17, T18
**Reuses**: pré-condições e id pré-gerado de `sendReaction` (`adapter:222-262`)
**Requirement**: MEDIA-02, MEDIA-03, MEDIA-04, MEDIA-12

**Done when**:
- [ ] `grep` confirma que `MediaType`/`SendMediaMessageInput` antigos só aparecem em `IMessagingEngine.ts:82-91` e `adapter:31`
- [ ] Builder: teste por `kind`; `ptt` no topo; documento sempre com `mimetype` e `fileName`; vazios omitidos
- [ ] Limite da `mediaConn` com `Number.isFinite`; excedido → `MediaTooLargeError` sem subir; valor em `info`
- [ ] Eco registrado no registro de módulo **antes** do `sendMessage`; `mediaUploadTimeoutMs` do env
- [ ] `quoted` pelo helper `buildQuoted` do adapter (o mesmo do texto: autor LID em grupo, fallback e log) — nunca o builder direto; smoke confere o log `Reply quote attached` numa resposta com anexo em grupo
- [ ] Nenhum tipo do Baileys sai do adapter

**Tests**: unit (builder) · **Gate**: quick (api)
**Commit**: `feat(baileys): envia midia por arquivo com metadados e id pre-gerado`

---

### T20: Ignorar eco da mídia própria

**What**: Pular no `append` o item `fromMe` registrado.
**Where**: `BaileysMessagingEngineAdapter.ts` (`mapMessagesToHistoryItems`), `isOwnOutboundEcho.ts` (+ teste)
**Depends on**: T19
**Requirement**: MEDIA-10

**Done when**:
- [ ] Checagem logo após ler `key` (`adapter:912`), antes do filtro de LID/broadcast
- [ ] Predicado testado: `fromMe` registrado → pula (e consome); `fromMe` do celular → segue; recebido → segue; sem `id` → segue
- [ ] Log `debug` ao pular

**Tests**: unit (predicado) · **Gate**: quick (api)
**Commit**: `fix(baileys): nao baixa de volta a midia enviada pelo painel`

---

### T21: Cache de mídia enviada para `getMessage`

**What**: `sentMediaCache()` de módulo e `getMessage` do socket consultando-o.
**Where**: `.../baileys/sentMediaCache.ts` (+ teste), `BaileysMessagingEngineAdapter.ts` (`openSocket`, `sendMediaMessage`)
**Depends on**: T19
**Requirement**: MEDIA-02, MEDIA-03, MEDIA-04, MEDIA-12

**Done when**:
- [ ] Guarda `result.message` por (sessão, id) com TTL e teto (mesmos do eco)
- [ ] `getMessage` devolve do cache ou `undefined` (texto e reação sem mudança)
- [ ] Teste: TTL, teto, sessão diferente não vaza

**Tests**: unit · **Gate**: quick (api)
**Commit**: `feat(baileys): responde pedido de reenvio da midia enviada`

---

### T22: Portas de fila e de publicação [P]

**What**: `IOutboundMediaQueue` (`enqueue`, `inFlightIds`, `drain`) e `IMessageStatusPublisher`.
**Where**: `api/src/modules/chat/application/contracts/`
**Depends on**: None
**Reuses**: `IReactionUpdatePublisher.ts`
**Requirement**: MEDIA-09

**Done when**:
- [ ] Job `{ messageId, tenantId, sessionId, conversationId }`
- [ ] Comentário: use case não conhece WS nem memória

**Tests**: none (tipos) · **Gate**: quick (api)
**Commit**: `feat(chat): define portas de fila de midia e publicacao de status`

---

### T23: `SendMediaMessageUseCase`

**What**: Os 11 passos da §8, na ordem.
**Where**: `api/src/modules/chat/application/use-cases/SendMediaMessageUseCase.ts` (+ teste)
**Depends on**: T2, T3, T10, T16, T17, T19, T22
**Requirement**: MEDIA-02, MEDIA-03, MEDIA-04, MEDIA-05, MEDIA-06, MEDIA-09, MEDIA-20, MEDIA-24, MEDIA-25, MEDIA-29

**Done when**:
- [ ] `CONSUMED` → mesma mensagem, sem gravar nem enfileirar
- [ ] Sessão desconectada → erro antes de gravar; upload volta a `OPEN`
- [ ] Id externo gravado no lateral antes da promoção
- [ ] Classificação rejeitada → `releaseConsume` + erro; nada gravado
- [ ] Voz: `audio/ogg; codecs=opus` com duração; sem ffmpeg → `MEDIA_PROCESSOR_UNAVAILABLE`
- [ ] Vídeo HEVC ou > inline → `DOCUMENT`
- [ ] Falha ao gravar → arquivo promovido removido
- [ ] Fila recusa → `FAILED` e resposta com esse status
- [ ] `quotedMessageId` persistido; prévia = legenda ou rótulo
- [ ] Sem import de Prisma, Fastify, Baileys ou `fs`

**Tests**: unit · **Gate**: quick (api)
**Commit**: `feat(chat): grava e enfileira envio de midia`

---

### T24: `DispatchOutboundMediaUseCase`

**What**: Envio da mensagem `PENDING` com `try/finally` (§8).
**Where**: `.../use-cases/DispatchOutboundMediaUseCase.ts` (+ teste)
**Depends on**: T2, T16, T17, T19, T22
**Requirement**: MEDIA-04, MEDIA-09, MEDIA-12

**Done when**:
- [ ] Não-`PENDING` → nada
- [ ] Sucesso → `SENT` e publica; transição `null` (DELIVERED antes) → não publica
- [ ] Exceção em **qualquer** passo antes do envio (probe, `/tmp`, arquivo ausente, bug) → `FAILED` + publica
- [ ] `/tmp` sem folga → `FAILED` sem chamar a engine
- [ ] Vídeo com `seconds/width/height/thumbnail`; voz com `seconds/waveform`; grupo `@g.us`
- [ ] Usa o `externalMessageId` gravado

**Tests**: unit · **Gate**: quick (api)
**Commit**: `feat(chat): despacha midia pendente para a engine`

---

### T25: Fila em memória

**What**: `InMemoryOutboundMediaQueue` (serial por conversa, 2 por sessão, 2 global, teto, drain).
**Where**: `api/src/modules/chat/infrastructure/queue/InMemoryOutboundMediaQueue.ts` (+ teste)
**Depends on**: T22
**Requirement**: MEDIA-09, MEDIA-15

**Done when**:
- [ ] Mesma conversa: nunca dois juntos, ordem mantida
- [ ] Mesma sessão, conversas diferentes: até 2 em paralelo; global até 2
- [ ] Teto por sessão → `false`; job que lança não trava
- [ ] `inFlightIds()`; `drain(ms)` recusa novos e resolve quando acabam ou no tempo

**Tests**: unit (timers falsos) · **Gate**: quick (api)
**Commit**: `feat(chat): adiciona fila de envio de midia por conversa`

---

### T26: Reenviar mídia com falha

**What**: `RetryOutboundMediaUseCase`.
**Where**: `.../use-cases/RetryOutboundMediaUseCase.ts` (+ teste)
**Depends on**: T2, T22
**Requirement**: MEDIA-19

**Done when**:
- [ ] Só `OUTBOUND` + `FAILED` + mídia com arquivo; demais → `CONFLICT`
- [ ] Sessão desconectada → erro sem mudar status
- [ ] `FAILED → PENDING` + enfileira com o mesmo id; fila recusa → volta a `FAILED`
- [ ] Dois retries simultâneos → um enfileira

**Tests**: unit · **Gate**: quick (api)
**Commit**: `feat(chat): permite reenviar midia com falha`

---

### T27: Recuperação e reconciliação

**What**: `FailOrphanPendingMediaUseCase` (boot + varredura, atrás de flag) e `ReconcileInterruptedUploadsUseCase` (boot).
**Where**: `.../use-cases/` (+ testes), `api/src/app/server.ts`
**Depends on**: T2, T10, T25
**Requirement**: MEDIA-27

**Done when**:
- [ ] `MEDIA_PENDING_RECOVERY_ENABLED=false` → nenhuma escrita no banco (teste)
- [ ] Ligada: boot falha todos os `PENDING`; varredura de 5 min falha os mais velhos que o limite fora de `inFlightIds()` e publica
- [ ] Reconciliação: `CONSUMING` com mensagem existente → `CONSUMED`; sem mensagem → apaga órfão e descarta (só leitura no banco)
- [ ] Falha aqui não derruba o boot

**Tests**: unit · **Gate**: quick (api)
**Commit**: `feat(chat): recupera midia pendente e uploads interrompidos`

---

### T28: Reação bloqueada em mensagem não entregue

**What**: `SetMessageReactionUseCase` recusa `PENDING`/`FAILED`.
**Where**: `SetMessageReactionUseCase.ts` (+ teste existente ampliado)
**Depends on**: T2
**Requirement**: MEDIA-30

**Done when**:
- [ ] `ConflictError` antes de qualquer chamada à engine, ao lado da checagem de `externalMessageId` (`:73`)
- [ ] Testes atuais sem alteração + 2 novos

**Tests**: unit · **Gate**: quick (api)
**Commit**: `fix(chat): recusa reacao em mensagem ainda nao entregue`

---

### T29: Rotas de envio, ligação e shutdown

**What**: `POST .../messages/media`, `POST /messages/:id/retry`, publisher, fila, drain.
**Where**: `chat.routes.ts`, `chat.schema.ts`, `api/src/app/server.ts`
**Depends on**: T15, T23, T24, T25, T26, T27, T28
**Reuses**: wiring de `chat.routes.ts:70-77`; `mediaContainer` (T15)
**Requirement**: MEDIA-09, MEDIA-19, MEDIA-29

**Done when**:
- [ ] 202 no novo, 200 no repetido; `ChatPresenter` sem campo novo
- [ ] Mesmos singletons da T15 (um store de upload no processo)
- [ ] `SIGTERM`/`SIGINT`: `queue.drain(25_000)` antes de `app.close()`
- [ ] Rota de texto sem diff (`:200-213`)
- [ ] Curl com **banco local**: upload → envio → WS `SENT`; repetir confirmação → 200 mesma mensagem

**Tests**: none (rota — smoke) · **Gate**: full
**Commit**: `feat(chat): expoe envio e reenvio de midia`

---

### T30: ffmpeg na imagem [P]

**What**: `apk add --no-cache openssl ffmpeg` (só `docker-compose` local — produção é nativa) e log de capacidades no boot.
**Where**: `api/Dockerfile`, `api/src/app/server.ts`
**Depends on**: None
**Requirement**: MEDIA-21

**Done when**:
- [ ] `docker build` ok; `ffmpeg -version` e `ffprobe -version` no container
- [ ] Boot loga `{ transcodeVoice, probe }`

**Tests**: none · **Gate**: build
**Commit**: `build(api): instala ffmpeg na imagem`

---

### T31: Tipos do painel e status `PENDING`

**What**: `PENDING → 'sending'`, campo `upload` e DTOs de upload.
**Where**: `app/src/types/chat.api.types.ts`, `app/src/features/chat/types.ts`, `app/src/types/media.api.types.ts` (+ teste de `apiMessageToFrontend`)
**Depends on**: None
**Requirement**: MEDIA-09

**Done when**:
- [ ] `PENDING → 'sending'`; desconhecido continua `'sent'`
- [ ] `upload?` só no front

**Tests**: unit · **Gate**: quick (app)
**Commit**: `feat(app): reconhece status pendente de mensagem`

---

### T32: Serviços HTTP de mídia

**What**: `media.service.ts` e `sendMediaMessage`/`retryMessage`.
**Where**: `app/src/services/`
**Depends on**: T31
**Requirement**: MEDIA-07, MEDIA-19

**Done when**:
- [ ] `putPart` com `Content-Type: application/octet-stream`, `signal`, `onUploadProgress`, `timeout` 120 s — tudo por chamada; instância inalterada
- [ ] Nenhuma chamada Axios fora de `services/`

**Tests**: none (wrapper HTTP) · **Gate**: quick (app)
**Commit**: `feat(app): adiciona servicos de upload e envio de midia`

---

### T33: Textos da feature [P]

**What**: Grupos `composer`, `attachments`, `voice`, `upload`; literais do composer migrados.
**Where**: `app/src/features/chat/strings.ts`, `MessageComposer.tsx` (só literais)
**Depends on**: None
**Requirement**: MEDIA-23

**Done when**:
- [ ] Todos os textos da §14 (tooltips, `aria-label`, avisos, erros, rascunho de voz)
- [ ] Frases com variável como função; sem nome de app; revisão com `copywriting`

**Tests**: none (dados) · **Gate**: quick (app)
**Commit**: `feat(app): centraliza textos de anexos e voz`

---

### T34: Política de anexos no painel

**What**: `mediaPolicy.ts` (tipo e tamanho; codec fica com a API).
**Where**: `app/src/features/chat/media/mediaPolicy.ts` (+ teste)
**Depends on**: T31
**Requirement**: MEDIA-05, MEDIA-06

**Done when**:
- [ ] Mesmos limites e conversões da T7 que não dependem de probe
- [ ] Origem `media | document | auto`

**Tests**: unit · **Gate**: quick (app)
**Commit**: `feat(app): classifica anexos antes do upload`

---

### T35: Upload em partes no painel

**What**: `chunkedUpload.ts` com cliente injetado.
**Where**: `app/src/features/chat/media/chunkedUpload.ts` (+ teste)
**Depends on**: T32
**Requirement**: MEDIA-07, MEDIA-18

**Done when**:
- [ ] Progresso monotônico
- [ ] Rede (sem `status`) e 5xx → exponencial 1 s → 30 s até ~3 min; 4xx → para; decisão por `status`, não por `code`
- [ ] Retomada via `GET` pula partes recebidas
- [ ] Aborto por `signal.aborted` → cancela sem retry

**Tests**: unit (timers falsos) · **Gate**: quick (app)
**Commit**: `feat(app): envia arquivo em partes com retomada`

---

### T36: Estado das bolhas em envio

**What**: `outgoingMediaState.ts`: redutor, `overlayOutgoing`, `earlyStatusById` e decisões por `error.code` (§14).
**Where**: `app/src/features/chat/media/outgoingMediaState.ts` (+ teste)
**Depends on**: T31
**Requirement**: MEDIA-08, MEDIA-18, MEDIA-19

**Done when**:
- [ ] Um teste por linha da tabela §14
- [ ] Sobreposição: lista do servidor substituída (busca, reabertura, página) mantém as bolhas em envio; não duplica quando o id real já está na lista
- [ ] WS antes do 202 → status aplicado na troca
- [ ] Devolve `blob:` a revogar (efeito no hook)

**Tests**: unit · **Gate**: quick (app)
**Commit**: `feat(app): modela estado das mensagens de midia em envio`

---

### T37: Arquivos de arrastar e colar [P]

**What**: `dataTransferFiles.ts`.
**Where**: `app/src/features/chat/media/dataTransferFiles.ts` (+ teste)
**Depends on**: None
**Requirement**: MEDIA-16, MEDIA-17

**Done when**:
- [ ] `hasFiles(dt)` pelo `types`; `filesFrom(dt)` ignora diretórios e não-arquivos; colar texto → vazio

**Tests**: unit · **Gate**: quick (app)
**Commit**: `feat(app): extrai arquivos de arrastar e colar`

---

### T38: Mime do gravador e máquina de estados [P]

**What**: `pickRecorderMimeType.ts` e `voiceRecorderMachine.ts` (com rascunho).
**Where**: `app/src/features/chat/media/` (+ testes)
**Depends on**: None
**Requirement**: MEDIA-11, MEDIA-13, MEDIA-14, MEDIA-31

**Done when**:
- [ ] Mime: ogg → webm → mp4 → `''`
- [ ] `idle → requesting → recording ⇄ paused → sending | idle`; `recording|paused → draft` ao sair da conversa; `draft → sending | idle`; tempo exclui pausas; máximo → `paused`; < 1 s → descarte com aviso
- [ ] Um teste por transição e por erro de microfone

**Tests**: unit · **Gate**: quick (app)
**Commit**: `feat(app): modela gravacao de voz`

---

### T39: Hooks de config e envio

**What**: `useMediaUploadConfig` e `useOutgoingMedia`.
**Where**: `app/src/features/chat/media/`
**Depends on**: T32, T34, T35, T36
**Requirement**: MEDIA-07, MEDIA-08, MEDIA-15, MEDIA-19, MEDIA-26

**Done when**:
- [ ] Lote em sequência; uploads seguem ao trocar de conversa (hook no `ChatPage`)
- [ ] `IN_PROGRESS` reconfirma; `NOT_FOUND` sobe de novo do `File`; `INCOMPLETE` retoma
- [ ] `beforeunload` só com upload ativo
- [ ] Falha do config → anexos e microfone desabilitados com tooltip

**Tests**: none (hook — lógica em T34–T36) · **Gate**: quick (app)
**Commit**: `feat(app): orquestra upload e envio de midia`

---

### T40: Menu de anexo

**What**: `AttachmentMenu` ("Documento" / "Fotos e vídeos").
**Where**: `app/src/features/chat/components/AttachmentMenu.tsx` (+ teste)
**Depends on**: T33
**Requirement**: MEDIA-01, MEDIA-23

**Done when**:
- [ ] `multiple`; `accept="image/*,video/*"` em mídia; input limpo após seleção
- [ ] Teste: abre, escolhe, dispara `onFiles(files, origin)`; asserção no escuro

**Tests**: unit · **Gate**: quick (app)
**Commit**: `feat(app): adiciona menu de anexo`

---

### T41: Prévia do lote

**What**: `AttachmentPreviewPanel` (§14).
**Where**: `app/src/features/chat/components/AttachmentPreviewPanel.tsx` (+ teste)
**Depends on**: T33, T34
**Requirement**: MEDIA-05, MEDIA-06, MEDIA-15, MEDIA-24

**Done when**:
- [ ] Miniaturas de 96 px via `createImageBitmap`; só o item atual cheio; `<video>` só no atual (teste com mock)
- [ ] Legenda por item preservada ao alternar; item bloqueado desabilita enviar
- [ ] Aviso de documento; Enter/Shift+Enter/Esc; foco inicial e devolvido; asserção no escuro
- [ ] `blob:` revogados ao desmontar

**Tests**: unit · **Gate**: quick (app)
**Commit**: `feat(app): adiciona previa de anexos com legenda`

---

### T42: Progresso, falha e reação na bolha

**What**: `UploadProgressOverlay`, `FailedMessageActions`, integração na `MessageBubble` e `canReact`.
**Where**: `app/src/features/chat/components/messages/`, `MessageBubble.tsx`
**Depends on**: T33, T36
**Requirement**: MEDIA-08, MEDIA-18, MEDIA-19, MEDIA-30

**Done when**:
- [ ] Percentual + cancelar em upload; indeterminado em `confirming`/`PENDING`
- [ ] "Tentar de novo" conforme o erro; "Descartar" só local
- [ ] `canReact` falso em `sending`/`failed`
- [ ] Bolha sem `upload` e sem falha renderiza igual a hoje; testes com asserção no escuro

**Tests**: unit · **Gate**: quick (app)
**Commit**: `feat(app): mostra progresso e reenvio na bolha de midia`

---

### T43: Área de soltar

**What**: `DropZoneOverlay`.
**Where**: `app/src/features/chat/components/DropZoneOverlay.tsx` (+ teste)
**Depends on**: T33, T37
**Requirement**: MEDIA-16

**Done when**:
- [ ] Aparece com arquivos, some ao sair (contador), ignora texto; `prefers-reduced-motion`; escuro

**Tests**: unit · **Gate**: quick (app)
**Commit**: `feat(app): adiciona area para soltar arquivos na conversa`

---

### T44: Integrar anexos no chat

**What**: Clipe, colar, prévia, soltar, sobreposição e `handleLoadMore` funcional.
**Where**: `MessageComposer.tsx`, `ChatWindow.tsx`, `ChatPage.tsx`
**Depends on**: T29, T39, T40, T41, T42, T43
**Requirement**: MEDIA-01, MEDIA-15, MEDIA-16, MEDIA-17, MEDIA-20, MEDIA-24, MEDIA-25

**Done when**:
- [ ] Lista renderizada = `overlayOutgoing(servidor, envio)`
- [ ] `handleLoadMore` com `setMessages` funcional (dívida do `STATE.md` resolvida)
- [ ] Conversa encerrada desabilita clipe, colar e soltar; resposta vai no 1º item
- [ ] `lastMessage` via `formatLastMessagePreview`
- [ ] Composer de texto igual (Enter, Shift+Enter, resposta, emoji desabilitado)
- [ ] Smoke `agent-browser` com banco local: documento, 3 fotos, colar print, soltar vídeo; buscar mensagem durante upload; três temas

**Tests**: none (página — smoke) · **Gate**: full
**Commit**: `feat(chat): habilita envio de anexos no painel`

---

### T45: Hook do gravador

**What**: `useVoiceRecorder` sobre a máquina da T38.
**Where**: `app/src/features/chat/media/useVoiceRecorder.ts`
**Depends on**: T38
**Requirement**: MEDIA-11, MEDIA-13, MEDIA-14, MEDIA-31

**Done when**:
- [ ] `AudioContext.resume()` após criar
- [ ] Limpeza completa em enviar, descartar, rascunho e desmontar
- [ ] Ondas sem re-render por quadro fora da barra
- [ ] Pré-escuta com `requestData()`; erro → `previewUnsupported`

**Tests**: none (APIs do navegador — lógica em T38) · **Gate**: quick (app)
**Commit**: `feat(app): grava voz no navegador`

---

### T46: Barra de gravação

**What**: `VoiceRecorderBar`.
**Where**: `app/src/features/chat/components/VoiceRecorderBar.tsx` (+ teste)
**Depends on**: T33, T38
**Requirement**: MEDIA-11, MEDIA-13, MEDIA-14, MEDIA-23, MEDIA-31

**Done when**:
- [ ] Teste por estado (gravando, pausado, rascunho, pré-escuta indisponível, enviando)
- [ ] Cronômetro `role="status"`; ondas `aria-hidden`; tooltips e `aria-label`; escuro; `prefers-reduced-motion`

**Tests**: unit · **Gate**: quick (app)
**Commit**: `feat(app): adiciona barra de gravacao de voz`

---

### T47: Integrar voz no chat

**What**: Microfone, barra no lugar do composer, rascunho por conversa.
**Where**: `MessageComposer.tsx`, `ChatWindow.tsx`, `ChatPage.tsx`
**Depends on**: T44, T45, T46
**Requirement**: MEDIA-11, MEDIA-12, MEDIA-14, MEDIA-21, MEDIA-31

**Done when**:
- [ ] Microfone só com campo vazio; `voiceNotes: false` → desabilitado com tooltip
- [ ] Trocar/desselecionar (inclusive arquivamento pelo WS, `ChatPage.tsx:416-418`) vira rascunho e libera o microfone; voltar abre o rascunho
- [ ] Erros em snackbar com texto específico
- [ ] Smoke Chrome, Firefox, Safari: indicador do microfone apaga após enviar/descartar/trocar

**Tests**: none (página — smoke) · **Gate**: full
**Commit**: `feat(chat): habilita mensagem de voz no painel`

---

### T48: Documentação, versão e memória

**What**: Doc, AGENTS.md, STATE.md, CHANGELOG, versão.
**Where**: `docs/chat-midias-anexos.md`, `AGENTS.md`, `.specs/project/STATE.md`, `CHANGELOG.md`, `api/package.json`, `app/package.json`
**Depends on**: T14, T20, T21, T30, T47
**Requirement**: Todos

**Done when**:
- [ ] Doc: fluxo, contratos, env, ffmpeg, Render (flag de recuperação), e o que **não** fazer (Buffer, baixar eco, registro por instância, gravar sem enviar, confiar no MIME do navegador, shell no ffmpeg, pasta de upload dentro da raiz estática, boot escrevendo no banco sem flag)
- [ ] AGENTS.md: §13 com erros de mídia; regras "upload só por `chunkedUpload`" e "mídia do painel persiste `PENDING` antes do envio"
- [ ] STATE.md: decisões; dívidas (citação ignorada — D4; envio sem tempo real para outros operadores; download recebido em Buffer; disco local; `failPending` sem `tenantId`); resolvidos (eco de reação entre instâncias; `handleLoadMore`)
- [ ] CHANGELOG `[Unreleased]` com arquivos e migration
- [ ] Versão `0.12.0` conferida nos dois `package.json` (subida na T1); qualquer ajuste após o merge sobe patch

**Tests**: none · **Gate**: quick
**Commit**: `docs(chat): documenta anexos e mensagem de voz`

---

### T49: Smoke

**What**: Roteiro ponta a ponta, sessão real, **banco local**, aparelhos reais.
**Where**: — (evidência no merge)
**Depends on**: T48
**Requirement**: Success Criteria da spec

**Done when**:
- [ ] Documentos: PDF 5 MB, DOCX, ZIP, 170 MB — nome e legenda no celular
- [ ] Imagens: JPEG, PNG, WebP como imagem; HEIC, GIF, PNG 20 MB como documento
- [ ] Vídeo inline: MP4 H.264 de ~180 MB (limite confirmado no WhatsApp Web — D5) tocando no Android e iOS; MOV e HEVC como documento; `maxContentLengthBytes` anotado
- [ ] Citação: documento, foto, vídeo e voz enviados como resposta chegam citados no celular (individual e grupo)
- [ ] Voz: Chrome, Edge, Firefox, Safari → Android, iOS, Web, Desktop, com ondas e duração; pausar/ouvir/retomar; máximo (env reduzido); < 1 s; microfone negado; rascunho ao trocar
- [ ] Lote: 5 fotos em ordem; soltar misto; colar print; colar texto
- [ ] Rede: cortar em 100 MB e retomar; cancelar; fechar aba; trocar de conversa; buscar durante upload
- [ ] Falhas: sessão desconectada → reenvio após reconectar; reiniciar API com fila e flag ligada → `FAILED` → reenviar; **deploy durante upload** retoma
- [ ] Corridas: DELIVERED antes de SENT mantém DELIVERED; confirmação repetida → mesma mensagem
- [ ] Eco: log sem download da mídia própria, com bootstrap ligado e desligado; RSS em 180 MB ≤ repouso + 50 MB
- [ ] Grupo: um de cada tipo; sem "Aguardando esta mensagem"
- [ ] Regressão: texto, resposta, reações (e bloqueio em pendente), mídia recebida, avatares, mídia antiga; `.uploads`/`../` bloqueados
- [ ] Três temas (`agent-browser`)

**Tests**: smoke · **Gate**: smoke

---

## Validação pré-aprovação

### Granularidade

| Task | Escopo | Status |
| --- | --- | --- |
| T1 | enum + opção do `create` + teste do mapper | ⚠️ coeso |
| T2 | 2 métodos do mesmo repositório | ✅ |
| T3–T9 | 1 função pura (ou par coeso) | ✅ |
| T10 | 1 store | ✅ |
| T11, T12 | 2–3 use cases do mesmo recurso | ⚠️ coeso |
| T13 | 2 funções puras + registro da estática | ✅ |
| T14 | 1 componente | ✅ |
| T15 | plugin + composição (store único exige nascer junto) | ⚠️ coeso |
| T16 | 1 processador + 2 helpers | ⚠️ coeso |
| T17 | store + extração da regra de nome que ele usa | ⚠️ coeso |
| T18–T22 | 1 componente/contrato | ✅ |
| T19 | porta + builder + adapter (separar deixaria o build vermelho) | ⚠️ coeso |
| T23–T28 | 1 use case/fila (T27: 2 use cases de boot) | ✅/⚠️ |
| T29 | ligação | ✅ |
| T30–T38 | 1 arquivo/função | ✅ |
| T39 | 2 hooks do mesmo fluxo | ⚠️ coeso |
| T40–T43, T45, T46 | 1 componente/hook | ✅ |
| T44, T47 | integração | ✅ |
| T48, T49 | fechamento | ✅ |

### Diagrama × definição

| Task | Depends on (corpo) | Diagrama | Status |
| --- | --- | --- | --- |
| T1 | — | início Fase 1 | ✅ |
| T2 | T1 | T1 → T2 | ✅ |
| T3, T4, T5, T6, T8, T9 | — | [P] | ✅ |
| T7 | T6 | T6 → T7 | ✅ |
| T10 | T5, T8 | T5,T8 → T10 | ✅ |
| T11 | T4, T5, T7, T10 | T10 → T11 (T4,T5,T7) | ✅ |
| T12 | T4, T10 | T10 → T12 (T4) | ✅ |
| T13 | — | [P] Fase 2 | ✅ |
| T14 | T10 | T10 → T14 | ✅ |
| T15 | T11, T12, T13 | T11,T12 → T15 (T13) | ✅ |
| T16 | T4, T5, T9 | T4,T5,T9 → T16 | ✅ |
| T17 | T5, T7 | T5,T7 → T17 | ✅ |
| T18 | T5 | T5 → T18 | ✅ |
| T19 | T4, T17, T18 | T18 → T19 (T4,T17) | ✅ |
| T20 | T19 | T19 → T20 | ✅ |
| T21 | T19 | T19 → T21 | ✅ |
| T22 | — | [P] Fase 4 | ✅ |
| T23 | T2, T3, T10, T16, T17, T19, T22 | idem → T23 | ✅ |
| T24 | T2, T16, T17, T19, T22 | idem → T24 | ✅ |
| T25 | T22 | T22 → T25 | ✅ |
| T26 | T2, T22 | T2,T22 → T26 | ✅ |
| T27 | T2, T10, T25 | T2,T10,T25 → T27 | ✅ |
| T28 | T2 | T2 → T28 | ✅ |
| T29 | T15, T23, T24, T25, T26, T27, T28 | T23..T28 → T29 (T15) | ✅ |
| T30 | — | [P] | ✅ |
| T31 | — | início Fase 5 | ✅ |
| T32, T34, T36 | T31 | T31 → | ✅ |
| T33, T37, T38 | — | [P] | ✅ |
| T35 | T32 | T32 → T35 | ✅ |
| T39 | T32, T34, T35, T36 | idem → T39 | ✅ |
| T40 | T33 | T33 → T40 | ✅ |
| T41 | T33, T34 | T33,T34 → T41 | ✅ |
| T42 | T33, T36 | T33,T36 → T42 | ✅ |
| T43 | T33, T37 | T33,T37 → T43 | ✅ |
| T44 | T29, T39, T40, T41, T42, T43 | T39..T43 → T44 (T29) | ✅ |
| T45 | T38 | T38 → T45 | ✅ |
| T46 | T33, T38 | T33,T38 → T46 | ✅ |
| T47 | T44, T45, T46 | T45,T46 → T47 (T44) | ✅ |
| T48 | T14, T20, T21, T30, T47 | idem → T48 | ✅ |
| T49 | T48 | T48 → T49 | ✅ |

Nenhuma task `[P]` depende de outra da mesma fase.

### Testes co-locados × matriz (`TESTING.md`)

| Task | Camada | Matriz | Task diz | Status |
| --- | --- | --- | --- | --- |
| T1 | mapper | unit | unit | ✅ |
| T2 | repositório | none | none | ✅ |
| T3, T5–T9 | função pura | unit | unit | ✅ |
| T4, T22 | contratos/classes | none | none | ✅ |
| T10, T17 | infra com regra (disco) | não listada → unit em pasta temporária | unit | ✅ |
| T11, T12, T23, T24, T26, T27, T28 | use cases | unit | unit | ✅ |
| T13 | funções puras de infra | unit | unit | ✅ |
| T14, T25 | infra com regra (sweeper, fila) | unit | unit | ✅ |
| T15 | rota | none (por ora) | unit (`inject`) — exceção justificada em Gates | ✅ |
| T16 | funções puras de infra | unit | unit | ✅ |
| T18–T21 | normalização pura do adapter | unit | unit | ✅ |
| T29 | rota | none | none | ✅ |
| T30 | Dockerfile | none | none | ✅ |
| T31, T34–T38 | funções puras do painel | unit | unit | ✅ |
| T32 | serviço HTTP | none | none | ✅ |
| T33 | dados | none | none | ✅ |
| T39, T45 | hooks com efeitos (lógica testada em funções puras) | none | none | ✅ |
| T40–T43, T46 | componentes com lógica visível | unit | unit | ✅ |
| T44, T47 | página | none | none | ✅ |

---

## Versão (resolvido em 2026-09-25)

Regra do AGENTS.md confirmada pelo usuário (`context.md` D6): toda alteração sobe versão com
entrada no CHANGELOG. `fix/chat-reply-quote` → `0.11.1` e `0.11.2`; esta feature → `0.12.0` (T1).
