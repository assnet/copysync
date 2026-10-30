# Story de Oferta — Desenho

Spec: [`spec.md`](spec.md) · decisões: [`context.md`](context.md).

## Visão

```
Painel (3 passos) ── GET  /api/offer-story/templates ─▶ ListOfferStoryTemplatesUseCase ─▶ catálogo (domínio)
                  └─ POST /api/offer-story/render ────▶ RenderOfferStoryUseCase
                                                         ├ requireOfferStoryEnabled (entitlement)
                                                         ├ ResolveAffiliateProductUseCase (campaigns)
                                                         ├ IOfferImageFetcher (campaigns)      ┐ em paralelo
                                                         ├ IAiTextGenerator (assistants)       ┘ com fallback
                                                         ├ computeStoryPrice (domínio, puro)
                                                         └ IOfferStoryRenderer → SatoriOfferStoryRenderer
                                                              (satori → resvg → sharp JPEG)
```

Nada é gravado no banco nem no storage. Única mudança de banco: data migration do entitlement.

## API — módulo `api/src/modules/offer-story/`

### Domínio

| Arquivo | Conteúdo |
| --- | --- |
| `domain/offerStoryTemplates.ts` | `OFFER_STORY_TEMPLATES: readonly OfferStoryTemplate[]` — `{ id, name, size: { width: 1080, height: 1920 }, palette, headline: { lines: string[], font, style }, layout }`; `findOfferStoryTemplate(id)` |
| `domain/services/computeStoryPrice.ts` | Função pura da tabela de preço do spec → `{ fromCents: number \| null, toCents: number \| null }` |
| `domain/services/storyHeadline.ts` | `sanitizeStoryHeadline(raw)` (tira aspas/emoji/quebras, ≤ 60, rejeita vazio ou com dígito de preço `R$`) |
| `domain/offerStoryRules.ts` | `OFFER_STORY_COUPON_MAX = 20`, `OFFER_STORY_DISCOUNT_MIN = 1`, `OFFER_STORY_DISCOUNT_MAX = 90`, `OFFER_STORY_HEADLINE_MAX = 60`, `OFFER_STORY_HEADLINE_AI_PURPOSE = 'offer_story_headline'` |
| `domain/contracts/IOfferStoryRenderer.ts` | `render(input: OfferStoryRenderInput): Promise<{ buffer: Buffer; mimeType: 'image/jpeg'; width; height }>`; `OfferStoryRenderInput { template, headline, productImage: Buffer \| null, price, coupon: { code, discountPercent: number \| null } \| null }` |

### Aplicação

`application/use-cases/offerStoryUseCaseDeps.ts`:

```ts
export function requireOfferStoryEnabled(entitlements: IEntitlementReader, tenantId: string): Promise<void>
// getBoolean(...) === true, senão PlanFeatureUnavailableError(ENTITLEMENT_KEYS.OFFER_STORY_ENABLED)
```

`ListOfferStoryTemplatesUseCase.execute({ tenantId })` → gate → `{ templates: [{ id, name }] }` (ordem do catálogo).

`RenderOfferStoryUseCase.execute({ tenantId, templateId, url, coupon? })` (`coupon.discountPercent ?? null` ao montar renderer e DTO):

1. Gate.
2. `findOfferStoryTemplate` → senão `OfferStoryTemplateNotFoundError` (400).
3. Cupom: `normalizeCoupon(code)` (`campaigns/.../offerCoupon.ts:8`); retorno `null` (só espaços) ou `length > 20` →
   `OfferInvalidInputError` (422, `field: 'coupon'`); `discountPercent` sem código já barrado no schema.
4. `resolveProduct.execute(tenantId, url)` — erros `OFFER_*` sobem como estão (422).
5. `resolved.product.title` nulo → `OfferStoryProductIncompleteError` (422).
6. `Promise.all`: `imageFetcher.fetch(resolved.product.imageSourceUrl)` (null se sem URL) e `headline()`:
   `ai.generate({ tenantId, purpose: OFFER_STORY_HEADLINE_AI_PURPOSE, system, prompt: title, maxOutputTokens: 80 })`
   → `sanitizeStoryHeadline`; qualquer erro/inválido → título original, `AI_FALLBACK`.
7. Imagem baixada que o `sharp` não abre → `null` + `NO_IMAGE` (não falha a arte).
8. `computeStoryPrice(resolved.product, discountPercent)` (`priceCents`/`originalPriceCents`; `affiliateUrl`/`attributionVerified`/`provider` vêm do topo de `resolved`); `toCents` nulo → `NO_PRICE`.
9. `renderer.render(...)` — erro → `MediaProcessingFailedError` (422).
10. Saída (DTO, sem entidade):

