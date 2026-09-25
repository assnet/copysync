# Anexos e Mensagem de Voz — Decisões de Contexto

**Gathered:** 2026-09-24
**Spec:** `.specs/features/chat-media-attachments/spec.md`
**Status:** Ready for design

Decisões do usuário (D1–D7) travam o design. A tabela final lista as discricionárias do agente,
cada uma com o fato que a sustenta.

## D1 — Cópia do arquivo enviado fica no disco atual

Mesmo disco persistente das mídias recebidas (`STORAGE_PATH`, `/var/data/storage` na Render),
servido por `/api/storage/media/`. Tudo passa por uma porta (`IMediaFileStore`), para o plano de
object storage (`docs/superpowers/plans/2026-05-09-chat-media-storage-architecture.md`) trocar só
a implementação.

**Implicação**: o disco cresce com os envios (vídeo de 180 MB conta inteiro). Antes do deploy,
conferir o tamanho do disco na Render (pré-voo em `tasks.md`). A dívida de a rota estática não
ter autenticação continua, agora também para o que o operador envia. Esta feature reduz a
exposição: a rota passa a servir só `media/` e força download dos tipos não exibíveis inline.

## D2 — Gravação estilo WhatsApp Web completo

O microfone troca o composer por uma barra com: descartar, indicador gravando, cronômetro,
ondas ao vivo, pausar/retomar, pré-escuta quando pausado e enviar. Clique, não segurar.

**Implicação**: pausa e pré-escuta dependem de `MediaRecorder.pause()` e de tocar o trecho
parcial. No Safari (MP4 fragmentado), tocar o parcial é INCERTO — se falhar, a pré-escuta fica
desabilitada com tooltip, sem bloquear retomar/enviar (spec P2, critério 3).

## D3 — Anexos em lote, com arrastar e colar

Menu "Documento" / "Fotos e vídeos" → prévia sobre a área de mensagens com item grande,
miniaturas, legenda por item, remover e adicionar. Arrastar e colar abrem a mesma prévia com
classificação automática por arquivo.

## D4 — Citação restaurada antes, em fix próprio (revisada em 2026-09-25)

Primeira resposta: fora de escopo, supondo que já funcionava. O usuário confirmou que **deve**
funcionar. O histórico mostra regressão: `dea6c36` (2026-03-21) entregava a citação;
`b45f4e7` (2026-03-22, "remove grupos, midia, avatares e reply") a removeu, e só grupos, mídia
e avatares voltaram. Hoje `sendMessage(jid, { text })` sai sem `quoted`
(`BaileysMessagingEngineAdapter.ts:198`); o painel mostra o bloco citado porque grava
`quotedMessageId` localmente.

**Decisão**: branch `fix/chat-reply-quote` (`.specs/quick/001-restaurar-citacao-no-envio/`),
mergeada em `develop` **antes** da T1 — **feito** em 2026-09-25 (`2df4dc6`, 0.11.2, smoke
aprovado). O smoke revelou um segundo requisito: em grupo LID, a citação precisa do LID do autor.
A T19 reusa o helper `buildQuoted` do adapter (não o builder direto), então anexo e voz enviados
como resposta chegam citados com o mesmo tratamento do texto.

## D5 — Vídeo até 180 MB confirmado

O usuário conferiu no WhatsApp Web (2026-09-25): o limite exibido é 180 MB. Vira o padrão de
`MEDIA_MAX_INLINE_VIDEO_BYTES` (180.000.000). O smoke confere o envio de 180 MB; a variável
continua existindo só para ajuste operacional.

## D6 — Versão sobe a cada alteração

Regra do AGENTS.md confirmada pelo usuário: fix → patch, feature → minor, sempre com
`CHANGELOG.md`. `fix/chat-reply-quote` levou a `0.11.1` e `0.11.2`; a T1 desta feature leva a `0.12.0`
nos dois `package.json`. (A feature de reações não subiu — não repetir.)

## D7 — API na Render em runtime nativo

Build: `pnpm install --frozen-lockfile && pnpm run prisma:generate && pnpm run prisma:deploy && pnpm run build`.
Start: `pnpm run start`.

