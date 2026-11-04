# Planos no menu + modal de planos — plano de implementação

Status: **fase 1 visual entregue como página** (2026-10-28, app 0.43.0; ver `docs/planos.md`). Decisão do owner no mesmo dia: **página `/plans`, não modal**; o restante da spec (plano atual, checkout, suporte, toggle anual, pontos de entrada) segue válido com `navigate('/plans')` no lugar de `usePlansDialog().open()`.

Status original: **plano** (2026-10-28). Item do roadmap: **7. Planos e limites** (`docs/produto-roadmap.md`).
Fontes: `docs/produto-roadmap.md` (tabela de planos), `docs/arquitetura-central-billing.md` (hub, "Painel = link para
`Application.checkoutUrl`"), `docs/plano-lancamento-hub-copysync.md` (H3 = checkout da aplicação `copysync`).
Referência visual: `pulsosocial_extension/app/src/screens/Plans/PlansView.tsx` (modal) e
`pulsosocial_api/lp-pulsosocial/src/components/Pricing.tsx` (LP). Inspiração, não cópia: MUI + tema do CopySync.

## Objetivo

Item **"Planos"** no menu lateral que abre um modal com os 3 planos (Starter, Profissional, Business), destaca o
recomendado, mostra o plano atual do tenant e leva ao checkout da central. Mesmo modal abre a partir dos avisos de
limite (`PLAN_LIMIT_REACHED`, uso de ofertas, grupos), virando o ponto único de upgrade.

## Estado atual (levantado no código)

| Peça | Situação |
| --- | --- |
| `Tenant.planSlug`, `TenantEntitlement`, `PlanEntitlementPreset`, receiver HMAC, `ApplyBillingEventUseCase` | ✅ existem (`api/prisma/schema.prisma:136,868,880`; `api/src/modules/integrations/billing/`) |
| Endpoint para o front saber plano atual / catálogo | ❌ nenhum. `GET /me` devolve tenant só com `status` (`TenantPresenter.ts:10`) |
| URL de checkout | ❌ não configurada (nem API nem `VITE_*`). Checkout da aplicação `copysync` é a fase H3 da central, ainda não entregue |
| UI de plano/upgrade no painel | ❌ nenhuma. Só textos de limite soltos (`offers/strings.ts`, `monitoring/strings.ts`, `OfferSendPanel.tsx:28`) |
| Menu com item de ação | 🟡 `AppLayout.tsx:56-57,185,194`: qualquer item com `action` abre **sempre** o diálogo de privacidade (fixo) |
| Tema | primary `#4f70e0` → secondary `#7c3aed`: mesmo eixo azul→violeta do gradiente CTA do Pulso; não precisa de cor nova |

## Alternativas avaliadas

### Fonte do catálogo (nome, preço, benefícios)

| Alternativa | Veredito | Por quê |
| --- | --- | --- |
| A. Front chama `GET /plans` da central direto do navegador | ❌ | Chamada síncrona à central em request de usuário (proibido no doc de billing); CORS; `/plans` hoje devolve planos do PulsoSocial (sem escopo por `Application` até H1) |
| B. Preço e benefícios em tabela no banco do CopySync | ❌ | Doc de billing: "não guardar preço nem cópia de preço" no CopySync |
| C. API do CopySync faz proxy de `/plans` da central com cache | ⏳ fase 2 | Certo a longo prazo (preço com uma fonte só), mas depende de H1+H3 na central; bloquearia a tela por semanas |
| **D. Catálogo de vitrine no front (`features/plans/catalog.ts`) com preço como texto de marketing; limites vêm dos presets** | ✅ fase 1 | É o que o roadmap chama de "preço de/por é só marketing". Mesma abordagem da LP/extensão do Pulso. Risco conhecido: o Pulso tem LP e extensão com preços divergentes → um único arquivo de catálogo, com teste que compara as chaves de limite com `PlanEntitlementPreset` (ver T6) |

### Plano atual do tenant

| Alternativa | Veredito | Por quê |
| --- | --- | --- |
| Novo `GET /billing/plan` | ❌ | Mais uma chamada no boot do painel para um campo |
| **Adicionar `planSlug` (nullable) ao tenant em `GET /me`** | ✅ | Mudança aditiva de contrato, emissor e consumidor no mesmo PR; `TenantPresenter` + `api.types.ts` |
| Ler entitlements e deduzir plano | ❌ | Ambíguo (presets podem coincidir) |

### Destino do botão "Assinar" (decidido 2026-10-28: redirect → Cakto, como no Pulso)

Como o Pulso faz hoje: link `app.pulsosocial.app/planos/{slug}` → `RedirectHandler` (`pulsosocial_api/app/src/pages/RedirectHandler.jsx:235`)
→ `GET /planos/:slug` (`api/src/controllers/redirect.ts:31-130`) → `RedirectConfig` no banco (`slug`, `urlA/urlB`, `percentA`, A/B
sticky 30 dias) → página da Cakto. Query de origem (`utm_*`, `upgrade=1`) é repassada. A spec do hub (`multi-application-hub/spec.md`)
prevê `Application.checkoutUrl` (:113) e um deploy do front por aplicação (H3, :49, :315), mas **não** prevê `RedirectConfig` por
aplicação nem formato de slug por app.

| Alternativa | Veredito | Por quê |
| --- | --- | --- |
| **A. Link para o redirect da central com slug prefixado: `{BASE}/planos/copysync-{plano}-{periodo}`** | ✅ fase 1 | Funciona hoje sem mudar código da central: só cadastrar 6 linhas em `RedirectConfig` (3 planos × 2 períodos) apontando para as páginas Cakto do CopySync. `BASE` em `VITE_BILLING_CHECKOUT_URL`; começa `https://app.pulsosocial.app`, troca para o deploy `copysync` quando H3 existir, sem mexer no código |
| B. Redirect multi-app no hub (`RedirectConfig.applicationId`, header `X-Application-Key`, `RedirectHit` + rollup para gráficos) | ✅ alvo | Desenhado em `pulsosocial_api/.specs/features/multi-application-hub/redirect-multi-app.md` (fase 3 do hub, depende de `Application`). Até entrar, A é o paliativo; quando entrar, as 6 linhas ganham `applicationId=copysync` e o slug perde o prefixo. O CopySync não muda código: só `VITE_BILLING_CHECKOUT_URL` e, no deploy do front da central, `VITE_APPLICATION_KEY` |
| C. Redirect próprio no CopySync (`api.copysync.app/planos/:slug` com tabela espelho) | ❌ | Duplica `RedirectConfig`, A/B e log; doc de billing veda recriar mecanismo da central |
| D. Link direto para a Cakto no front | ❌ | Link de gateway no código; trocar oferta/A/B vira deploy |

Regras do link: abre em nova aba (`rel="noopener"`); `buildCheckoutUrl(slug, period, search)` repassa `utm_*`/`gclid`/`fbclid` da
URL atual (padrão `mergeSearchParams` do Pulso: destino vence); env ausente → `null` → CTA vira "Falar com o suporte".
Slugs: `copysync-starter-mensal|anual`, `copysync-profissional-mensal|anual`, `copysync-business-mensal|anual`.
Cadastro das 6 linhas em `RedirectConfig` (admin da central) é tarefa de operação, fora deste repo (T10).

### Suporte por WhatsApp (decidido 2026-10-28)
Como o painel do Pulso (`pulsosocial_api/app/src/utils/support.js:1-17`): `VITE_SUPPORT_WHATSAPP_NUMBER` → `https://wa.me/{numero}`,
**sem fallback hardcoded** (número é por produto). Usado em: CTA quando checkout não configurado, "Fale com o suporte para trocar"
(downgrade), faixa de confiança ("suporte humano") e futuramente item 13 do roadmap. `buildSupportUrl(text?)` puro, com `?text=`
opcional pré-preenchido ("Olá, quero trocar meu plano…"), testado. Env ausente → link some e tooltip "Suporte em breve".

### Abertura do modal

| Alternativa | Veredito | Por quê |
| --- | --- | --- |
| Rota `/plans` (página) | ❌ | Pedido é modal; perde contexto da tela onde o limite estourou |
| **`PlansDialogProvider` + `usePlansDialog().open({ reason?, highlight? })`** | ✅ | Menu e avisos de limite abrem o mesmo modal; `?plans=1` na URL opcional para link direto |
| Generalizar `action` do menu com `switch` inline | ✅ junto | `action: 'privacy' \| 'plans'` com mapa `action → handler`, em vez do `privacy.openDialog()` fixo |

## Desenho

### Menu (`app/src/app/AppLayout.tsx`)
- Item `{ label: plansStrings.menuLabel, action: 'plans', icon: <AppIcon icon={Crown} size="md" /> }` logo **acima de
  Privacidade** (bloco de itens de ação, antes de Configurações).
- `onClick`: `ACTION_HANDLERS[item.action]()` (`privacy` → `privacy.openDialog`, `plans` → `plansDialog.open`).
- Colapsado: Tooltip MUI com o label (já é o padrão dos itens).
- **Chip do plano atual ao lado do label** (decidido): `Starter` / `Profissional` / `Business` em `Chip size="small"` outlined
  (`primary`); tenant sem `planSlug` → chip "Sem plano" (`default`); `SUSPENDED` → chip `warning` "Pendente". Menu colapsado:
  o nome do plano entra no Tooltip ("Planos · Starter"). Nome do plano não é dado sensível: sem flag de privacidade.

### Feature `app/src/features/plans/`
```
features/plans/
  catalog.ts              # PLAN_CATALOG: slug, nome, tagline, preço de/por (texto), destaque, benefícios, "ideal para"
  checkout.ts             # buildCheckoutUrl(slug, period, search) — puro, testado
  strings.ts              # textos pt-BR (chaves semânticas, frases com variável como função)
  PlansDialogContext.tsx  # provider + usePlansDialog()
  components/
    PlansDialog.tsx       # casca: Dialog MUI, header, toggle de período (se houver), grid, rodapé
    PlanCard.tsx          # card; variante destacada
    PlanFeatureList.tsx   # lista com Check + Tooltip nos itens que precisam explicação
    PlansTrustStrip.tsx   # faixa de confiança
  index.ts
```
Sem chamada HTTP nova no front: `planSlug` vem do `GET /me` já carregado.

### Visual (inspirado no Pulso, com tokens do CopySync)

| Elemento | Pulso | CopySync |
| --- | --- | --- |
| Casca | portal Tailwind, overlay blur, `max-w-[1062px]`, `rounded-[20px]` | `Dialog` MUI `maxWidth="lg"`, `fullScreen` abaixo de `sm`, `BackdropProps` com `backdropFilter: blur(6px)`, `borderRadius: 3` do tema, botão X (`AppIcon X`) com `aria-label` |
| Gradiente | `--gradient-cta` azul 262 → violeta 295 | `linear-gradient(100deg, primary.main, secondary.main)` lido do `theme.palette` (nada de hex na tela) |
| Header | Crown em quadrado gradiente + ring | `AppIcon Crown` branco em `Box` 44px gradiente, `boxShadow: 0 0 0 4px alpha(primary, .12)`; título `h5` 800; subtítulo com trecho em negrito ("o que muda é o limite de uso") |
| Toggle mensal/anual | pílula, ativo em gradiente, chip "−20%" | `ToggleButtonGroup` pílula, **anual como padrão** (como no Pulso); chip com o desconto calculado do catálogo (`−N%`, verde inativo / branco translúcido ativo); preço com animação `price-bump` (scale .92→1) ao trocar; chip verde "economize R$ X/ano" só no anual. Valores anuais: **pendência de preço** (ver abaixo), catálogo fica com `annual: null` até o owner definir |
| Grid | 3 cards, 1 coluna < lg | `Grid` 12/4 em `md+`, 1 coluna abaixo; card `Paper` `p: 2.5`, hover `translateY(-4px)` (desligado em `prefers-reduced-motion`) |
| Card | nome + chip, tagline, preço 30px, CTA, lista, rodapé "Ideal para" tracejado | nome + chip do limite principal ("1 WhatsApp"), tagline, preço "de R$ 278,90" riscado + "R$ 167" `h4` `tabular-nums` + "/mês", CTA full width, lista, rodapé "Ideal para…" com `borderTop: 1px dashed divider` |
| Destaque (Profissional) | borda 1.5px gradiente, glow, badge "MAIS ESCOLHIDO" | wrapper `p: '1.5px'` com gradiente + card interno `background.paper`; glow `0 10px 40px -12px alpha(primary, .55)`; badge flutuante `-top: 10px` caption uppercase com gradiente |
| Plano atual | — | chip "Seu plano" (`success`) e CTA vira "Plano atual" desabilitado; plano abaixo do atual mostra "Fale com o suporte para trocar" (downgrade não é self-service) |
| CTA | gradiente no destaque, outline no básico | destaque: `contained` com gradiente; demais: `outlined`. Abre checkout em nova aba (`rel="noopener"`) |
| Benefícios | Check primary, 1º em negrito "Tudo do Plus" | `AppIcon Check` `inline` em `primary.main`; Business começa com "Tudo do Profissional" em negrito; "—" vira item omitido (não lista o que não tem) |
| Selo de garantia | starburst dourado "7 DIAS" | ✅ garantia de 7 dias confirmada. SVG inline (`PlansGuaranteeSeal.tsx`) com `warning.main`/`warning.dark` sobre disco `primary.dark`, rotação −13°, canto superior esquerdo, `display: none` abaixo de `md`, `aria-hidden`; texto "7 dias de garantia" também na faixa de confiança (acessível) |
| Faixa de confiança | ícones verdes | `success.main`: pagamento seguro, cancele quando quiser, 7 dias de garantia, Shopee/ML/Amazon, suporte humano (link `wa.me`) |
| Movimento | entrada em sequência | `Grow`/`Fade` MUI com `style={{ transitionDelay }}`, desligado em reduced motion |
| Tema claro/escuro | LP só escura | Tudo via `theme.palette` + `alpha()`; validar contraste do texto branco sobre o gradiente nos dois modos |

### Conteúdo (de `produto-roadmap.md`)

| | Starter | Profissional ⭐ | Business |
| --- | --- | --- | --- |
| Preço | de 161,90 por **97** | de 278,90 por **167** | de 411,90 por **247** |
| Chip | 1 WhatsApp | WhatsApp + Telegram | 2 WhatsApp + 2 Telegram |
| Benefícios | 1 grupo monitorado, 5 de disparo, disparo em massa, agendamento, rodízio de links, Shopee/ML/Amazon, suporte 24/7, aulas | Tudo do Starter + 2 monitorados, 10 de disparo, Telegram, menção a todos, gerador de ofertas, site pra bio, domínio próprio, suporte prioritário | Tudo do Profissional + 6 monitorados, 40 de disparo, template Instagram, suporte exclusivo |

Tooltips (MUI `Tooltip`, `enterTouchDelay={0}`) em: "grupos monitorados", "grupos de disparo", "rodízio de links",
"menção a todos", "domínio personalizado". Texto final passa pela skill `copywriting`.

### Pontos de entrada além do menu (fase 1b)
`OfferSendPanel.tsx:28`, `OfferUsageChip.tsx`, `GroupPickerDialog.tsx:35`, `ConfigSessionStep.tsx:19` e o tratamento
global de `PLAN_LIMIT_REACHED` no `apiClient`: botão "Ver planos" → `usePlansDialog().open({ reason: 'limit', highlight: <próximo plano> })`.
O modal mostra uma faixa no topo ("Você atingiu o limite de grupos do Starter") quando `reason` vier.

### Regras do projeto
- **i18n**: todo texto em `features/plans/strings.ts`; preço formatado com `Intl.NumberFormat('pt-BR', { currency: 'BRL' })`.
- **White label**: nomes `plans`, `PlansDialog`, `checkout`; marca só via `APP_NAME` se aparecer no texto.
- **Persistência**: `usePersistedState('plans.dialog', …)` escopo `tab` para `{ open, period }`; limpa ao fechar.
- **Privacidade**: modal não mostra dado sensível (sem nome/número/grupo). Sem flag nova; registrar isso no doc. Se o
  chip do menu mostrar nome do tenant, aí sim flag.
- **Permissão**: CTA de assinatura só para papel `ADMIN` do tenant; demais veem "Peça ao administrador da conta".
- **Env do app** (`app/.env.example`): `VITE_BILLING_CHECKOUT_URL`, `VITE_SUPPORT_WHATSAPP_NUMBER`. Ambas opcionais; tela degrada sem elas.
- **Ícones**: Lucide via `AppIcon` (`Crown`, `Check`, `ShieldCheck`, `X`). Sem emoji (a tabela do roadmap usa emoji; a UI não).

## Tarefas

| # | Tarefa | Camada | Verificação |
| --- | --- | --- | --- |
| T1 | `planSlug` no `TenantPresenter` e em `api.types.ts` (`MeTenant`) | api + app | teste do presenter; `tsc` nos dois |
| T2 | `features/plans/catalog.ts` + `strings.ts` | app | teste: 3 planos, 1 destacado, slugs = presets |
| T3 | `checkout.ts` (`buildCheckoutUrl`, repasse de `utm_*`, env ausente → `null`) + `support.ts` (`buildSupportUrl`) | app | teste unitário |
| T4 | `PlansDialogContext` + `PlansDialog` + `PlanCard` + `PlanFeatureList` + `PlansTrustStrip` | app | teste de render: destaque, plano atual, fallback sem env, papel não-admin |
| T5 | Menu: item `plans`, `ACTION_HANDLERS`, provider montado junto do `PrivacyDialog` | app | teste: clique abre o modal; privacidade continua abrindo o dela |
| T6 | Teste de consistência: chaves numéricas do catálogo batem com o seed de `PlanEntitlementPreset` | app/api | falha se preset mudar sem atualizar a vitrine |
| T7 | Pontos de entrada de limite (fase 1b) | app | teste por componente |
| T8 | `docs/planos-modal.md` (o que é, fonte do catálogo, o que não fazer), link no `AGENTS.md`; CHANGELOG; versão app minor (0.43.0) e api patch | docs | revisão |
| T9 | agent-browser: claro/escuro, 375px/1280px, colapsado, reduced motion, toggle anual/mensal | — | screenshots anexados ao PR |
| T10 | Operação (fora do repo): 6 `RedirectConfig` na central (`copysync-*`) → páginas Cakto; `VITE_BILLING_CHECKOUT_URL` e `VITE_SUPPORT_WHATSAPP_NUMBER` na Render; redirect multi-app no hub já desenhado em `redirect-multi-app.md` | infra/hub | links abrem a Cakto certa |

Fase 2 (depois de H1+H3 na central): `GET /billing/plans` no CopySync com cache em memória + TTL e fallback para o
catálogo local (nunca bloqueia o modal); preço passa a vir da central; `catalog.ts` fica só com texto de vitrine.

## O que não fazer
- Não calcular preço, desconto ou cupom no CopySync; preço é texto de vitrine até a fase 2.
- Não chamar a central do navegador nem de forma síncrona na API.
- Não gravar preço no banco.
- Não usar hex fixo na tela: só `theme.palette` + `alpha()`.
- Não deixar o `action` do menu fixo em privacidade.

## Decisões do owner (2026-10-28)
1. **Plano anual: sim.** Toggle mensal/anual, anual como padrão. **Valores anuais ainda não definidos** → única pendência aberta:
   preço anual por plano (ou % de desconto único, ex.: −20% como o Pulso). Até definir, `catalog.ts` guarda `annual: null` e o
   toggle fica oculto; a implementação não espera por isso.
2. **Garantia de 7 dias: sim.** Selo + item na faixa de confiança.
3. **Checkout: redirect da central → Cakto**, como no Pulso (alternativa A acima). Spec do hub não cobre redirect por app; gap
   registrado em T10.
4. **Suporte: WhatsApp** via `VITE_SUPPORT_WHATSAPP_NUMBER` → `wa.me`. Número a informar na Render.
5. **Plano atual no menu: sim**, chip ao lado de "Planos" e dentro do modal.

## Pendência
- Preço anual (R$) de Starter / Profissional / Business, ou % de desconto. Também: preço "de" (riscado) no anual ou só no mensal.
