# Story de Oferta

Cola o link do produto → arte 1080×1920 pronta para o story do Instagram (foto, título curto, preço, cupom).
Roadmap item 11. Specs: `.specs/features/offer-story/` (`context`, `spec`, `design`, `tasks`). Termo de produto:
**Story de Oferta** (vitrine de planos: "Template para Instagram"). Nome técnico: `offer-story` (módulo
`api/src/modules/offer-story/`), `offerStory` (painel `app/src/features/offerStory/`).

A arte **não é salva no servidor** (nem banco nem storage; só na aba do painel, ver Persistência) e **não leva link**: o story usa o sticker de link do Instagram; a
resposta devolve `affiliateUrl` para o botão "Copiar link".

## Planos

- Entitlement booleano **`offer_story_enabled`**: Starter `false`, Profissional `false`, Business `true`
  (`tenants/domain/planPresets.ts`, travado em `planPresets.test.ts`).
- **Ausente = bloqueado**. Gate só com `getBoolean(...) === true` (`requireOfferStoryEnabled`).
- Migration de dados `20261030000000_add_offer_story_entitlement`: presets das 3 linhas (`false` **explícito** no
  Starter/Profissional, porque o sync só faz upsert; `true` no Business) + backfill de `tenant_entitlements` por
  `planSlug`, `ON CONFLICT DO NOTHING`. Sem a linha Business o JOIN não casa e o tenant fica 403.
- Sem o entitlement, toda rota `/api/offer-story/*` → `403 PLAN_FEATURE_UNAVAILABLE`; painel redireciona para
  `/plans?feature=offerStory` (aviso `featureNotice.offerStory`). Menu visível para todos com selo "Business".
- Downgrade: nada a pausar (sem dado persistido); `applyPlanSideEffects` não muda.

## Extração

- Só via `ResolveAffiliateProductUseCase` (`offersContainer.resolveAffiliateProduct()`, como a vitrine): allowlist
  (Shopee, Mercado Livre, Amazon), expansão anti-SSRF, dono do link. Erros `OFFER_*`/`AFFILIATE_*` sobem como estão (tabela de Erros).
- Não usa `GenerateOfferUseCase`: não grava `Offer` nem consome `offer_generations_per_day`.
- Shopee: link colado + `attributionVerified` do resolve (`false` → selo "comissão não verificada").
- Título nulo → `422 OFFER_STORY_PRODUCT_INCOMPLETE`.
- Foto via `IOfferImageFetcher` (≤ 5 MiB, allowlist de CDN). Falha ou imagem que o `sharp` não abre → arte sem foto +
  aviso `NO_IMAGE`.

## Renderer

`IOfferStoryRenderer` → `SatoriOfferStoryRenderer`: `satori` (árvore `{ type, props }`, sem React, `lineClamp`) →
`@resvg/resvg-js` (SVG→PNG) → `sharp` JPEG q85 mozjpeg, sem EXIF. Foto normalizada antes (`limitInputPixels` 40 MP,
`rotate`, ≤ 800×800).

- Fontes OFL versionadas em `api/assets/offer-story/fonts/` (Inter 400/700/800, Anton, Pacifico, Poppins 700/900, Archivo Black,
  Caveat Brush, DM Serif Display normal/itálico + `OFL-*.txt`; `.woff` latin),
  lidas uma vez (lazy) de `OFFER_STORY_FONTS_DIR` (`offerStoryFonts.ts`), resolvido por `__dirname` (mesma
  profundidade em `src/` e `dist/`), não por `process.cwd()`.
- `api/Dockerfile` (runner): `COPY assets ./assets`. Sem isso a arte quebra em produção.
- `RenderSlots`: **2 renders simultâneos** + fila de no máx. **8 à espera** por processo (CPU; não é estado
  operacional). Ao liberar, o slot passa direto ao próximo da fila. Fila cheia → `503 MEDIA_PROCESSOR_UNAVAILABLE`.
- **`boxShadow` com blur ≤ 50 px.** Blur maior faz o `resvg` 2.6.2 dar panic (`geom.rs` unwrap), que não é
  capturável e derruba o processo da API. Regra em `StickerOptions` (`storyParts.ts`); teste roda os casos extremos
  dos 8 templates.
