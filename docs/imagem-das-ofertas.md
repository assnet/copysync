# Imagem das ofertas: foto oficial e marca d'água própria

Dois recursos independentes das lojas, api 0.105.0 · app 0.128.0, **visíveis só para super admin** (audiência) até a
liberação. Specs: `.specs/features/affiliate-marketplaces-expansion/` (IMG-01..15, tasks F5). Envio e prévia:
[`mensagens-previa-de-link.md`](mensagens-previa-de-link.md); monitoramento:
[`monitoramento-grupos.md`](monitoramento-grupos.md).

## Foto oficial do produto (remove marca de terceiros)

- Chave `offer_clean_image_enabled`: LITE `false`, PRO/MAX `true`; editável em `/admin/plan-entitlements`, rótulo
  "Foto oficial do produto"; flag "Só super admin" com valor inicial ligado.
- Opção por monitoramento `GroupMonitorConfig.useProductImage` (padrão `false`). Só o monitoramento tem foto
  capturada; gerador, caçador e mensagem só com link já usam a foto oficial.
- Efetiva = opção **e** chave `=== true`, montada pelo chamador em `ProcessPendingCapturedOffersUseCase`. Nos 3 pontos
  de `buildMonitorText`:
  1. texto ORIGINAL com foto: tenta a foto do produto (`productImageOnly`); sem ela → capturada;
  2. sem título/preço do produto: `product.imageUrl` (no storage); vazia → capturada;
  3. TEMPLATE/AI: a foto do produto já lida, sem segunda leitura; vazia → capturada.
- A oferta nunca deixa de sair por isso: loja sem foto, fora do ar ou erro → foto capturada.
- Escrita: `useProductImage = true` só com plano e, com a flag ligada, super admin; fora disso o valor é ignorado na
  escrita (o salvo fica) e omitido na leitura. `PUT` sem o campo (painel antigo) → 200.
- Custo (R9): uma leitura a mais na loja por captura, só no modo ORIGINAL com foto anexada e opção ligada.

## Marca d'água própria

- Chave `offer_watermark_enabled`: só MAX `true`; rótulo "Marca d'água própria"; flag "Só super admin" ligada de
  início.
- Tabela `offer_watermarks` (uma linha por tenant): `kind` `IMAGE` | `TEXT`, `imageKey`, `text` (1–32 caracteres, uma
  linha, sem controle), `enabled`, `position` (4 cantos ou `CENTER`), `size` `SMALL`/`MEDIUM`/`LARGE` (15/22/30 % do
  lado menor da foto, margem 4 %, `computeWatermarkPlacement`), `opacity` 20–100. Padrão: desligada, `IMAGE`,
  `BOTTOM_RIGHT`, `MEDIUM`, 80.
- **Logo OU texto, nunca os dois**: `kind` escolhe a fonte; trocar o tipo guarda o outro dado sem aplicá-lo.
- Logo: upload só por `chunkedUpload`; PNG ou WebP validado pelo conteúdo, ≤ 1 MiB, mínimo 100×100, normalizado para
  PNG com lado maior ≤ 512 px (`SharpOfferWatermarkLogoProcessor`). Trocar apaga o anterior do storage.
- Texto: renderizado com **satori + resvg**, Inter 800 de `api/assets/offer-story/fonts/` (`loadOfferStoryFonts`),
  branco com sombra dupla. Fonte ilegível lança (nunca cai em fonte do sistema). Prova na imagem alpine: smoke T32.
- **Aplicada no envio**, sobre a foto limpa (`OfferPreviewImage` → `TenantOfferImageDecorator` → sharp): vale para
  monitoramento, gerador e caçador (mesmo `ChatOfferMessageSender`). `Offer.imageUrl` **nunca** é regravado; mudar o
  ajuste vale no envio seguinte. Saem marcadas só as cópias do chat: `<sessão>_<id>_lp.jpg` (prévia, 600 e 192 px) e
  a mídia promovida no ramo `MEDIA`.
- Envio obedece plano + registro salvo, sem ler a audiência (IMG-13). Sem cache: registro e logo lidos a cada envio.
- Falha (logo ilegível, storage fora, erro de render) → foto sem marca + log `warn`; **nunca bloqueia** o envio.
- Página de Ofertas (vitrine) e Story: sem marca.

### Telegram com marca

No `LINK_PREVIEW` o Telegram monta a prévia nativa e descarta a nossa imagem. Por isso, **só no Telegram e só quando
`decorator.applies(tenantId)`** (plano + ligada + marca do tipo presente), o sender vai para o ramo `MEDIA`: foto
marcada com o texto na legenda. Uso restrito autorizado pelo dono em 2026-11-24; `MEDIA_IMAGE_MODE_ENABLED` segue
`false` (WhatsApp e Telegram sem marca não mudam). A decisão é do sender (aplicação), nunca do adapter.

