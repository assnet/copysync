# Prévia de link — envio de ofertas e exibição no chat — Specification

Status: **implementado** (api 0.50.0 · app 0.60.0, 2026-11-03). P3 (validação em aparelhos) pendente.
Docs base: `docs/gerador-de-ofertas.md`, `docs/monitoramento-grupos.md`, `docs/chat-midias-anexos.md`.
Escopo: **gerador de ofertas, monitoramento e chat**. Página de ofertas e story ficam fora.

## Problem Statement

Hoje a oferta com foto sai como **imagem com legenda**: no envio a foto é copiada como mensagem `PENDING` do chat,
WebP vira JPEG e o arquivo inteiro sobe para o WhatsApp. Cada membro do grupo baixa a foto cheia (pode ir para a
galeria no Android). A foto da oferta é gravada como veio (até 5 MiB, `MediaOfferStore.ts:41`).

Oferta sem foto e qualquer texto enviado saem **sem prévia**: o adapter manda só `{ text }` e o Baileys tentaria
gerar a prévia com `link-preview-js`, que não está instalado (o `import` falha e vira só um aviso).

No sentido inverso, mensagem recebida que tem só link com prévia (sem foto) aparece no chat como texto puro: título,
descrição e miniatura vêm na mensagem (`extendedTextMessage`) e o adapter descarta (`BaileysMessagingEngineAdapter.ts:1871`).

## Goals

- [ ] Oferta pode sair como **prévia do link**: texto + cartão com miniatura, título e domínio, sem anexo de foto.
- [ ] A prévia é montada por nós com a imagem já armazenada. Nunca buscamos a página do marketplace para isso.
- [ ] Foto da oferta guardada já reduzida (uma versão só), sem cópia por envio no modo prévia.
- [ ] Chat mostra cartão de prévia em mensagem de texto com link (recebida, enviada pelo celular e enviada por nós).
- [ ] Miniatura grande recebida respeita `autoDownloadMedia`; miniatura pequena (já vem na mensagem) não.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Página de ofertas e story de oferta | Não enviam mensagem ao WhatsApp |
| Instalar `link-preview-js` / buscar og:image do marketplace | Amazon bloqueia, Shopee renderiza no cliente, `meli.la` redireciona para outro host; acesso externo sem anti-SSRF e +3 s por envio |
| Link curto próprio com página og:image | Troca domínio confiável por desconhecido; só faz sentido com métrica de clique (feature futura) |
| Prévia em mensagem com mídia (imagem/vídeo com legenda) | Já mostra a mídia; o WhatsApp não junta os dois |
| Usar a miniatura da prévia recebida como foto da captura no monitoramento | Possível depois; hoje captura só-link cai na foto do produto e funciona |
| Gerar prévia para texto digitado no painel | Exigiria buscar a página (fora, acima). Painel continua sem prévia |
| Reprocessar fotos antigas já gravadas | Só ofertas novas passam pela redução |

---

## User Stories

### P1: Oferta enviada como prévia do link ⭐ MVP

**User Story**: Como operador, quero que a oferta chegue no grupo como link com prévia, para o membro ver a imagem
sem baixar foto nem encher a galeria, e tocar no cartão para abrir o produto.

**Acceptance Criteria**:
1. WHEN a oferta tem `imageMode = LINK_PREVIEW`, tem imagem e o link do tenant aparece no texto
   THEN o envio SHALL ser texto com prévia (`matchedText` = esse link exato, título = `offer.title`,
   miniatura pequena ≤ 192 px embutida e miniatura grande enviada ao servidor de mídia)
   AND SHALL NOT criar cópia `PENDING` de mídia no chat.
2. WHEN o texto tem mais de um link (monitoramento modo ORIGINAL) THEN a prévia SHALL usar o primeiro link do tenant
   (`affiliateUrl` da oferta se presente no texto; senão o primeiro reescrito).
