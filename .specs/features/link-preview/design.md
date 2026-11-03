# Prévia de link — Design

Spec: `spec.md`. Baileys `7.0.0-rc14`. Revisado contra o código em 2026-11-03 (2 rodadas de `/caveman-review`; restam só nits).

## §1 Alternativas

| Alternativa | Veredito | Por quê |
| --- | --- | --- |
| `link-preview-js` + `getUrlInfo` do Baileys | Descartada | Busca a página do marketplace a cada envio (bloqueio Amazon, Shopee sem og no HTML, redirect `meli.la` cross-host recusado pelo `handleRedirects`), sem anti-SSRF, +3 s |
| **`linkPreview` explícito montado com a imagem armazenada** | **Escolhida** | `generateWAMessageContent` usa `message.linkPreview` quando definido e não busca nada (`Utils/messages.js:276-279`) |
| Página própria com og:image | Fora | Continua precisando de A ou B; domínio desconhecido |
| Coluna JSON `linkPreview` em `chat_messages` | Descartada | Anti-padrão "JSON sem necessidade"; campos são fixos |
| Tabela 1:1 `chat_message_link_previews` | Descartada | Join em toda listagem do chat para 4 campos nulos; colunas nulas não custam no Postgres |
| Gravar a mensagem PENDING antes do envio (como a mídia) | Descartada | Muda o `SendMessageUseCase` usado pela rota do painel; o eco é resolvido pelo registro de eco (§3) |

## §2 Porta do motor (domain, neutra)

`messaging/domain/contracts/IMessagingEngine.ts`:

```ts
export interface OutboundLinkPreview {
  /** Texto exato do link dentro de `body` (vira matchedText). */
  url: string;
  title: string;
  description?: string | null;
  /** JPEG ≤ 192 px, embutido na mensagem. */
  thumbnailJpeg?: Buffer | null;
  /** JPEG ≤ 600 px, enviado ao servidor de mídia (cartão grande). */
  imageJpeg?: Buffer | null;
}

export interface SendTextMessageInput {
  // ...campos atuais
  linkPreview?: OutboundLinkPreview | null;
}
```

- Sem `linkPreview` o adapter envia `linkPreview: null` explícito ao Baileys: `null` passa no teste
  `typeof urlInfo === 'undefined'` e não chama `getUrlInfo` (hoje `undefined` gera um aviso por envio; tipo aceita
  `WAUrlInfo | null`, `Types/Message.d.ts:172`).
- `SendTextMessageInput` **não** ganha `messageId`: o id é gerado dentro do adapter quando há prévia (§3).
- Nenhum tipo do Baileys sai do adapter.

## §3 Adapter Baileys

`engines/baileys/buildBaileysLinkPreview.ts` (novo; upload injetado para teste):

```ts
// imageJpeg → prepareWAMessageMedia({ image: buf }, { upload: socket.waUploadToServer,
//   mediaTypeOverride: 'thumbnail-link', mediaUploadTimeoutMs: env.MEDIA_UPLOAD_IDLE_TIMEOUT_MS })
//   → imageMessage (directPath, mediaKey, fileSha256, fileEncSha256, width, height)
// retorno: { 'matched-text': url, title, description,
//            jpegThumbnail: thumbnailJpeg, highQualityThumbnail: imageMessage }
```

- **Não** passar `jpegThumbnail` ao `prepareWAMessageMedia`: sem ele a lib calcula `width/height` com sharp
  (`Utils/messages.js:154-161`). O 32 px que ela gera é descartado; no `urlInfo` vai o nosso de 192 px.
- `mediaUploadTimeoutMs` obrigatório (`Utils/messages.js:146-150`): sem ele upload travado prende o envio até
  `DISPATCH_SEND_TIMEOUT_MS` (60 s) e a oferta sai FAILED, contra a AC P1.4. Mesmo valor do `sendMediaMessage` (`:336`).
- Upload falhou ou estourou o tempo → log `warn` sem URL/título, retorna sem `highQualityThumbnail` (AC P1.4).
- `'canonical-url'` não é enviado: `generateWAMessageContent` só usa `matched-text` (`messages.js:280-298`).