- Plano B se `satori`/`resvg` falhar no Alpine: `@napi-rs/canvas` atrás da mesma porta.

## Templates

- Catálogo no domínio: `offer-story/domain/offerStoryTemplates.ts` (`OFFER_STORY_TEMPLATES`, ids estáveis:
  `flash-night`, `blue-burst`, `pink-week`, `gold-neon`, `fresh-mint`, `hot-deal`, `clean-light`, `news-violet`).
  Arte original em código (gradientes, formas, fontes OFL); texto da arte em pt-BR.
- Layout de cada template em `offer-story/infrastructure/adapters/templates/layouts/<id>.ts`; peças comuns (foto em
  sticker, preço, selo `-X% OFF`, cupom, chamada "Toque no link" com área do sticker) em `storyParts.ts`; dados
  derivados (`offPercent`) em `storyLayoutModel.ts`. Conteúdo só entre y 220 e 1720 (zonas seguras do Instagram).
  Sem estrelas de 4 pontas/brilhinhos.
- Thumbnails 360×640 em `app/public/assets/offer-story/<id>.webp`, gerados pelo mesmo renderer:
  `pnpm story:thumbs` (na `api/`). `offerStoryTemplates.test.ts` exige 1 arquivo por id.
- Template novo: id no catálogo + layout + `pnpm story:thumbs`.

## Regras de preço (`computeStoryPrice`, função pura)

| Entrada | "De" (riscado) | "Por" |
| --- | --- | --- |
| sem desconto, `original > price` | `original` | `price` |
| sem desconto, sem `original` maior | — | `price` |
| desconto `d%` | `original` se `original > price`, senão `price` | `round(price × (100 − d) / 100)` |
| `price` nulo | — | — (sem bloco de preço, aviso `NO_PRICE`) |
| desconto que arredonda para R$ 0,00 | — | — (sem bloco de preço, aviso `NO_PRICE`) |

Preço nunca é inventado: vem do produto extraído ou do desconto digitado.

## Cupom

- Opcional ("Tem cupom?"). Código obrigatório quando ligado; `normalizeCoupon` (`offerCoupon.ts`), mesmo charset do
  gerador (letras, números, `_ . -`, espaço), **máx. 20** na arte (gerador aceita 40). Fora disso → `422
  OFFER_INVALID_INPUT` (`field: 'coupon'`). Painel valida igual antes de enviar (`productForm.ts`).
- Desconto % inteiro 1–90, opcional; desconto sem código → 400 (schema). Cupom sem % não muda preço.
- Arte mostra selo "CUPOM: <CÓDIGO>".

## Título com IA

`IAiTextGenerator` (purpose `offer_story_headline`) encurta o título; `sanitizeStoryHeadline` tira aspas/emoji/
quebras, corta em 60 e rejeita vazio ou com preço. Erro/inválido/IA indisponível → título original com `lineClamp` de
2 linhas e aviso `AI_FALLBACK`; a arte sai mesmo assim. Gasto em `ai_usage_logs` e no teto diário existente.
Imagem e título rodam em paralelo.

## Resposta

JSON padrão (`httpResponse.ok`), `image` em data URL base64 (~0,5 MB):

```ts
{ image, width: 1080, height: 1920, templateId, headline, provider, affiliateUrl, attributionVerified,
  price: { fromCents, toCents }, coupon: { code, discountPercent } | null,
  warnings: Array<'NO_IMAGE' | 'NO_PRICE' | 'AI_FALLBACK'> }
```

Por que não binário: com `responseType: 'blob'` o corpo do erro vira Blob e o painel perde o `code` (gate
`PLAN_FEATURE_UNAVAILABLE`). Storage + URL exigiria job de limpeza. CSP do painel já aceita `img-src data: blob:`.

## Rotas (`/api/offer-story`, auth + tenant + gate)

| Método | Rota | Use case | Limite |
| --- | --- | --- | --- |
| GET | `/templates` | `ListOfferStoryTemplatesUseCase` (`data: { templates: [{ id, name }] }`, ordem do catálogo) | — |
| POST | `/render` | `RenderOfferStoryUseCase` | `offerStoryRender` 60/h por tenant por instância |

