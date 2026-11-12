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

## Margem de infraestrutura (app 0.108.0)

A tela de custos do super admin (`/admin/costs`, [`custos-infraestrutura.md`](custos-infraestrutura.md)) compara o
custo por tenant em R$ com `price` e `priceAnnualMonthly` de `PLAN_CATALOG` (`features/infraCosts/rules.ts`,
`planMargin`). A conta é só do painel: o preço segue fora do banco e a API de custos nunca recebe nem devolve preço de
plano. Mudou preço no `catalog.ts` → a margem acompanha sem mudança na API.

**Por cliente (app 0.110.0)**: a aba Por cliente (`/admin/costs/tenants`) mostra a margem de cada tenant = preço do
plano dele no `PLAN_CATALOG` − custo do cliente em R$ (compartilhado + IA da plataforma; `tenantMarginCost`). Mesma
regra: o preço nunca vai à API; tenant sem plano do catálogo fica sem margem.

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

## Etiquetas do Mercado Livre (app 0.99.0)

- `limits.mercadoLivreTags` do catálogo espelha `mercado_livre_affiliate_tags` (LITE 1, PRO 2, MAX 10; principal
  incluída). Travado em `catalog.test.ts` (literais) e `planPresets.test.ts`. Regra completa em
  [`integracoes-credenciais-afiliado.md`](integracoes-credenciais-afiliado.md) ("Várias etiquetas do Mercado Livre").
- **Linha do card**: não é limite por canal, então fica fora da `ChannelLimitsTable`: linha própria do `PlanCard`
  logo abaixo da tabela (`MercadoLivreTagsRow`, logo do ML, "Etiquetas do Mercado Livre: N etiqueta(s)", Tooltip
  `strings.mercadoLivreTags.hint`). O número **não** se repete em `benefits`.
- **Selos por marketplace no banner** (`PlansHero.tsx`): mapa `PROVIDER_SEAL` provider → `{ label, tooltip }`. Só
  marketplace **exclusivo** de um plano leva selo (Shein = `hero.sheinPlan`, MAX). Mercado Livre está em todos os
  planos: **não** leva selo, mesmo com mais etiquetas no PRO/MAX (selo "PRO+" removido: dava a entender que o ML era
  pago à parte). Marketplace novo com selo entra no mapa, não em booleano por provider.
- **Logos nos benefícios** (`PlanBenefit.marketplaces` em `catalog.ts`): o `PlanCard` troca o check pelos logos
  sobrepostos (`MarketplaceLogos`, decorativos, nome no `label`) numa faixa neutra. LITE = Shopee, Mercado Livre e
  Amazon; MAX = Shein no "Afiliado Shein". Logo vem de `AFFILIATE_PROVIDERS`, nunca caminho solto.
- `/affiliates/plans?feature=mercadoLivreTags` mostra o aviso `featureNotice.mercadoLivreTags`.
- **Aviso de upgrade com vários planos**: `PlanLimitKind` `mercadoLivreTags`; `UPSELL_CONFIG` em `planUpsell.ts`
  (`listAll`, `feature`) faz o `PlanLimitBanner` listar **todos** os planos acima (`plansAbove`: LITE → PRO e MAX) e o
  CTA ir para `?feature=mercadoLivreTags` (`upgradePathFor`). Os kinds antigos seguem mostrando só o próximo plano.
- Assinatura (`/settings/subscription`): linha "Etiquetas do Mercado Livre" com uso × limite.

## Página de Ofertas (app 0.52.0)

- Benefício "Página de Ofertas" (`STOREFRONT_BENEFIT_LABEL`) só em PRO e MAX, espelhando
  `storefront_enabled` false/true/true (travado em `planPresets.test.ts`). Nunca no LITE.
- `PREMIUM_SLUG_OFFER` (`catalog.ts`): texto do banner de nome especial (título, benefícios, `priceLabel`,
  `checkoutUrl: null` → "Em breve"). Fica **fora** de `PLAN_CATALOG` (o teste conta 3 planos). Compra é placeholder.