- Legenda até **1024** caracteres (`TELEGRAM_CAPTION_MAX`, padrão sem Premium), medida em `[...text].length` do texto
  cru **antes** de escolher o ramo; acima → envio atual sem marca, com log.
- Oferta sem foto → texto, como hoje. Foto sumida do storage → envio atual (sem marca), sem falhar.
- Envio de mídia é assíncrono: falha depois de enfileirar deixa o envio `SENT` e a mensagem `FAILED`.

### Limitação conhecida (R13)

A prévia da oferta no painel (`OfferChatPreview`) sempre desenha cartão de link; para destino Telegram com marca o que
chega é foto com legenda. A página da marca avisa isso.

## Rotas (`/api/offer-watermark`, produto `AFFILIATES`)

| Método | Path | Faz |
|---|---|---|
| GET | `/access` | Só `authHook`: `{ visible }` = audiência **e** plano; nunca 403 (some o item de menu) |
| GET | `/` | Ajustes do tenant (padrões sem registro) |
| PUT | `/` | Ajustes parciais (`enabled`, `kind`, `text`, `position`, `size`, `opacity`); fora da regra → 422 `OFFER_WATERMARK_INVALID_INPUT` com `meta.field` |
| PUT | `/image` | `{ uploadId }` de upload concluído; erros de mídia padrão (`MEDIA_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`…) |
| DELETE | `/image` | Remove o logo (texto e ajustes ficam) |

Resposta: `{ enabled, kind, text, position, size, opacity, imageUrl, canEdit, updatedAt }` — logo só como URL, nunca a
chave do storage. Hooks: `authHook` + `tenantHook` + `withProduct` + `offerWatermarkAudienceHook`.

- Fora da audiência → **404** `NOT_FOUND` (recurso invisível).
- Sem plano → **403** `PLAN_FEATURE_UNAVAILABLE` (use case).
- Operador só lê: gravar exige `ADMIN` ou super admin (403 `FORBIDDEN`).

## Painel

- Monitoramento: switch "Usar a foto oficial do produto" no `MonitoringSettingsForm` (padrão `ToggleOption`, tooltip).
  Campo ausente na resposta → switch não aparece. `limits.cleanImageEnabled: false` → travado, desligado, selo PRO.
  Rascunho do monitor: `SETTINGS_DRAFT_VERSION` 7.
- Página `/offer-watermark` (`features/offerWatermark/`), item "Marca d'água" no produto Afiliados, depois do Caçador
  de Ofertas. Aparece só com `watermarkVisible` (`useOfferWatermarkAccess` → `GET /access`, em `AppLayout`); guard
  `OfferWatermarkRoute`. 403 de plano = estado na página com selo MAX e "Ver planos"; `canEdit=false` = só leitura.
- Rascunho dos ajustes em `usePersistedState` (escopo `tab`), limpo ao salvar; logo nunca no storage do navegador.
  Privacidade: flag `offerWatermark.logo` borra logo e texto na página e na prévia.
- Prévia: `features/offerWatermark/rules.ts` é cópia de `computeWatermarkPlacement` (teste fixa os números da API nas
  5 posições). Mudou a regra na API → mude a cópia. Texto: altura estimada pela fonte, pode diferir alguns pixels.
- Tela sem contagem em `/admin/usage` (exigiria mudar `contracts/feature-usage/catalog.json`).

## Migrations

`20261124090400_add_offer_image_entitlements` (presets + backfill `ON CONFLICT DO NOTHING`) ·
`…090500_add_monitor_use_product_image` · `…090600_create_offer_watermarks`. Rodam no boot da Render; nunca local.

## Pendências

- T32: envio real (WhatsApp com logo e com texto; Telegram com e sem marca) e prova da fonte na imagem alpine.
- T34: smoke do dono. R11: programa de afiliado pode restringir alterar a foto do produto (dono decide).
- Liberação (T24) por chave, uma de cada vez.

## O que não fazer

- Editar a foto capturada (recorte, borrão, IA/inpainting) para tirar marca de terceiro.
- Regravar `Offer.imageUrl` com a marca ou gravar por cima da foto limpa.
- Bloquear envio por falha na marca d'água.
- Aplicar a marca na vitrine ou no Story; logo e texto na mesma foto; fonte do sistema no texto.
- `sharp`/satori fora da infraestrutura; logo do tenant em `localStorage`/`sessionStorage`.
- Ligar `MEDIA_IMAGE_MODE_ENABLED` ou mandar foto anexada no WhatsApp ou no Telegram sem marca ativa.
- Decidir o ramo do Telegram dentro do adapter da engine; medir a legenda sobre o HTML convertido.
- Responder 403 para quem está fora da audiência (é 404); devolver a chave do storage do logo.
- Cache em memória do registro ou do logo.