```ts
{
  image: `data:image/jpeg;base64,${...}`, width: 1080, height: 1920, templateId,
  headline, provider, affiliateUrl, attributionVerified,
  price: { fromCents, toCents }, coupon: { code, discountPercent: number | null } | null,
  warnings: Array<'NO_IMAGE' | 'NO_PRICE' | 'AI_FALLBACK'>
}
```

### Infraestrutura

| Arquivo | Conteúdo |
| --- | --- |
| `infrastructure/adapters/SatoriOfferStoryRenderer.ts` | Monta a árvore (objetos `{ type, props }`, sem React/JSX) por template; `satori(tree, { width, height, fonts })` → `new Resvg(svg).render().asPng()` → `sharp(png).jpeg({ quality: 85, mozjpeg: true })`. Foto do produto normalizada antes por `sharp(buf, { limitInputPixels: 40e6 }).rotate().resize(800, 800, { fit: 'inside' }).png()` → data URI. Semáforo interno de 2 renders simultâneos (CPU, não é estado operacional) |
| `infrastructure/adapters/offerStoryFonts.ts` | Lê uma vez (lazy, memo) os TTF de `path.resolve(process.cwd(), 'assets/offer-story/fonts')` |
| `infrastructure/offerStoryContainer.ts` | Lazy como `storefrontContainer`: `entitlements`, `resolveProduct: offersContainer.resolveAffiliateProduct()`, `imageFetcher: new HttpOfferImageFetcher()`, `ai: assistantsContainer.aiTextGenerator()`, `renderer` |
| `api/assets/offer-story/fonts/` | Fontes OFL (ex.: Inter 400/700/800, Anton 400, Pacifico 400) + `OFL.txt` |

Dependências novas (versão exata, padrão do `package.json`): `satori`, `@resvg/resvg-js` (prebuilt
`linux-x64-musl` para o Alpine; sem postinstall). `api/Dockerfile` runner: `COPY assets ./assets`.

### Apresentação

`presentation/routes/offerStory.routes.ts`, registrado em `app/routes.ts` com prefixo `${env.API_PREFIX}/offer-story`.
`const preHandler = () => [authHook, tenantHook]` e `preHandler: preHandler()` por rota, como `storefront.routes.ts:32-33` (array novo por rota: `perTenantRateLimit` anexa hook nele).

| Método | Rota | Schema | Rate limit |
| --- | --- | --- | --- |
| GET | `/templates` | — | — |
| POST | `/render` | `{ templateId: string(1–40), url: string(1–2048), coupon?: { code: string(1–60), discountPercent?: integer 1–90 } }`, `additionalProperties: false` (teto do código fica no use case, 422 `OFFER_INVALID_INPUT`, não no schema) | `perTenantRateLimit(rateLimitPresets.offerStoryRender)` 60/hora por tenant por instância (store em memória; teto efetivo 60 × instâncias http — risco aceito, mesma pendência da vitrine em `docs/pagina-de-ofertas.md` "Pendências") |

Handlers finos: `httpResponse.ok(reply, out)`.

### Erros (`shared/errors/internal/OfferStoryErrors.ts`)

| Código | HTTP |
| --- | --- |
| `OFFER_STORY_TEMPLATE_NOT_FOUND` | 400 |
| `OFFER_STORY_PRODUCT_INCOMPLETE` | 422 |

Reusa `PLAN_FEATURE_UNAVAILABLE` 403, `OFFER_*` 422, `OFFER_INVALID_INPUT` 422, `MEDIA_PROCESSING_FAILED` 422,
`RATE_LIMITED` 429.

### Plano

- `ENTITLEMENT_KEYS.OFFER_STORY_ENABLED = 'offer_story_enabled'` (`tenants/domain/entitlementKeys.ts`).
- `planPresets.ts`: Starter `false`, Profissional `false`, Business `true`; `planPresets.test.ts` trava (`CATALOG_LIMITS`
  e linhas de `planPresetRows`).
- Migration `<ts>_add_offer_story_entitlement` (só dados), espelho de
  `20261029030000_add_storefront_and_public_slug_claims/migration.sql:156-170`: presets das **3** linhas (`COPYSYNC_STARTER` `false`,
  `COPYSYNC_PROFISSIONAL` `false`, `COPYSYNC_BUSINESS` `true`; `false` explícito porque o sync só faz upsert) +
  backfill `tenant_entitlements` por `planSlug` (sem a linha Business o JOIN não casa e o tenant fica 403), `ON CONFLICT DO NOTHING`.
- `applyPlanSideEffects`: sem mudança (nada persistido para pausar).

## Painel — `app/src/features/offerStory/`