- `/plans?feature=storefront` mostra o aviso de upgrade (`PlansFeatureNotice`); o painel redireciona para lá no
  `403 PLAN_FEATURE_UNAVAILABLE` da vitrine. Selo "PRO" no item do menu (`NavItemBadge`,
  `plansStrings.badgeProfessional`). Ver [`pagina-de-ofertas.md`](pagina-de-ofertas.md).

## Story de Oferta (app 0.53.0)

- Benefício "Oferta montada a partir só do link" no PRO (MAX herda por "Tudo do PRO"), espelhando
  `enrich_link_only_enabled` false/true/true.
- Benefício "Reescrita com IA para o seu público" no PRO (MAX herda), espelhando `ai_rewrite_enabled`
  false/true/true; no LITE o card IA do monitoramento e os públicos com IA do gerador ficam travados.
- Benefício "Captura fora do horário de postagem" só no MAX (`exclusive`), espelhando
  `capture_outside_window_enabled` false/false/true.
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
- **Logos dos marketplaces integrados** no banner (`PlansHero`): lista vem de `AFFILIATE_PROVIDERS` (marketplace novo entra sozinho), logo via `MarketplaceLogo`, nome no `Tooltip` (hover) e em texto oculto para leitor de tela, sem foco (logo não é ação). Nome da marca vem de `affiliateProviders.ts` (marca de terceiro, não traduz). Shein leva selo `MAX` (texto de marketing, igual ao `exclusive` de `catalog.ts`); se o super admin liberar no PRO, atualizar `hero.sheinPlan`/`sheinTooltip` em `strings.ts` junto com o catálogo.
- **Toggle mensal/anual** no banner, anual por padrão (como no Pulso). Período em `usePersistedState('plans.period')`.
  Preço anual = `priceAnnualMonthly` por plano (≈ −20%, arredondado: 77/133/197). **Provisório** até o owner fixar o
  valor; mudar só no `catalog.ts` e em `ANNUAL_DISCOUNT` (selo do toggle).

## Links de pagamento (app 0.86.0)

- Slugs da vitrine: `lite | pro | max` (antes `starter | profissional | business`); nomes exibidos seguem LITE/PRO/MAX.
- Cada plano tem `checkoutUrls: { monthly, annual }` em `catalog.ts`: URL da oferta da Cakto (texto de vitrine, como
  o preço; nunca no banco nem em env). `buildCheckoutUrl(slug, period, search, catalog, prefill)` (`checkout.ts`) lê
  dali, anexa a UTM interna e o autopreenchimento (abaixo). Período vem do toggle.
- A Cakto avisa a central, que manda ao CopySync o webhook com `planSlug = copysync-{lite|pro|max}-{mensal|anual}`;
  `resolvePlanSlug` (`api/.../tenants/domain/planPresets.ts`) leva os 6 ao preset do tier (mensal = anual).
- Trocou oferta na Cakto: mudar só `checkoutUrls` e o teste `checkout.test.ts`.

### Botão sem prévia de URL (app 0.87.0)

- "Assinar" é `<button>` **sem `href`**: o navegador não mostra a URL do gateway na barra de status. A URL é
  montada **no clique** (`getCheckoutUrl`) e aberta por `openCheckout` (`openCheckout.ts`), síncrono no handler
  (fora dele o bloqueador de pop-up barra). Enter/Espaço vêm do próprio `<button>`; nome acessível
  `ctaNewTab` ("abre o pagamento em nova aba") em `strings.ts`.
- `window.open(url, '_blank')` **sem** `noopener,noreferrer`: com eles o navegador devolve `null` sempre (spec HTML)
  e não daria para saber se a aba foi bloqueada. Isolamento: `tab.opener = null` logo após abrir; referrer só a
  origem (meta `strict-origin-when-cross-origin` do `index.html`). Retorno `null` (bloqueado) →
  `window.location.assign(url)`.

### UTM de origem interna (app 0.87.0)

