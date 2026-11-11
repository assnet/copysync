# Prévia de link (ofertas e chat)

Cartão com miniatura, título e domínio acima de uma mensagem de texto com link. Dois sentidos:
**envio** (oferta do gerador/monitoramento sai como texto + prévia, sem anexo de foto) e **recebimento**
(mensagem de texto com prévia aparece no chat com o cartão). Spec/design: `.specs/features/link-preview/`.

## Por que montamos a prévia

- Montamos o `linkPreview` com a foto **já armazenada** da oferta. O Baileys usa `message.linkPreview` quando
  definido e não busca nada.
- **Não buscamos a página** do marketplace: Amazon bloqueia, Shopee renderiza no cliente, `meli.la` redireciona para
  outro host; seria acesso externo sem anti-SSRF e +3 s por envio. Por isso nada de `link-preview-js` nem og:image.
- Texto sem prévia vai com `linkPreview: null` explícito (sem isso o Baileys tenta `getUrlInfo` e loga aviso).
  Isso desliga **de propósito** a busca automática do Baileys em todo texto: ela nunca funcionou aqui
  (`link-preview-js` não está instalado) e seria fetch externo sem anti-SSRF.
- Texto digitado no painel continua sem prévia (exigiria buscar a página).

## Formato da imagem (`imageMode`)

| Valor | Envio |
| --- | --- |
| `MEDIA` | Imagem com legenda, caminho de mídia de sempre (`chat-midias-anexos.md`). **Desligado** (ver abaixo) |
| `LINK_PREVIEW` (padrão) | Texto + cartão; sem cópia `PENDING` de mídia no chat; nada vai para a galeria |

- Campos: `Offer.imageMode` (PATCH, como `mentionAll`) e `GroupMonitorConfig.imageMode` (copiado para cada `Offer`).
- Painel: `ImageModePicker` (`features/offers/components/`) no card "Envio" do rascunho (`OfferSendPanel`) e nas
  configurações do monitoramento (`MonitoringSettingsForm`). Textos em `offers/strings.ts` → `imageMode`.
- **Decisão do dono (2026-11-09):** padrão `LINK_PREVIEW` (Prisma `@default`, `DEFAULT_OFFER_IMAGE_MODE`,
  `DEFAULT_IMAGE_MODE`) e `MEDIA` desligado para todos os planos até segunda ordem: `MEDIA_IMAGE_MODE_ENABLED = false`
  na API (`OfferImageMode.ts`) e no painel (`offerConfig.ts`). `effectiveImageMode` converte `MEDIA` salvo em
  `LINK_PREVIEW` no envio (`ProcessDueOfferDispatchesUseCase`), no PATCH e ao salvar/criar pelo monitoramento;
  linhas antigas não são reescritas. No painel o botão "Imagem com legenda" aparece desabilitado com tooltip.
  Para religar: `true` nas duas constantes (o código de `MEDIA` continua inteiro).
- Link da prévia: `pickPreviewUrl(text, affiliateUrl)` (`campaigns/domain/services/`): só o `affiliateUrl`, e só se
  está no texto como link inteiro; senão `null` e a oferta sai sem prévia (api 0.81.0, TLINK-22: nunca outro link do
  texto, para a prévia não divulgar link que não é do tenant; antes caía no primeiro link). `matchedText` = esse texto
  exato.

## Tamanhos

| Imagem | Onde | Tamanho |
| --- | --- | --- |
| Foto da oferta guardada | `MediaOfferStore.saveImage` → `offer-<uuid>.jpg` | lado ≤ 600 px, JPEG q75, sem metadados (entrada ≤ 5 MiB) |
| Miniatura grande | enviada ao servidor de mídia como `thumbnail-link` (`highQualityThumbnail`) | 600 px |
| Miniatura pequena | embutida na mensagem (`jpegThumbnail`) | 192 px, gerada no envio, **não guardada** |

600 px porque a mesma foto vai inteira no modo `MEDIA` e vira o cartão grande (largura da bolha); menos que isso
borra e o WhatsApp tende a cair na miniatura lateral. Fotos antigas não são reprocessadas.

## Envio (`LINK_PREVIEW`)

`ChatOfferMessageSender` → `IOfferPreviewImage` (600/192 pela store) → `SendMessageUseCase` com `linkPreview` →
adapter (`buildBaileysLinkPreview.ts` + `sendTextMessage`).

- **Fallback**: sem imagem, título ou link no texto → texto puro (motivo em log). Upload da grande falhou ou passou
  de `LINK_PREVIEW_UPLOAD_TIMEOUT_MS` (env, padrão 15 s) → envia só com a pequena; o envio não falha.
  Esse teto tem de ficar **abaixo** de `DISPATCH_SEND_TIMEOUT_MS` (60 s, worker de ofertas): com 60 s o disparo
  virava `SEND_TIMEOUT` antes do fallback. Não usar `MEDIA_UPLOAD_IDLE_TIMEOUT_MS` aqui.
