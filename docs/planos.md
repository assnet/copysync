# Planos — vitrine no painel

Item do roadmap: **7. Planos e limites** (`produto-roadmap.md`). Plano de implementação completo (modal, plano atual,
checkout, suporte): `.specs/features/plans-modal/spec.md`. Este doc registra o que **está** no código.

## O que existe (app 0.62.0)

| Peça | Onde | Nota |
| --- | --- | --- |
| Item "Planos" no menu | `app/src/features/navigation/model.ts` (filho do produto Afiliados, `AFFILIATE_PLANS_PATH`, ícone `Crown`; ver `docs/navegacao-produtos.md`) | Planos são por produto; cada produto novo terá a própria vitrine |
| Página `/affiliates/plans` (`/plans` redireciona com a query) | `app/src/pages/plans/PlansPage.tsx` | Hero (banner) + 3 cards + faixa de confiança + nota; no celular os cards viram carrossel por deslize (`SwipeCards`, `app/src/components/`) abrindo no PRO (`recommended`) |
| Catálogo de vitrine | `app/src/features/plans/catalog.ts` | Slug, nome, tagline, preço de/por, benefícios (com `hint` para Tooltip), limites |
| Textos | `app/src/features/plans/strings.ts` | pt-BR, chaves semânticas; `formatPrice` com `Intl.NumberFormat` |
| Componentes | `features/plans/components/` | `PlansHero`, `PlanCard`, `ChannelLimitsTable`, `PlansTrustStrip`, `GuaranteeSeal` |
| Teste | `features/plans/catalog.test.ts` | 3 planos, 1 recomendado, preço por < de, limites crescentes, limites por canal = presets da API |

Referência visual: `pulsosocial_api/lp-pulsosocial/src/components/Pricing.tsx` e a extensão do Pulso. Estrutura copiada
(hero com coroa, selo de garantia, card recomendado com moldura em gradiente, faixa de confiança); cores só do tema
(`primary` → `secondary` no gradiente, `alpha()`), sem hex fixo fora do selo dourado.

## Limites por canal (WhatsApp × Telegram)

- `limits` do catálogo espelha `api/src/modules/tenants/domain/planPresets.ts` por canal: `whatsappSessions`,
  `monitoredGroups`, `broadcastGroups` (sem prefixo = WhatsApp, como as chaves da API) e `telegramSessions`,
  `telegramMonitoredGroups`, `telegramBroadcastGroups`. LITE 1/1/5 e Telegram 0/0/0; PRO 1/2/10 nos dois; MAX 2/6/40
  nos dois. Travado em `catalog.test.ts` (e do lado da API em `planPresets.test.ts`).
- O card mostra esses números em `ChannelLimitsTable` (`features/plans/components/`): `<table>` semântica com
  `<caption>` oculta, linhas = Sessões / Grupos monitorados / Grupos de disparo (Tooltip com `PLAN_HINTS`), colunas =
  canal com logo (`WhatsAppIcon`/`TelegramIcon` via `AppIcon`, cor de `brandColor` por modo). Canal fora do plano
  vira uma célula única "A partir do PRO" (primeiro plano do catálogo que inclui o canal), sem traço nem "não incluso".
- Por isso a lista `benefits` **não** repete sessões/grupos (o teste barra "grupos monitorados/de disparo" nela).
- **Gestor de Links por canal**: `linkRotations`/`linkRotationGroups` (WhatsApp, chaves `link_rotations`/
  `link_rotation_groups`) e `telegramLinkRotations`/`telegramLinkRotationGroups` (`telegram_link_rotations`/
  `telegram_link_rotation_groups`). WhatsApp 1·3 / 1·5 / 2·10; Telegram 0 / 1·5 / 2·10 (LITE/PRO/MAX). Travado em
  `catalog.test.ts` e `planPresets.test.ts`. API: presets na migration
  `20261104130000_add_telegram_link_rotation_entitlement_presets`; enforcement e contrato `limits`/`usage` por canal do
  overview em `rodizio-de-links.md` ("Limites por plano"). Última linha da `ChannelLimitsTable` ("Gestor de Links", hint
  `PLAN_HINTS.linkRotation`): "1 link" em negrito e "até 5 grupos" embaixo, por canal (`linkRotationLimitParts`);
  colunas de 84 px para caber "até 10 grupos". Rodízio zerado num canal incluso vira "A partir do X" só na célula.
- O rodízio do WhatsApp **saiu** da lista `benefits` (a tabela já mostra; o teste barra "N link(s) · até"). O
  Telegram ganhou destaque em PRO e MAX: `BenefitRow` com `channel: 'telegram'`, `label`
  `TELEGRAM_LINK_ROTATION_LABEL` ("Gestor de Links no Telegram") e o limite em `detail` (segunda linha, campo novo
  de `PlanBenefit`), Tooltip `PLAN_HINTS.telegramLinkRotation` (link fixo que distribui entre grupos/canais; exige
  admin para gerar convite ou colar o link). Fica logo abaixo de "Telegram: monitore e envie em grupos e canais".