- Todo link leva `utm_source=app`, `utm_medium=in_app`, `utm_campaign=plans`, `utm_content=<slug>-<monthly|annual>`
  (`checkoutUtm`). Valores white label: sem nome do produto.
- `utm_*` da URL atual do painel **não** são repassados: dentro do painel o clique é interno e a campanha que trouxe
  o visitante já foi atribuída no cadastro. `gclid`/`fbclid` da URL atual **continuam** repassados.
- Parâmetro que o link da Cakto já traz vence, e a query existente **nunca é re-serializada** (`queryAppend.ts`:
  só anexa pares novos; utm/sck da oferta saem byte a byte iguais).

### Autopreenchimento do checkout (api 0.69.0 · app 0.87.0)

- API: `GET {API_PREFIX}/me/checkout-prefill` (Bearer, `authHook`; sem tenant) → `{ email?, confirmEmail?, name? }`.
  Regra pura em `api/.../users/domain/services/checkoutPrefill.ts` (padrões copiados do formulário da Cakto, os
  mesmos da central): e-mail `trim`+minúsculas no `CHECKOUT_EMAIL_PATTERN` (sai em `email` e `confirmEmail`); nome
  com espaços colapsados, 1..100, só letras latinas/acentos/espaço. Inválido é **omitido**, nunca corrigido.
  `GetCheckoutPrefillUseCase` + `CheckoutPrefillPresenter`; `Cache-Control: no-store`; valores nunca logados.
- **Documento** não sai: o produto não guarda CPF/CNPJ (nem em `User` nem em `Tenant`). **Telefone** não sai: a Cakto
  ignora `phone` na URL (verificado pela central, `pulsosocial_api/api/docs/checkout-prefill.md`).
- App: `useCheckoutPrefill` busca ao **montar** a vitrine (timeout 2,5 s) e guarda num `ref` em memória;
  `appendCheckoutPrefill` (`checkoutPrefill.ts`) anexa no clique com o que já tiver. Regras: só `https://pay.cakto.com.br`;
  link que já traz `email` não recebe nada (não mistura dados); chave já preenchida não é sobrescrita. Falha ou
  timeout → link só com UTM.
- `/settings/subscription` continua levando à vitrine: sem mudança.

## Pendências (fora deste entregável)

1. `planSlug` no `GET /me` → destacar plano atual (card e chip no menu). Spec T1.
2. ~~Botão sai do `#`.~~ Feito (app 0.86.0): ver "Links de pagamento" acima.
3. `VITE_SUPPORT_WHATSAPP_NUMBER` → CTA de suporte quando checkout ausente. Spec T3.
4. Confirmar preço anual por plano (hoje ≈ −20% arredondado) e se o "de" riscado no anual mostra o mensal (atual) ou o preço cheio.
5. ~~Teste de consistência dos `limits` do catálogo com o seed de `PlanEntitlementPreset`.~~ Feito (api 0.42.0): `tenants/domain/planPresets.ts` + `planPresets.test.ts` travam os números da vitrine; o seed lê de lá. Gestor de Links por canal: ver "Limites por canal" acima e `rodizio-de-links.md`.

## O que não fazer

- Não calcular preço nem gravar preço no banco; não chamar a central do navegador.
- Não usar hex fixo nos cards: `theme.palette` + `alpha()`.
- Não criar segundo catálogo (LP, extensão): a vitrine do painel é `catalog.ts`.
- Não guardar o autopreenchimento em `usePersistedState`/localStorage/sessionStorage nem exibi-lo: é dado pessoal.
- Não pôr `href` no "Assinar" nem buscar o prefill no clique (`await` antes de `window.open` cai no bloqueador).
- Não adicionar documento/telefone ao prefill sem campo guardado e evidência de que a Cakto lê o parâmetro.
- Não voltar a montar link de checkout por env ou por `/planos/...` da central: o link é o do catálogo.
- Não mostrar a tabela do roadmap com emoji: ícones Lucide via `AppIcon`.
- Não repetir limites de canal em `benefits` nem escrever "Telegram não incluso": a tabela de canais cobre os dois.