`sendTextMessage` com `linkPreview`:
1. `messageId = this.createOutboundMessageId(sessionId)` (`:289-295`; valida `socket.user` e lança `SessionNotConnectedError`).
2. `outboundEchoRegistries().media.register(sessionId, messageId)` **antes** do envio. O eco do próprio envio sai
   como `append` (`messages-send.js:1135`) e vai para `mapMessagesToHistoryItems` (`:850-857`); com a marca ele é
   pulado inteiro (`:1204`): não grava arquivo órfão nem baixa de volta a miniatura que acabamos de subir. Mesmo
   registro da mídia: semântica "envio próprio que o use case grava".
3. `socket.sendMessage(jid, { text, mentions, linkPreview: built }, { messageId, quoted? })`.
4. Sempre que houve `linkPreview` (com ou sem miniatura grande): `sentMediaCache().set(sessionId, id, result.message)`
   (AC P1.6), mesmo `set` da mídia (`:341`), já lido pelo `getMessage` (`:703`); atualizar o comentário de `:700-703`
   ("texto não é reenviado" passa a ter a exceção da prévia). Cache por processo, preso ao socket do processo
   (`sentMediaCache.ts:70-79`): nenhum estado novo.

Sem `linkPreview`: fluxo atual + `linkPreview: null`.

## §4 Formato da oferta

- Prisma: `enum OfferImageMode { MEDIA LINK_PREVIEW }`; `Offer.imageMode @default(MEDIA)`;
  `GroupMonitorConfig.imageMode @default(MEDIA)`. Migration `add-offer-image-mode`.
- Gerador: `imageMode` entra no **PATCH** (`updateOfferBodySchema`, `offer.schema.ts:43-58`) e na resposta (`:126`),
  como `mentionAll`. A criação (`generateOfferBodySchema`) não muda.
- Caminho do campo (todos na T8): `Offer.ts` (entidade), `PrismaOfferMapper.ts`, `IOfferRepository` (create/patch),
  `OfferDTO.ts`, `UpdateOfferUseCase.ts:33,68`, `EnqueueOfferUseCase.ts:16-21,113-126`,
  `automation/domain/contracts/IMonitorPorts.ts:24-29` (`QueueOfferInput`), `CampaignsOfferQueue`
  (`CampaignsMonitorAdapters.ts:19-21`), `GroupMonitor.ts`, `monitorSettings.ts` (padrão e validação),
  `PrismaGroupMonitorRepository.ts`, schemas/presenter do monitor.
- Monitoramento: `ProcessPendingCapturedOffersUseCase` copia `config.imageMode` para a oferta (mesmo caminho de
  `mentionAll`).
- `ProcessDueOfferDispatchesUseCase` passa `imageMode`, `title` e `affiliateUrl` ao `IOfferMessageSender`
  (`SendOfferMessageInput` ganha os três).
- `ChatOfferMessageSender.send`:
  - `imageUrl && imageMode === MEDIA` → caminho atual (mídia armazenada), sem mudança.
  - `imageMode === LINK_PREVIEW` → `pickPreviewUrl(text, affiliateUrl)` (função pura em `campaigns/domain/services/`,
    AC P1.2; no monitor o `affiliateUrl` é exatamente o link reescrito no texto, `ProcessPending…:128,133`) +
    `IOfferPreviewImage.build(imageUrl)` (§5). Faltou imagem, título ou link → texto puro (AC P1.3).
    Envia por `SendMessageUseCase` com `linkPreview`.
- `SendMessageUseCase` (chat):
  - Nova dependência **opcional** `IMediaFileStore` (5º parâmetro). A rota do painel (`chat.routes.ts:230`) não passa
    e não muda; `ChatOfferMessageSender.ts:69` passa `chatMediaContainer`/`mediaContainer`.
  - Input ganha `linkPreview?` (porta + `thumbnailUrl` resolvido depois).
  - **Depois** do envio, com o `externalMessageId` devolvido: grava `imageJpeg` em
    `<sessionId>_<externalId>_lp.jpg` (nome único, mesmo do recebimento §6) e cria a mensagem com os campos de
    prévia (§7). Falha ao gravar o arquivo = mensagem sem miniatura, envio não falha.