Body do render: `{ templateId (1–40), url (1–2048), coupon?: { code (1–60), discountPercent? 1–90 } }`,
`additionalProperties: false`. Teto de 20 do código fica no use case (422), não no schema.

## Erros

| Código | HTTP |
| --- | --- |
| `OFFER_STORY_TEMPLATE_NOT_FOUND` | 400 |
| `OFFER_STORY_PRODUCT_INCOMPLETE` | 422 |
| `PLAN_FEATURE_UNAVAILABLE` | 403 |
| `OFFER_PRODUCT_NOT_FOUND` | 404 |
| `OFFER_*` (URL, dono, afiliado), `OFFER_INVALID_INPUT` | 422 |
| `AFFILIATE_API_ACCESS_DENIED`, `AFFILIATE_CREDENTIAL_REJECTED` (Shopee: API não liberada / credencial recusada) | 422 |
| `AFFILIATE_API_RATE_LIMITED` | 429 |
| `AFFILIATE_API_UNAVAILABLE` | 503 |
| `MEDIA_PROCESSING_FAILED` (renderer) | 422 |
| `MEDIA_PROCESSOR_UNAVAILABLE` (fila do renderer cheia, ver `RenderSlots`) | 503 |
| `RATE_LIMITED` | 429 |

Novos em `shared/errors/internal/OfferStoryErrors.ts`; o resto é reuso.

## Painel (`/offer-story`, 3 passos)

Cabeçalho `OfferStoryHero`: ícone no "anel de story", promessa curta, indicador de etapas (`<ol>` com
`aria-current="step"`; no xs só a etapa atual mostra o nome) e leque decorativo de 3 miniaturas (md+).

1. **Template**: galeria sem moldura (cantos 16px, sombra, elevação no hover; 2/3/4/6 colunas xs/sm/md/lg), seleção =
   anel em gradiente + selo de check, estrela em pílula de vidro, abas Todos/Favoritos em pílula com contagem. Barra
   de ação mostra o template escolhido; fixa no rodapé no xs.
2. **Produto**: md+ em duas colunas — formulário à esquerda, prévia do template em `DeviceFrame` à direita (com
   "Trocar visual" e os campos que entram na arte). Link, cartão "Tem cupom?" (`Switch`), código, desconto; erro por
   código no campo. "Gerar arte" abre `GeneratingOverlay` com 3 etapas visuais (ritmo fixo de 1,6 s; a API não
   reporta progresso, a última fica girando até a resposta).
3. **Compartilhar**: título de sucesso com ícone `CircleCheckBig` (sem sparkles/brilhos — pedido do dono), lavagem
   suave atrás do celular, arte em `DeviceFrame`
   (bezel fino; a "ilha" fica no bezel, nunca sobre a arte), "Compartilhar no Stories" (botão em gradiente) só com
   `navigator.canShare({ files })`, "Baixar imagem" sempre (`story-oferta-<data>.jpg`; ícone no xs quando há
   compartilhar), cartão do link com "Copiar link", passo a passo "Como postar"; "Editar" volta ao 2, "Nova arte"
   limpa e volta ao 1. Em 390×844 as ações ficam acima da dobra (celular limitado a ~38dvh).

- Visual: gradiente "anel de story" e lavagens em `storyStyle.ts`, montados só com tokens do tema
  (`warning`/`error`/`secondary`/`primary` + `alpha`). Não usar hex fixo nem moldura grossa em volta das miniaturas.
- Persistência (aba, `sessionStorage`): `usePersistedState('offerStory.wizard')` v1 (passo, template, link, cupom,
  código, desconto) e, em chave própria, a arte gerada + metadados `offerStory.result` v1 (`usePersistedResult` no
  `useOfferStoryWizard`). Reload no passo 3 mostra a mesma arte e ações. Restauração valida a forma (`restoreResult`:
  `data:image/jpeg;base64,`, campos tipados) e a página descarta arte de template fora do catálogo
  (`dropStaleResult`) → cai no passo 2 com os campos. Cota estourada: o salvo é apagado antes de gravar, então a arte
  nova vale só em memória e o reload volta ao passo 2 (sem arte antiga, sem erro). Reload durante a geração volta ao
  passo 2. "Editar" descarta a arte e mantém os campos; nova geração substitui; "Nova arte" limpa rascunho e arte.
  Não usar `localStorage` para a arte nem salvá-la no servidor.