3. WHEN `imageMode = LINK_PREVIEW` mas falta imagem, título ou o link no texto
   THEN SHALL sair como texto sem prévia, igual a hoje para oferta sem foto, e registrar o motivo em log.
4. WHEN o upload da miniatura grande falha ou passa de `MEDIA_UPLOAD_IDLE_TIMEOUT_MS` THEN o adapter SHALL enviar
   com a miniatura pequena só (melhor esforço), sem falhar o envio.
4b. No monitoramento o título do cartão é o `Offer.title` (1ª linha do texto capturado). Limitação aceita no MVP.
5. WHEN `imageMode = MEDIA` (padrão) THEN o envio SHALL seguir exatamente o caminho atual (imagem com legenda).
6. WHEN um aparelho do grupo pede reenvio de criptografia de uma oferta enviada com prévia
   THEN o conteúdo SHALL estar no cache de mensagens enviadas (`sentMediaCache`), como a mídia.

### P1: Escolha do formato ⭐ MVP

**Acceptance Criteria**:
1. Gerador: edição da oferta tem "Imagem com legenda" × "Prévia do link" (persistido com `usePersistedState`
   como o resto do rascunho); valor gravado em `Offer.imageMode` pelo PATCH, como `mentionAll`.
2. Monitoramento: configuração tem o mesmo campo (`GroupMonitorConfig.imageMode`), copiado para cada `Offer` criada.
3. Padrão `MEDIA` nos dois até a validação em aparelhos (P3) aprovar troca de padrão.
4. Textos via `strings.ts` da feature, tooltip explicando a diferença (imagem cheia × cartão leve), claro/escuro.

### P1: Foto da oferta reduzida ⭐ MVP

**Acceptance Criteria**:
1. WHEN `MediaOfferStore.saveImage` grava foto (fetch do marketplace, upload do operador, foto do produto no monitor)
   THEN SHALL gravar JPEG com lado maior ≤ 600 px, qualidade 75, EXIF aplicado, fundo branco, sem metadados.
2. Foto de origem capturada do grupo (`sourceMediaUrl`) não muda: é a mídia do chat e já vem comprimida pelo WhatsApp.
3. Limite de entrada continua 5 MiB; saída esperada 35–70 KB.
4. Por que 600 px e não menos: a mesma foto vai inteira no modo `MEDIA` e vira o cartão grande no modo
   `LINK_PREVIEW`. O cartão ocupa a largura da bolha (~1000 px físicos em tela 3x); com 200 px fica borrado e o
   WhatsApp tende a mostrar a miniatura lateral pequena. 600 px é o mesmo teto da página de ofertas
   (`storefrontRules.ts`). A miniatura de 192 px é gerada no envio e não é guardada.

### P2: Chat mostra prévia de link

**User Story**: Como atendente, quero ver no chat o cartão da prévia quando a mensagem é só texto com link.

**Acceptance Criteria**:
1. WHEN chega mensagem de texto com `matchedText`/`canonicalUrl`/`title`
   THEN o evento `MESSAGE_RECEIVED` SHALL levar `linkPreview { url, title, description, thumbnailUrl }`
   AND a mensagem SHALL ser gravada com esses campos.
2. WHEN a mensagem traz `jpegThumbnail` THEN SHALL gravar no media store (`<sessionId>_<msgId>_lp.jpg`), sempre,
   **sem** consultar `autoDownloadMedia` (já veio na mensagem, sem tráfego extra). Exceção: mensagem vinda do
   histórico/`append` com mais de 30 min (mesma janela da mídia) grava só os textos da prévia.
3. WHEN traz miniatura grande (`thumbnailDirectPath` + `mediaKey`) AND `shouldAutoDownloadGroupMedia` = true
   (contato = sempre, como a mídia; grupo = `autoDownloadMedia`) THEN SHALL baixar (`thumbnail-link`, teto 1 MiB
   contado no stream) e gravar no lugar da pequena. Falha = fica a pequena.