- Título no monitor: `Offer.title` é a 1ª linha do texto capturado (`titleOf`, `ProcessPending…:160,251-258`). O
  cartão mostra essa linha. Aceito no MVP (documentar); título do produto fica para depois.

## §5 Imagem

`media/domain/contracts/IImageTranscoder.ts` ganha:

```ts
/** JPEG com lado maior ≤ maxSide, mesmo tratamento do toJpeg. */
resizeJpeg(input: string | Buffer, maxSide: number, quality: number): Promise<{ buffer: Buffer; width: number; height: number }>;
```

`SharpImageTranscoder`: `rotate().flatten('#fff').resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true })
.jpeg({ quality, mozjpeg: true })`, mesmo `limitInputPixels`.

- `MediaOfferStore.saveImage`: teto de 5 MiB checado antes; depois `resizeJpeg(buf, 600, 75)` e grava `offer-<uuid>.jpg`.
  `MediaOfferStoreDeps` ganha `images: () => IImageTranscoder`, montado em `offersContainer.ts:74` com
  `mediaContainer.imageTranscoder`. Chamadores conferidos
  (`ResolveProductDataUseCase.ts:98`, `consumeUploadedImage`, `CampaignsMonitorImageStore`); `offerImageMimeFromUrl`
  cai em JPEG; regex `OFFER_IMAGE_NAME` continua aceitando png/webp (fotos antigas). Storefront e story não usam.
  Erro do sharp → `MediaProcessingFailedError`, mesmo tratamento que o chamador já dá a foto inválida.
- `campaigns/infrastructure/adapters/OfferPreviewImage.ts` (`IOfferPreviewImage`): lê `imageUrl` por
  `IMediaFileStore.acquireLocalFile` + `release` (vale para `offer-*.jpg` e para `sourceMediaUrl` do monitor, que é
  mídia do chat) e devolve `{ imageJpeg: resizeJpeg(600, 75), thumbnailJpeg: resizeJpeg(192, 70) }`.
  `acquireLocalFile` → `null` (URL fora da store, arquivo sumiu) = retorna `null`; `acquired.release()` em `finally`
  (`AcquiredMediaFile`, `IMediaFileStore.ts:15-20`). Imagem já reduzida passa direto (`withoutEnlargement`).
  Falha → `null` (AC P1.3, texto puro).

## §6 Recebimento (adapter)

`pickInboundLinkPreview(extendedTextMessage)` — função pura em `engines/baileys/`:
`{ url: matchedText, title, description, inlineThumb: Buffer | null, hq: { directPath, mediaKey } | null }`.
O proto não tem `canonicalUrl` (o `canonical-url` do Baileys não vai para a mensagem): a URL vem só do `matchedText`.
Validações da AC P2.6 aqui (http/https, cortes de tamanho, magic JPEG e ≤ 100 KB na pequena). Sem URL válida
= `null`. Só o ramo `extendedTextMessage` (`extractBaileysMessage`, `:1871`); `conversation` nunca traz prévia.

`BaileysExtracted` ganha `linkPreview`. Dois caminhos usam (os dois na T12):

**A. Tempo real (`notify`, `:880-930`)**
1. `inlineThumb` → `store.saveBuffer(buf, <sessionId>_<msgId>_lp.jpg)`. Sem flag.
2. `hq` e `shouldAutoDownloadGroupMedia(...)` (contato = sempre, como a mídia; grupo = `autoDownloadMedia`) →
   `downloadContentFromMessage({ directPath, mediaKey }, 'thumbnail-link')` (suportado: `Defaults/index.js:90,109`).
   Teto de 1 MiB **contado no stream**: soma os chunks e `destroy()` ao passar; nunca `Buffer.concat` antes de
   checar. Sobrescreve o mesmo arquivo. Erro = mantém a pequena, `warn`.
3. Evento `MESSAGE_RECEIVED.linkPreview: { url, title, description, thumbnailUrl }`.