- Favoritos: `usePersistedState('offerStory.favorites', [], { scope: 'browser' })`; ids fora do catálogo ignorados.
  Perde ao trocar de navegador (aceito).
- Aba da grade (Todos/Favoritos): `usePersistedState('offerStory.templateTab')` escopo `tab`.
- Privacidade: `offerStory.art` (arte do passo 3) e `offerStory.link` (texto do link no passo 3 via
  `Blurred`; input do link no passo 2 via `sx`; o botão "Copiar link" não é borrado) em `privacyFlags.ts`.
- `isPlanFeatureUnavailable` movido para `features/plans/planGate.ts` (compartilhado com a vitrine).
- Textos em `strings.ts`; só tokens do tema (claro/escuro/sistema).

## O que não fazer

- Não chamar `GenerateOfferUseCase` nem duplicar allowlist/expansão: só `ResolveAffiliateProductUseCase`.
- Não fazer hotlink da imagem do marketplace na arte: sempre bytes via `IOfferImageFetcher`.
- Não depender de fonte do sistema nem de `<text>` no `sharp`; fonte nova vai para `api/assets/offer-story/fonts/`
  com a licença OFL.
- Não gravar arte no storage nem no banco; não devolver binário cru (quebra o gate do painel).
- Não tratar `offer_story_enabled` ausente como liberado.
- Não chamar adapter de IA direto: `IAiTextGenerator`, sempre com fallback.
- Não pôr link de afiliado na arte; não inventar preço.
- Não copiar arte de terceiros nos templates (direito autoral).
- Não remover `COPY assets ./assets` do `api/Dockerfile`.
- Não rodar a migration local contra `api/.env` (produção).

## Pendências e riscos aceitos

- Shopee: link do tenant gerado pela credencial (como a vitrine) fica para a fase 2; hoje vale o link colado.
- Editar título/preço antes de gerar, templates do tenant, formato feed 1080×1350, histórico de artes: fase 2.
- Rate limit e semáforo em memória por instância: teto efetivo 60 × instâncias http (mesma pendência da vitrine,
  `arquitetura-escala.md`). Mover render para worker se p95 > 2 s.
- Tenants de produção sem `planSlug` ficam bloqueados até evento do hub ou concessão manual.
- Decisões **(proposta)** de `context.md` (link Shopee, cupom 20, 8 templates, limite 60/h, favoritos no navegador)
  a confirmar com o dono.

## Mapa de arquivos

| Camada | Caminho |
| --- | --- |
| Domínio | `offer-story/domain/` (`offerStoryTemplates.ts`, `offerStoryRules.ts`, `services/computeStoryPrice.ts`, `services/storyHeadline.ts`, `contracts/IOfferStoryRenderer.ts`) |
| Use cases | `offer-story/application/use-cases/` (`ListOfferStoryTemplatesUseCase`, `RenderOfferStoryUseCase`, `offerStoryUseCaseDeps.ts`) |
| Infra | `offer-story/infrastructure/` (`adapters/SatoriOfferStoryRenderer.ts`, `adapters/offerStoryFonts.ts`, `adapters/templates/`, `offerStoryContainer.ts`, `scripts/renderOfferStoryThumbnails.ts`) |
| Rotas | `offer-story/presentation/routes/offerStory.routes.ts`; preset em `shared/http/rateLimitPresets.ts` |
| Erros | `shared/errors/internal/OfferStoryErrors.ts` |
| Plano | `tenants/domain/entitlementKeys.ts`, `planPresets.ts`; migration `20261030000000_add_offer_story_entitlement` |
| Assets | `api/assets/offer-story/fonts/`, `app/public/assets/offer-story/<id>.webp` |
| Painel | `app/src/features/offerStory/`, `features/plans/` (`planGate.ts`, `strings.ts`), `features/privacy/privacyFlags.ts` |