**Implicações**: sem Docker em produção (`api/Dockerfile` serve só ao `docker-compose` local);
ffmpeg vem do runtime nativo da Render (confirmar no Shell — pré-voo); a migration do `PENDING`
roda no **build**, antes do código novo subir — compatível, pois o valor novo de enum não é
usado pelo código antigo.

## D8 — Pré-voo na Render (2026-09-25)

Saída do Shell do serviço da API:

| Item | Resultado | Situação |
| --- | --- | --- |
| Node | `v26.10.0` | ✅ (`statfs` desde 18.15) |
| `STORAGE_PATH` | `/var/data/storage` | ✅ um nível abaixo da raiz do disco |
| Disco `/var/data` | **974 MB total, 672 MB usados, 287 MB livres (71%)** | ❌ **bloqueante** — ver abaixo |
| Mesmo dispositivo (`/var/data`, storage, `dirname`) | `66317` nos três | ✅ promoção por `rename` atômico |
| Escrita em `/var/data` | ok | ✅ pasta `media-uploads` viável |
| RAM (cgroup) | `memory.max` = 2 GiB | ✅ streaming + concorrência 2 cabem |
| `/tmp` | 104 GB livres no host (teto efêmero da Render ~2 GB, não oficial) | ✅ com a reserva de `/tmp` do plano |
| ffmpeg / ffprobe | `5.1.9` (Debian 12), `/usr/bin` | ✅ — mas **5.1**, não o 8.x local |
| Encoder `libopus` | presente | ✅ nota de voz viável |
| Demuxers | `ogg`, `matroska,webm`, `mov,mp4,…` | ✅ os três formatos de gravação dos navegadores |

**Disco — bloqueante para vídeo**: 287 MB livres comportam **um** vídeo de 180 MB. E a mídia
recebida sozinha já ocupou 71% — sem ação, o disco enche mesmo sem esta feature, e o download de
mídia recebida falha em silêncio (`adapter:1335-1340`). Decisão: **aumentar o disco antes do
deploy da feature** — **feito: 10 GB em 2026-09-25** — e tornar os limites de disco
**relativos ao tamanho do disco** (§5 do design): com o padrão fixo antigo (reserva de 1 GiB), um
disco de 974 MB recusaria todo upload.

**ffmpeg 5.1 em produção, 8.x local**: os argumentos da §7 precisam ser validados no 5.1.9
(Debian 12), não só na máquina local (T16).

## Decisões do agente (discricionárias)