**B. Histórico e `append` (`mapMessagesToHistoryItems`, `:1191-1270` → `IngestHistorySyncUseCase`)**
- Inclui entrega offline após restart. Eco do nosso envio com prévia já foi pulado pelo registro de eco (§3).
- Campos de texto da prévia sempre. Miniaturas só dentro da janela `THIRTY_MIN_MS` (`:1243`), e a grande também
  só com `shouldAutoDownloadGroupMedia` (`:1241-1245`), igual à mídia: histórico completo (`BAILEYS_SYNC_FULL_HISTORY`) não grava um arquivo por link antigo.
- `HistoryMessageItem.linkPreview` (`IngestHistorySyncUseCase.ts:9`) e o `create` (`:183`).

O sistema nunca acessa a URL da prévia.

## §7 Contrato, persistência e painel

- `InternalMessagingEvent` `MESSAGE_RECEIVED`: `linkPreview?: { url; title; description?; thumbnailUrl? } | null`.
  Emissor: adapter. Consumidor: `ChatIncomingMessageListener` (`IngestIncomingMessageUseCase`).
  `GroupMonitoringMessageListener` e o SSE de `chat.routes.ts:598` ignoram (não mudam).
- Prisma `ChatMessage`: `linkPreviewUrl`, `linkPreviewTitle`, `linkPreviewDescription`, `linkPreviewThumbUrl`
  (todos `String?`, URL/descrição `@db.Text`). Migration `add-chat-message-link-preview`.
- Backend (T11): entidade, `PrismaChatMessageMapper`, repositório `create`, `IngestIncomingMessageUseCase`,
  `IngestHistorySyncUseCase` e **`ChatMessageDto.linkPreview`**, montado campo a campo em `ListMessagesUseCase.ts:30`
  (interface) e `:105-125`, `SendMessageUseCase.ts:107+`, `SendMediaMessageUseCase.ts:343`,
  `SendStoredMediaMessageUseCase.ts:183`, `RetryOutboundMediaUseCase` (mídia devolve `null`), e
  **`ChatPresenter.presentMessage`** (`:52-75`, também campo a campo: `linkPreview: dto.linkPreview`). Sem isso o
  cartão some ao recarregar.
- WS: `ChatWsEvent` (`ChatWebSocketPublisher.ts:15-33`) e a lista manual de campos em
  `ChatIncomingMessageListener.ts:47-67` ganham `linkPreview`, montado da entidade.
- Painel (T13):
  - `ChatMessageApiDto.linkPreview`, `ChatMessage.linkPreview`, `apiMessageToFrontend` com
    `resolveMediaUrl(thumbnailUrl)`.
  - `components/messages/LinkPreviewCard.tsx`: miniatura (16:9 se larga ≥ 300 px natural, quadrada à esquerda se
    menor), título 2 linhas, descrição 2 linhas, domínio (`new URL().hostname`), link `target="_blank"
    rel="noopener noreferrer"`. Cores do tema (claro/escuro); `AppIcon` Lucide `Link` sem miniatura. Tooltip no
    domínio com a URL completa.
  - `MessageBubble` `case 'text'` (`:127`): cartão acima do `RichMessageText` quando `message.linkPreview`.
  - Privacidade (T14): `chat.linkPreviewImages` (miniatura) e `chat.linkPreviewText` (título, descrição, domínio; com
    ela ligada o tooltip do domínio fica desligado). O corpo da mensagem (onde a URL também aparece) fica fora: o chat
    não borra corpo hoje. Primeira tela `chat` em `privacyFlags.ts` (formato `<tela>.<dado>`, `:8-70`).
  - Strings: `chatStrings.linkPreview.*` (`openLink`, `noTitle`, aria-labels).

## §8 Validação

- Unitários: `pickPreviewUrl`, `pickInboundLinkPreview`, `buildBaileysLinkPreview` (upload ok, falha, timeout),
  `sendTextMessage` (registra eco antes do envio, `linkPreview: null` sem prévia), `ChatOfferMessageSender` (3 ramos),
  `SendMessageUseCase` (com e sem store; rota do painel inalterada), `SharpImageTranscoder.resizeJpeg`,
  download com teto no stream.
