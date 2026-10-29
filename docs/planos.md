# Planos — vitrine no painel

Item do roadmap: **7. Planos e limites** (`produto-roadmap.md`). Plano de implementação completo (modal, plano atual,
checkout, suporte): `.specs/features/plans-modal/spec.md`. Este doc registra o que **está** no código.

## O que existe (app 0.44.0)

| Peça | Onde | Nota |
| --- | --- | --- |
| Item "Planos" no menu | `app/src/app/AppLayout.tsx` (`NAV_ITEMS`, ícone `Crown`) | Rota, não ação. Fica acima de Privacidade |
| Página `/plans` | `app/src/pages/plans/PlansPage.tsx` | Hero (banner) + 3 cards + faixa de confiança + nota |
| Catálogo de vitrine | `app/src/features/plans/catalog.ts` | Slug, nome, tagline, preço de/por, benefícios (com `hint` para Tooltip), limites |
| Textos | `app/src/features/plans/strings.ts` | pt-BR, chaves semânticas; `formatPrice` com `Intl.NumberFormat` |
| Componentes | `features/plans/components/` | `PlansHero`, `PlanCard`, `PlansTrustStrip`, `GuaranteeSeal` |
| Teste | `features/plans/catalog.test.ts` | 3 planos, 1 recomendado, preço por < de, limites crescentes |

Referência visual: `pulsosocial_api/lp-pulsosocial/src/components/Pricing.tsx` e a extensão do Pulso. Estrutura copiada
(hero com coroa, selo de garantia, card recomendado com moldura em gradiente, faixa de confiança); cores só do tema
(`primary` → `secondary` no gradiente, `alpha()`), sem hex fixo fora do selo dourado.

## Decisões

- **Preço é texto de marketing.** Vive só em `catalog.ts`. Nada no banco, nenhum cálculo de desconto/cupom
  (`arquitetura-central-billing.md`). O chip "economize" é `priceFrom - price`, apresentação, não regra.
- **Página, não modal** (decisão do owner em 2026-10-28, muda a spec). Os avisos de limite (`PLAN_LIMIT_REACHED`)
  vão linkar para `/plans` quando entrarem.
- **Sem dado sensível** na tela: sem flag de privacidade. Se um chip com nome do tenant entrar, aí sim.
- **Toggle mensal/anual** no banner, anual por padrão (como no Pulso). Período em `usePersistedState('plans.period')`.
  Preço anual = `priceAnnualMonthly` por plano (≈ −20%, arredondado: 77/133/197). **Provisório** até o owner fixar o
  valor; mudar só no `catalog.ts` e em `ANNUAL_DISCOUNT` (selo do toggle).

## Pendências (fora deste entregável)

1. `planSlug` no `GET /me` → destacar plano atual (card e chip no menu). Spec T1.
2. `VITE_BILLING_CHECKOUT_URL` + `buildCheckoutUrl(slug, period, search)` → botão sai do `#`. Spec T3/T10.
3. `VITE_SUPPORT_WHATSAPP_NUMBER` → CTA de suporte quando checkout ausente. Spec T3.
4. Confirmar preço anual por plano (hoje ≈ −20% arredondado) e se o "de" riscado no anual mostra o mensal (atual) ou o preço cheio.
5. ~~Teste de consistência dos `limits` do catálogo com o seed de `PlanEntitlementPreset`.~~ Feito (api 0.42.0): `tenants/domain/planPresets.ts` + `planPresets.test.ts` travam os números da vitrine; o seed lê de lá. Rodízio de links (`link_rotations`/`link_rotation_groups`): 1/1/2 links e 3/5/10 grupos por link (Starter/Profissional/Business), presets na migration `create_link_rotation` — ver `rodizio-de-links.md`.

## O que não fazer

- Não calcular preço nem gravar preço no banco; não chamar a central do navegador.
- Não usar hex fixo nos cards: `theme.palette` + `alpha()`.
- Não criar segundo catálogo (LP, extensão): a vitrine do painel é `catalog.ts`.
- Não mostrar a tabela do roadmap com emoji: ícones Lucide via `AppIcon`.