| Arquivo | Papel |
| --- | --- |
| `OfferStoryPage.tsx` | Cabeçalho + MUI `Stepper alternativeLabel` (padrão `OfferConfigWizard.tsx:132`) + passo atual |
| `components/TemplateStep.tsx`, `TemplateCard.tsx` | Abas Todos/Favoritos com contagem, grade 9:16, estrela (`Tooltip` + `AppIcon`), seleção |
| `components/ProductStep.tsx` | Link, `Switch` "Tem cupom?", código, desconto; erro por código no campo |
| `components/GeneratingOverlay.tsx` | `Backdrop` com spinner e texto do spec |
| `components/ResultStep.tsx`, `PhoneFrame.tsx` | Arte em moldura, avisos (`Alert`), Compartilhar/Baixar/Copiar link, Editar/Nova arte |
| `hooks/useOfferStoryWizard.ts` | `usePersistedState('offerStory.wizard', …, { version: 1 })` (escopo `tab`): `{ step, templateId, url, couponEnabled, code, discount }`; resultado só em `useState`; passo 3 sem resultado → 2; `clear()` em "Nova arte" |
| `hooks/useOfferStoryFavorites.ts` | `usePersistedState<string[]>('offerStory.favorites', [], { scope: 'browser' })`; ignora id fora do catálogo |
| `hooks/useOfferStoryTemplates.ts` | `GET /templates`; `PLAN_FEATURE_UNAVAILABLE` → `navigate(offerStoryUpgradePath, { replace: true })` |
| `shareImage.ts` | `dataUrlToFile`, `canShareImage(file)` (`navigator.canShare?.({ files: [file] })`), `shareImage`, `downloadImage` (`<a download>` + `URL.revokeObjectURL`) |
| `planGate.ts` | `offerStoryUpgradePath = '/plans?feature=offerStory'` (reusa `isPlanFeatureUnavailable` de `storefront/planGate.ts` movendo-o para `features/plans/planGate.ts`; teste dividido: `plans/planGate.test.ts` cobre `isPlanFeatureUnavailable`, `storefront/planGate.test.ts` fica com `storefrontUpgradePath`) |
| `productForm.ts` | Validação local (mesmas regras do schema) e `OFFER_STORY_ERROR_CODES` → mensagem/campo |
| `strings.ts`, `types.ts` | Textos pt-BR (padrão `storefront/strings.ts`, sem lib de i18n no painel) e DTOs |
| `services/offerStory.service.ts` | `listTemplates()`, `render(input)` via `apiClient`, desembrulha `res.data.data` |

Outros pontos:

- Rota `/offer-story` em `routes/AppRoutes.tsx`; menu em `app/AppLayout.tsx` (`label: 'Story de Oferta'`,
  `badge: plansStrings.badgeBusiness`, novo em `features/plans/strings.ts`); ícone `offerStory` em `pages/modules`
  (Lucide `ImagePlus`).
- `features/plans/strings.ts` `featureNotice.offerStory`.
- Thumbnails estáticos em `app/public/assets/offer-story/<id>.webp` (360×640), gerados pelo mesmo renderer com
  produto de exemplo: `api/src/modules/offer-story/infrastructure/scripts/renderOfferStoryThumbnails.ts` (dentro de `src/` para o
  `tsc --noEmit` tipar; `"story:thumbs": "tsx src/modules/offer-story/infrastructure/scripts/renderOfferStoryThumbnails.ts"`
  em `api/package.json`). Teste co-locado
  `api/src/modules/offer-story/domain/offerStoryTemplates.test.ts` (vitest só inclui `src/**/*.test.ts`) exige 1 arquivo
  por id via `fs`.
- Privacidade (`privacyFlags.ts`): tela `offerStory` com `offerStory.art` (arte do passo 3) e `offerStory.link`
  (campo do link e "Copiar link"); `Blurred`/`useBlur` nesses pontos.
- Tema: só tokens do tema (claro/escuro/sistema); arte é imagem, moldura usa `divider`/`background.paper`.

## Documentação

`docs/story-de-oferta.md` (regras, rotas, planos, o que não fazer), linha no `AGENTS.md`, roadmap item 11 → ✅,
`CHANGELOG.md` (raiz, como a vitrine), `api/package.json` 0.47.0, `app/package.json` 0.53.0.

## O que não fazer

- Não chamar `GenerateOfferUseCase` nem duplicar allowlist/expansão: só `ResolveAffiliateProductUseCase`.
- Não fazer hotlink da imagem do marketplace na arte: sempre bytes via `IOfferImageFetcher`.
- Não depender de fonte do sistema nem de `<text>` no `sharp`.
- Não gravar arte no storage nem no banco; não devolver binário cru (quebra o gate do painel).
- Não tratar `offer_story_enabled` ausente como liberado.
- Não chamar adapter de IA direto: `IAiTextGenerator`, sempre com fallback.