- **Eco**: o adapter gera o id (`createOutboundMessageId`) e registra em `outboundEchoRegistries().media` **antes**
  do envio. O eco `append` é pulado inteiro: não grava arquivo nem baixa de volta a miniatura.
- **Reenvio de criptografia**: toda mensagem com prévia vai para o `sentMediaCache` (lido pelo `getMessage`).
  Guarda a mensagem com `jpegThumbnail` (~8 KB): até 200 por sessão, TTL 1 h ≈ 1,6 MB/sessão no pior caso.
- **Registro**: depois do retorno da engine, o use case grava a grande em `<sessionId>_<externalId>_lp.jpg` e cria a
  mensagem com os campos de prévia. Falha ao gravar o arquivo = mensagem sem miniatura.
- Limitações (MVP): no monitoramento o título do cartão é `Offer.title` = 1ª linha do texto capturado. Se o `create`
  falhar depois do envio, a mensagem fica fora do chat (o eco é ignorado e não regrava) e a oferta pode ser
  reenviada no retry — mesmo comportamento do texto puro hoje.

## Recebimento (adapter)

`pickInboundLinkPreview` (função pura, `engines/baileys/`) lê só `extendedTextMessage`:

- URL só `http`/`https` (sem usuário/senha; sem esquema recebe `https://`), ≤ 2048; título ≤ 300, descrição ≤ 500;
  pequena só JPEG (magic bytes) ≤ 100 KB. Sem URL válida = sem prévia.
- **Nota**: o proto não tem `canonicalUrl` (o `canonical-url` do Baileys não vai para a mensagem); a URL vem do
  `matchedText`.
- Miniatura pequena: grava sempre, **sem** olhar `autoDownloadMedia` (já veio na mensagem).
- Miniatura grande: baixa (`thumbnail-link`) só se `shouldAutoDownloadGroupMedia` (contato = sempre; grupo =
  `autoDownloadMedia`). Teto de 1 MiB **contado no stream**; falha = fica a pequena.
  Tempo-limite `LINK_PREVIEW_HQ_DOWNLOAD_TIMEOUT_MS` (10 s, constante em `downloadLinkPreviewThumb.ts`): o download
  roda com await no `messages.upsert` antes do `MESSAGE_RECEIVED` e o fetch do Baileys não tem signal; estourou →
  stream destruído, fica a pequena.
- Arquivo `_lp.jpg` já existe (reentrega, histórico repetido) → devolve `publicUrl` sem regravar nem baixar.
- Histórico/`append` (inclui entrega offline): textos sempre; miniaturas só com até 30 min (mesma janela da mídia).
- Arquivo: `<sessionId>_<msgId>_lp.jpg` (a grande sobrescreve a pequena).
- **Nunca** acessar a URL da prévia.
- Evento `MESSAGE_RECEIVED.linkPreview { url, title, description, thumbnailUrl }`; colunas `linkPreview*` em
  `chat_messages`; `ChatMessageDto.linkPreview` (recarregar mantém o cartão).

## Painel

`LinkPreviewCard.tsx` (`features/chat/components/messages/`) acima do texto no `MessageBubble`: miniatura larga
(≥ 300 px) em 16:9, menor quadrada à esquerda, sem miniatura ícone `Link`; abre em nova aba
(`rel="noopener noreferrer"`); tooltip no domínio com a URL. Privacidade: `chat.linkPreviewImages` (miniatura) e
`chat.linkPreviewText` (título, descrição, domínio; desliga o tooltip). O corpo da mensagem não é borrado.

## O que não fazer

- Instalar `link-preview-js`, chamar `getUrlInfo` ou buscar og:image/página do marketplace.
- Acessar a URL de uma prévia recebida.
- Usar tipo do Baileys fora de `engines/baileys/` (a porta usa `OutboundLinkPreview`).
- Enviar texto sem `linkPreview: null` explícito.
- Gravar miniatura de histórico antigo (> 30 min) ou baixar a grande ignorando `autoDownloadMedia`.
- `Buffer.concat` do download antes de checar o teto.
- Guardar a miniatura de 192 px ou criar mídia `PENDING` no modo `LINK_PREVIEW`.
- Religar `MEDIA` só em uma das pontas (API e painel andam juntos).

## Validação em aparelhos (P3)

Enviar oferta `LINK_PREVIEW` para grupo de teste. Preencher data, versão do app e resultado.

| Verificação | Android | iPhone | Web/Desktop |
| --- | --- | --- | --- |
| Cartão grande (não a miniatura lateral) | [ ] | [ ] | [ ] |
| Título e domínio corretos | [ ] | [ ] | [ ] |
| Toque abre o link do produto | [ ] | [ ] | [ ] |
| Nada salvo na galeria | [ ] | [ ] | n/a |
| Só miniatura pequena (upload falhou) aceitável | [ ] | [ ] | [ ] |
| Cartão aparece no chat do painel após recarregar | — | — | [ ] |

Resultado: _pendente_.