| Decisão | Escolha | Motivo |
| --- | --- | --- |
| Transporte do upload | Partes de 8 MiB (`PUT` binário por parte), retomáveis, direto no disco | A Render não documenta limite de corpo e há relatos de 413 no proxy; 180 MB numa requisição só não tem garantia. Partes dão progresso, retry por parte e retomada após queda ou deploy. Dispensa `@fastify/multipart` |
| Estado do upload | Arquivo lateral JSON por upload no disco, fora da pasta pública | Sobrevive a restart (retomada após deploy). Disco anexado já obriga instância única, então não há corrida entre instâncias. Sem tabela nova |
| Onde fica a pasta temporária | `dirname(STORAGE_PATH)/media-uploads` — mesmo disco, **fora** da raiz estática; estática com `dotfiles: 'deny'` e caminho normalizado | `rename` atômico para `media/`. Dentro da raiz seria servida: o `@fastify/static` 7 usa `dotfiles: 'allow'` e `/media/../x` passaria sem normalizar. `/tmp` da Render é efêmero e tem teto de ~2 GB |
| Ordem de gravação | **Persistir antes de enviar**: mensagem `PENDING` com id externo pré-gerado, depois fila | O eco do Baileys (`append`) chega por `IngestHistorySyncUseCase`, que deduplica por `externalMessageId`. Com o id já no banco, o eco nunca duplica. Também dá bolha consistente para status assíncrono |
| Eco da mídia própria | Registro de ids **de módulo**; `mapMessagesToHistoryItems` pula o item antes de baixar | Hoje o eco `fromMe` com menos de 30 min é **baixado inteiro em Buffer** antes do dedupe (`adapter:941-948`, `:1327`). Registro por instância falharia: há dois adapters no processo (`server.ts:100-111` e `session.routes.ts:43-53`) compartilhando sockets — o eco de reação já sofre disso hoje |
| Envio ao WhatsApp | Assíncrono: `202` + fila serial **por conversa**, até 2 por sessão e 2 no total | Upload de 180 MB ao WhatsApp leva minutos; resposta HTTP presa não sobrevive a queda de rede do operador. Serial por conversa garante a ordem do lote; por sessão inteira, um vídeo travaria os outros operadores do mesmo número |
| Status novo | `PENDING` no enum `ChatMessageStatus` | Não há status "enviando" no banco (`schema.prisma:92-97`). Texto continua gravando `SENT` direto |
| Reinício com fila | Drain de 25 s no shutdown; no boot, `PENDING` vira `FAILED` (reenviável) **só com `MEDIA_PENDING_RECOVERY_ENABLED=true`** (Render); varredura periódica dos antigos fora de execução | Fila é memória. A flag existe porque `api/.env` aponta para o banco de produção: um `pnpm dev` marcaria como falha mídia que a produção ainda está enviando |
| Arquivo entregue ao Baileys | `{ url: caminhoLocal }` | Baileys lê por stream, criptografa em arquivo temporário e sobe por stream (`messages-media.js:309-399`, `:536-594`): memória constante. Buffer carregaria 180 MB |
| Metadados | A API calcula `seconds`, `width`/`height`, miniatura de vídeo e `waveform` com ffmpeg/ffprobe e passa ao Baileys | Baileys não calcula duração de vídeo (vira 0:00), exige `ffmpeg` no PATH para miniatura e não gera waveform sem `audio-decode` (não instalado). Passando `seconds` sem `waveform`, um bug do rc14 zera o waveform (`messages.js:138`) |
| Voz | Sempre transcodificar para Ogg/Opus mono 48 kHz (`-application voip`) | Chrome grava WebM, Safari MP4/AAC, Firefox Ogg. O WhatsApp exige Ogg/Opus para nota de voz. Receita já validada em produção no legado2 (`whatsapp.baileys.service.ts:3102-3204`) |
| Vídeo fora do padrão | Não-H.264, 10 bits (`pix_fmt` ≠ `yuv420p`), MOV/WebM, sem probe ou acima do limite inline → documento | Sem transcodificação (fora de escopo); HEVC/10 bits no Android é INCERTO. O codec só a API conhece: a prévia avisa pelo tipo/tamanho e a bolha reflete o tipo final |
| Tipo do arquivo | Magic bytes no servidor; MIME do navegador é só dica | O navegador infere pelo nome. `file-type` é ESM-only e a API é CommonJS (`tsconfig.json:4`): sniff próprio, função pura com teste |
| ffmpeg | Binário do sistema (`FFMPEG_PATH`/`FFPROBE_PATH`); `apk add ffmpeg` só no Dockerfile local | Produção roda no runtime nativo da Render, que já traz ffmpeg (D7); `ffmpeg-static` são 80 MB GPL e exigiria liberar build no pnpm. Capacidade detectada no boot e exposta ao painel |
| Limites padrão (env) | Vídeo inline 180 MB, documento 180 MB, imagem 16 MB, voz 15 min, lote 30 | 180 MB confirmado pelo usuário no WhatsApp Web (D5), em decimal (180.000.000 bytes, conservador). O adapter ainda confere `maxContentLengthBytes` da `mediaConn` antes de subir |
| Legenda | Até 4096 caracteres, igual ao texto | Mesmo limite do `sendMessageBodySchema` |
| Textos | `features/chat/strings.ts`, sem lib de i18n | Mesma regra de `message-reactions/context.md` D3; bloqueio em `STATE.md` |
| Trocar de conversa gravando | Encerra, libera o microfone e guarda como rascunho da conversa (enviar/descartar ao voltar) | Confirmação não cobre a perda de seleção vinda do WS (arquivamento em outro aparelho, `ChatPage.tsx:416-418`); manter o microfone aberto em outra conversa seria estranho |
| Reação em mídia não entregue | Bloqueada no painel e na API (`PENDING`/`FAILED`) | O id pré-gerado existe antes de a mensagem chegar ao WhatsApp; hoje a reação só exige `externalMessageId` (`SetMessageReactionUseCase.ts:73`) |
| Pedido de reenvio de criptografia | Cache da mídia enviada respondendo `getMessage` | Hoje `getMessage` devolve sempre `undefined` (`adapter:455-458`); em grupo o contato pode ficar em "Aguardando esta mensagem" |
