# Story de Oferta — Tarefas

Branch `feature/offer-story` a partir de `feature/rebranding-app`; merge de volta nela. Commits atômicos
`tipo(offer-story): …`. Cada task fecha com `pnpm tsc --noEmit` + testes do pacote tocado.

| # | Task | Arquivos | Verificação |
| --- | --- | --- | --- |
| T1 | **Spike** renderer: `satori` + `@resvg/resvg-js` + `sharp` gerando 1080×1920 com 1 fonte e 1 imagem, dentro do `docker build` da API (Alpine/musl). Falhou → plano B `@napi-rs/canvas` e atualizar `design.md` | `api/package.json`, `api/pnpm-lock.yaml` (Docker usa `--frozen-lockfile`), script descartável | JPEG abre, texto com a fonte certa, tempo < 1 s |
| T2 | Fontes OFL + `OFL.txt`; `COPY assets ./assets` no runner | `api/assets/offer-story/fonts/`, `api/Dockerfile` | `docker build` + arquivo presente em `/app/assets` |
| T3 | Domínio: regras, `computeStoryPrice`, `sanitizeStoryHeadline`, contrato do renderer | `offer-story/domain/**` | Testes da tabela de preço e do sanitize |
| T4 | Entitlement: chave, presets, teste de trava, migration de dados | `entitlementKeys.ts`, `planPresets.ts(.test)`, `prisma/migrations/<ts>_add_offer_story_entitlement/` | Teste verde; migration **não** roda local (`api/.env` = produção) — validar SQL em Postgres descartável |
| T5 | Erros `OfferStoryErrors.ts` + teste | `shared/errors/internal/` | Código/status |
| T6 | Use cases `ListOfferStoryTemplatesUseCase`, `RenderOfferStoryUseCase` + fakes | `offer-story/application/**` | Gate (false/ausente → 403), template inexistente, cupom inválido, título nulo, foto falha → `NO_IMAGE`, IA falha → `AI_FALLBACK`, preço nulo → `NO_PRICE`, desconto aplicado |
| T7 | Templates v1 (8 originais) + `SatoriOfferStoryRenderer` + fontes lazy + semáforo | `offer-story/domain/offerStoryTemplates.ts`, `infrastructure/adapters/**` | Teste do adapter: 1080×1920 JPEG por template, título longo não estoura (`lineClamp`) |
| T8 | Container, rotas, rate limit preset, registro | `offerStoryContainer.ts`, `offerStory.routes.ts`, `rateLimitPresets.ts`, `app/routes.ts` | `inject` 403/200/429 |
| T9 | Thumbnails: script + 8 WebP + teste 1 arquivo por id | `offer-story/infrastructure/scripts/renderOfferStoryThumbnails.ts`, `api/package.json` (`story:thumbs`), `app/public/assets/offer-story/`, `offer-story/domain/offerStoryTemplates.test.ts` | Teste do catálogo |
| T10 | Painel: service, tipos, strings, planGate (mover `isPlanFeatureUnavailable` para `features/plans/`), rota, menu, ícone, selo "Business", aviso em `/plans` | `features/offerStory/**`, `services/`, `AppRoutes.tsx`, `AppLayout.tsx`, `pages/modules`, `features/plans/**`, `storefront/hooks/useStorefrontPage.ts` (import), `planGate.test.ts` dividido (`plans/` cobre `isPlanFeatureUnavailable`; `storefront/` fica com `storefrontUpgradePath`) | Não-Business cai em `/plans?feature=offerStory` com aviso |
| T11 | Passos 1–3, overlay, favoritos, share/download/copiar, persistência, privacidade | `features/offerStory/**`, `privacyFlags.ts` | Testes de `productForm`, `shareImage`, wizard (reload no passo 3 → passo 2) e flags |
| T12 | QA visual com agent-browser (claro/escuro, desktop/celular, 3 passos, erro de link, upgrade) | — | Prints revisados com ui-ux-pro-max |
| T13 | Docs + versões: `docs/story-de-oferta.md`, `AGENTS.md`, roadmap item 11 (módulo `offer-story`, status ✅) e linha 105 ("Story" só Business), `CHANGELOG.md`, `api` 0.47.0, `app` 0.53.0 | docs | Links válidos |

## Riscos

| Risco | Mitigação |
| --- | --- |
| `@resvg/resvg-js`/`satori` não rodam no Alpine ou no CJS da API | T1 antes de tudo; plano B `@napi-rs/canvas` atrás de `IOfferStoryRenderer` |
| CPU do render na instância http | Semáforo 2 por instância + 60/h por tenant por instância (teto efetivo × instâncias; aceito, como na vitrine); medir no T1; mover para worker se p95 > 2 s |
| Resposta ~0,5–0,7 MB em base64 | JPEG q85 + mozjpeg; medir no T7 |
| Web Share com arquivo indisponível (desktop, Firefox) | Botão só com `canShare`; "Baixar" sempre visível |
| Tenants de produção sem `planSlug` ficam bloqueados | Igual à vitrine: evento do hub ou concessão manual |