3b. Vale para tempo real **e** para histórico/entrega offline (`append`): mensagem que chegou com a API fora do ar
   também mostra a prévia.
4. WHEN não há miniatura THEN o cartão mostra só título, descrição e domínio.
5. O sistema SHALL NOT acessar a URL da prévia em nenhum momento.
6. URL só `http`/`https`; título ≤ 300 e descrição ≤ 500 caracteres; miniatura com tipo checado (JPEG) e teto
   (pequena 100 KB, grande 1 MiB). Fora disso o campo é descartado.
7. Mensagem enviada por nós com prévia (P1) SHALL aparecer no chat com o mesmo cartão, gravada pelo envio depois
   do retorno da engine. O eco desse envio SHALL ser ignorado pelo adapter (registro de eco), sem gravar arquivo nem
   baixar a miniatura de volta.
7b. Recarregar a conversa SHALL manter o cartão (vem na listagem, não só no tempo real).
8. Cartão abre o link em nova aba (`rel="noopener noreferrer"`), mostra domínio, funciona em claro/escuro.
9. Privacidade: flags `chat.linkPreviewImages` (miniatura) e `chat.linkPreviewText` (título, descrição, domínio;
   tooltip do domínio desligado com ela) em `privacyFlags.ts`; imagem com `filter: blur()`, textos com `<Blurred>`;
   layout não muda com a flag. O corpo da mensagem fica fora (o chat não borra corpo hoje).
10. Strings em `features/chat/strings.ts`.

### P2: Nome completo do grupo no hover

**User Story**: Como operador, quero ver o nome inteiro do grupo ao passar o mouse quando ele aparece cortado com
"…" nas listas do gerador e do monitoramento.

**Acceptance Criteria**:
1. WHEN o nome do grupo está cortado (texto maior que a largura) THEN hover/foco SHALL mostrar Tooltip MUI com o nome
   completo; WHEN cabe inteiro THEN SHALL NOT mostrar tooltip.
2. Toque no celular: abre ao tocar (`enterTouchDelay={0}`), fecha sozinho (`leaveTouchDelay={4000}`), padrão das
   telas de monitoramento.
3. Com borrar nomes ligado (flag da tela) THEN o tooltip SHALL NOT aparecer (não vaza o nome borrado).
4. Substitui o atributo nativo `title` onde ele existe hoje (aparência inconsistente e sem tema).
5. Locais (tabela em design §9): gerador `ConfigGroupsStep`, `OfferConfigSummary`, `OfferDispatchProgress`,
   `OfferChatPreview`, `GroupChip` (`OfferSendPanel`, `ConfigConfirmStep`); monitoramento `MonitoredGroupsCard`,
   `BroadcastGroupsCard`, `GroupPickerDialog`, `CapturedOffersList`, `SendQueuePanel`.
5b. `OfferDispatchProgress` hoje mostra o nome do grupo sem borrar: passa a respeitar `offers.groupNames`.
6. Claro/escuro pelo tema; acessível por teclado (foco no item mostra o tooltip).

### P3: Validação em aparelhos (gate para trocar o padrão)

1. Enviar oferta `LINK_PREVIEW` para grupo de teste e conferir em Android, iPhone e WhatsApp Web/Desktop:
   cartão grande, toque abre o link, nada na galeria. Registrar resultado no doc da feature.
2. Só depois disso avaliar `LINK_PREVIEW` como padrão (mudança separada).

---

## Requirement Traceability

| ID | Story | Design | Tasks |
| --- | --- | --- | --- |
| LP-SEND | P1 envio | §2, §3 | T3–T7 |
| LP-MODE | P1 formato | §4 | T1, T8, T9 |
| LP-IMG | P1 foto reduzida | §5 | T2 |
| LP-CHAT | P2 chat | §6, §7 | T10–T14 |
| LP-NAME | P2 nome do grupo | §9 | T16 |
| LP-QA | P3 | §8 | T15 |
