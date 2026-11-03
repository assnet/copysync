# Prévia de link — Tasks

Ordem = dependência. Cada task fecha com `tsc --noEmit` do pacote tocado e testes do arquivo.

| # | Task | Arquivos principais | Verificação |
| --- | --- | --- | --- |
| T1 | Migration `add-offer-image-mode`: enum + `Offer.imageMode` + `GroupMonitorConfig.imageMode` | `prisma/schema.prisma`, migration | `test:int` em Postgres descartável |
| T2 | `IImageTranscoder.resizeJpeg` + sharp; `MediaOfferStore.saveImage` reduz para 600 px JPEG | `media/…/SharpImageTranscoder.ts`, `MediaOfferStore.ts`, `offersContainer.ts` | teste: PNG 2000 px → JPEG ≤ 600 px; WebP → JPEG |
| T3 | Porta: `OutboundLinkPreview` em `SendTextMessageInput` | `IMessagingEngine.ts` | tsc |
| T4 | `buildBaileysLinkPreview` (com `mediaUploadTimeoutMs`) + `sendTextMessage` com prévia: id gerado no adapter, registro de eco antes do envio, `linkPreview: null` sem prévia, `sentMediaCache` | `engines/baileys/*` | unit: HQ ok, upload falhou, timeout, eco registrado, sem prévia |
| T5 | `IOfferPreviewImage` + `OfferPreviewImage` (600/192) lendo por `acquireLocalFile`/`release` | `campaigns/…` | unit: `offer-*.jpg` e mídia do chat; falha → null |
| T6 | `pickPreviewUrl` (função pura) | `campaigns/domain/services/` | unit: 1 link, vários, ausente |
| T7 | `ChatOfferMessageSender` ramo `LINK_PREVIEW` + `SendMessageUseCase` com `IMediaFileStore` opcional, grava `<sessionId>_<externalId>_lp.jpg` e campos **depois** do envio (depende de T8, T11) | `ChatOfferMessageSender.ts`, `IOfferMessageSender.ts`, `SendMessageUseCase.ts`, `ProcessDueOfferDispatchesUseCase.ts` | unit 3 ramos; sem PENDING de mídia; rota do painel (`chat.routes.ts:230`) inalterada |
| T8 | `imageMode` de ponta a ponta: entidade/mapper/repo/DTO da oferta, PATCH + resposta, `UpdateOfferUseCase`, `EnqueueOfferUseCase`, `QueueOfferInput`, `CampaignsOfferQueue`, `GroupMonitor`/`monitorSettings`/repo/schemas do monitor; monitor copia para a oferta | lista em design §4 | unit: PATCH, enqueue, captura copia |
| T9 | Painel: campo "Formato da imagem" no gerador e no monitoramento (tooltip, strings, persistência, claro/escuro) | `app/src/features/offers/*`, `monitoring/*` | agent-browser |
| T10 | `pickInboundLinkPreview` (função pura, validações AC P2.6) | `engines/baileys/` | unit: http/https, cortes, sem título |
| T11 | Migration `add-chat-message-link-preview` + entidade/mapper/repo + `ChatMessageDto.linkPreview` em ListMessages e nos use cases de envio + `ChatPresenter.presentMessage` + `ChatWsEvent` | lista em design §7 | `test:int`; listagem devolve prévia |
| T12 | Evento `MESSAGE_RECEIVED.linkPreview` + caminho tempo real (pequena sempre, grande sob regra de download, teto no stream) + caminho histórico/`append` (janela 30 min, `HistoryMessageItem`, `IngestHistorySyncUseCase`) + WS do listener | adapter, `InternalMessagingEvent.ts`, `ChatIncomingMessageListener.ts`, `IngestIncomingMessageUseCase.ts`, `IngestHistorySyncUseCase.ts` | unit: flag on/off, falha HQ mantém pequena, histórico antigo sem arquivo, eco pulado |
| T13 | Painel: tipos/DTO/mapper + `LinkPreviewCard` + `MessageBubble` | `app/src/features/chat/*`, `types/chat.api.types.ts` | agent-browser (3 variantes, claro/escuro) |
| T14 | Privacidade `chat.linkPreviewImages`/`chat.linkPreviewText` (domínio e tooltip incluídos) + strings | `privacyFlags.ts`, `chat/strings.ts` | agent-browser com flags ligadas |
| T15 | Docs (`mensagens-previa-de-link.md`, gerador, monitoramento, chat-mídias, `padrao-ui-painel.md` telas cobertas, AGENTS.md), CHANGELOG, versões | docs | revisão; P3 manual registrada |
| T16 | `OverflowTooltipText` + `useIsTruncated` + aplicar nos 11 pontos da tabela design §9 (inclui `GroupChip` e borrar em `OfferDispatchProgress`) + regra em `padrao-ui-painel.md` | `app/src/components/`, `offers/*`, `monitoring/*` | agent-browser: nome longo mostra, curto não, borrar ligado não |

T16 é independente: pode sair antes, em entrega própria.

MVP de envio = T1–T9 + T11 (ordem: T1, T2, T3, T4, T5, T6, T8, T9, T11, T7) (persistência da mensagem enviada). Chat recebido = T10, T12–T14.