- **Cross Channel** (`CROSS_CHANNEL_NAME`): monitorar no Telegram e postar no WhatsApp e vice-versa; bloco em destaque no MAX com ícone dos dois logos (`featureIcon: 'channels'`). Hoje a regra da API permite em qualquer plano com os dois canais.
- **Cross Session** (nome de produto; `CROSS_SESSION_NAME` em `catalog.ts`): monitorar em uma sessão e disparar em outra do mesmo canal (`cross_session_dispatch`). Aparece como bloco em destaque (`featureName` no benefício, `FeatureRow` no `PlanCard`), é exclusivo do MAX e vale
  para 2+ sessões do mesmo canal; WhatsApp ↔ Telegram se cruzam em qualquer plano com os dois (benefício
  "Ofertas circulando entre WhatsApp e Telegram" no PRO, `PLAN_HINTS.bothChannels`).
- Avisos de limite: `PlanLimitKind` (`features/linkRotation/planUpsell.ts`) tem `whatsappMonitoredGroups`,
  `telegramMonitoredGroups`, `whatsappBroadcastGroups`, `telegramBroadcastGroups` além de sessões e rodízio
  (`rotations`/`groups` = WhatsApp; `telegramLinkRotations`/`telegramLinkRotationGroups` = Telegram);
  textos em `linkRotation/strings.ts` (`channelGroupsCopy`).

## Página de Ofertas (app 0.52.0)

- Benefício "Página de Ofertas" (`STOREFRONT_BENEFIT_LABEL`) só em PRO e MAX, espelhando
  `storefront_enabled` false/true/true (travado em `planPresets.test.ts`). Nunca no LITE.
- `PREMIUM_SLUG_OFFER` (`catalog.ts`): texto do banner de nome especial (título, benefícios, `priceLabel`,
  `checkoutUrl: null` → "Em breve"). Fica **fora** de `PLAN_CATALOG` (o teste conta 3 planos). Compra é placeholder.
- `/plans?feature=storefront` mostra o aviso de upgrade (`PlansFeatureNotice`); o painel redireciona para lá no
  `403 PLAN_FEATURE_UNAVAILABLE` da vitrine. Selo "PRO" no item do menu (`NavItemBadge`,
  `plansStrings.badgeProfessional`). Ver [`pagina-de-ofertas.md`](pagina-de-ofertas.md).

## Story de Oferta (app 0.53.0)

- Benefício "Template para Instagram" só no MAX, espelhando `offer_story_enabled` false/false/true (travado em
  `planPresets.test.ts`).
- `/plans?feature=offerStory` mostra o aviso (`featureNotice.offerStory`); o painel redireciona para lá no
  `403 PLAN_FEATURE_UNAVAILABLE` do story. Selo "MAX" no menu (`plansStrings.badgeBusiness`).
  `isPlanFeatureUnavailable` vive em `features/plans/planGate.ts`. Ver [`story-de-oferta.md`](story-de-oferta.md).

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
2. `VITE_BILLING_CHECKOUT_URL` + `buildCheckoutUrl(slug, period, search)` → botão sai do `#`. Spec T3/T10. As 6 ofertas da Cakto já existem (2026-11-06, tabela em [`plano-lancamento-hub-copysync.md`](plano-lancamento-hub-copysync.md#ofertas-do-copysync-na-cakto)); recomendação: botão direto para a URL da oferta por plano e período, sem `/planos/...` na central. Só ligar depois do H3 (webhook da aplicação).
3. `VITE_SUPPORT_WHATSAPP_NUMBER` → CTA de suporte quando checkout ausente. Spec T3.
4. Confirmar preço anual por plano (hoje ≈ −20% arredondado) e se o "de" riscado no anual mostra o mensal (atual) ou o preço cheio.
5. ~~Teste de consistência dos `limits` do catálogo com o seed de `PlanEntitlementPreset`.~~ Feito (api 0.42.0): `tenants/domain/planPresets.ts` + `planPresets.test.ts` travam os números da vitrine; o seed lê de lá. Gestor de Links por canal: ver "Limites por canal" acima e `rodizio-de-links.md`.

## O que não fazer

- Não calcular preço nem gravar preço no banco; não chamar a central do navegador.
- Não usar hex fixo nos cards: `theme.palette` + `alpha()`.
- Não criar segundo catálogo (LP, extensão): a vitrine do painel é `catalog.ts`.
- Não mostrar a tabela do roadmap com emoji: ícones Lucide via `AppIcon`.
- Não repetir limites de canal em `benefits` nem escrever "Telegram não incluso": a tabela de canais cobre os dois.