- Migrations em Postgres descartável (`pnpm -C api test:int`), nunca no banco do `.env`.
- Painel com agent-browser: cartão com miniatura grande, pequena, sem miniatura; recarregar a conversa mantém o
  cartão; claro/escuro; flags de borrar.
- P3 manual em grupo de teste (Android, iPhone, Web) — registrar em `docs/mensagens-previa-de-link.md`.

## §9 Nome do grupo cortado

`app/src/components/OverflowTooltipText.tsx` + hook `useIsTruncated(ref)` (novo, genérico, exportados em
`app/src/components/index.ts`; não existe equivalente no app):

- `useIsTruncated`: `scrollWidth > clientWidth` do elemento, recalculado por `ResizeObserver`.
- `OverflowTooltipText`: `Typography noWrap` + `Tooltip` MUI (`arrow`, `describeChild`, `enterTouchDelay={0}`,
  `leaveTouchDelay={4000}`); sem corte → tooltip desligado. Props: `text`, `disabled` (flag de borrar da tela),
  `typographyProps`, `children` opcional (o `<Blurred>` pode ficar dentro; se a tela já envolve por fora, também
  funciona: a medida é na `Typography`).
- Chip (`GroupChip`, label cortado pelo `Chip` com `maxWidth`): `useIsTruncated` no `.MuiChip-label` e `Tooltip` em
  volta do `Chip`.
- `ListItemText` (`OfferDispatchProgress`): `OverflowTooltipText` em `primary`, sem `slotProps.primary.noWrap`.
- Locais e flag de cada um:

| Local | Hoje | Flag |
| --- | --- | --- |
| `offers/…/config/ConfigGroupsStep.tsx:218` | `title` nativo | já usa `blurNames` |
| `offers/…/OfferConfigSummary.tsx:96` | `title` nativo (lista) | já usa `blurNames` |
| `offers/…/OfferDispatchProgress.tsx:171-182` | sem tooltip, **sem borrar** | adicionar `useBlur('offers.groupNames')` + `Blurred` |
| `offers/…/OfferChatPreview.tsx:57` | sem tooltip | `offers.groupNames` (já usa, `:31`) |
| `offers/components/GroupChip.tsx` (usado em `OfferSendPanel.tsx:168`, `ConfigConfirmStep.tsx:63`) | Chip cortado | prop `nameFlag` → `useBlur(nameFlag)` |
| `monitoring/…/MonitoredGroupsCard.tsx:72` | sem tooltip | `monitoring.groupNames` |
| `monitoring/…/BroadcastGroupsCard.tsx:181` | sem tooltip | `monitoring.groupNames` |
| `monitoring/…/GroupPickerDialog.tsx:302` | sem tooltip | `monitoring.groupNames` |
| `monitoring/…/CapturedOffersList.tsx:356` | sem tooltip | `monitoring.groupNames` |
| `sendQueue/components/SendQueuePanel.tsx:346` (gerador e monitoramento) | sem tooltip | prop `privacy.groupNames` |

- `title` nativo removido onde existe (só `ConfigGroupsStep` e `OfferConfigSummary`).
- Documentar em `docs/padrao-ui-painel.md`: "texto cortado com reticências = `OverflowTooltipText`/`useIsTruncated`".

## Documentação

- Novo `docs/mensagens-previa-de-link.md`: o que é, por que não buscamos a página, tamanhos, flag de download,
  eco e registro (se o `create` falhar depois do envio, a mensagem fica fora do chat: o eco não regrava),
  limitação do título no monitor, o que não fazer (instalar `link-preview-js`, buscar og:image,
  tipo Baileys fora do adapter, gravar miniatura de histórico antigo).
- Atualizar `docs/gerador-de-ofertas.md`, `docs/monitoramento-grupos.md` (`imageMode`), `docs/chat-midias-anexos.md`
  (miniatura de prévia × `autoDownloadMedia`, eco), `docs/padrao-ui-painel.md` (lista "Telas cobertas" `:67` com
  `chat`; regra do tooltip), link no `AGENTS.md`, `CHANGELOG.md`, versões api/app (minor).
