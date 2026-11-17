# Acesso por produto — Tarefas

**Design**: `design.md` · **Status**: Em execução (2026-11-17): ✅ T1–T22; ✅ T23 docs + api 0.100.0/app 0.123.0; ✅ T24 QA visual (banco descartável); roteiro de implantação em `docs/acesso-por-produto.md` (ligar `log`/`enforce` na Render é ação do dono) · Branch: `feature/product-access` a partir de `feature/rebranding-app`
(features saem e voltam para ela). Cada tarefa = 1 subagente + 1 commit `type(product-access): …`.
Gate: `.specs/codebase/TESTING.md` (`quick` ao fim da task, `full` antes do commit). Migration nunca roda local
contra `api/.env` (produção): só Postgres descartável (`api/scripts/postgres-descartavel.sh`).
`git add` só com caminhos explícitos. `[P]` = paralela dentro da fase. Teto: 3 subagentes com banco ao mesmo tempo.

## Plano de execução

```
Fase 0 (sequencial)  T1 caracterização
Fase 1 (paralelo)    T1 ─┬→ T2 domínio puro [P]
                         ├→ T3 schema + migrations [P]
                         └→ T13 inventário de segundo plano [P]
Fase 2               T2,T3 → T4 repositório + reader
                     T2 → T5 erro + env + gate
                     T4,T5 → T6 classificação e registro em routes.ts → T7 WS/SSE
Fase 3 (paralelo)    T4 ─┬→ T8 lista de tenants com produtos [P]
                         ├→ T9 provisionamento [P]
                         ├→ T16 concessão admin [P]
                         └→ T17 /subscription [P]
                     T1,T2 → T10 reconciliação pura [P]
Fase 4 (sequencial)  T9,T10 → T11 webhook por produto
                     T4,T10 → T12 reconciliação aplica produtos
                     T4,T13 → T14 públicas · T15 workers [P]
Fase 5 (painel)      T8 → T18 features/products ─┬→ T19 menu → T21 layout + dashboard
                                                 ├→ T20 rotas + login + interceptor
                     T17,T18 → T22 assinatura por produto
Fase 6               T23 docs + changelog + versões → T24 QA + roteiro de implantação
```

## Tarefas

### T1 Testes de caracterização (rede de segurança)
**What**: fixar o comportamento atual antes de qualquer mudança: `resolvePlanSlug` (todos os slugs aceitos e recusados), `resolveEffectivePlanSlug` (permissão vence slug, permissão desconhecida ignorada), `unknownPlanPermissions`, `pickGrantingSubscription` e `decideReconcile` (empates, tolerância, plano desconhecido, `adminBlocked`), `ApplyBillingEventUseCase` (ativação nova, vínculo por e-mail, renovação, corte com e sem união, fora de ordem, duplicado), `buildNavigation` (lista de produtos e itens). Só acrescenta casos que faltarem nos testes existentes; não altera código de produção.
**Where**: `api/src/modules/tenants/domain/planPresets.test.ts`, `api/src/modules/integrations/domain/services/subscriptionReconcile.test.ts`, `api/src/modules/integrations/billing/ApplyBillingEventUseCase*.test.ts`, `app/src/features/navigation/model.test.ts`.
**Depends**: — · **Requirement**: PROD-11,17 · **Tests**: unit · **Gate**: full
**Done when**: suíte verde; contagem de testes anotada no commit (base para "sem remoção silenciosa"). **Commit**: `test(product-access): caracteriza billing e navegação atuais`.

### T2 Domínio puro [P]
**What**: `resolveProductAccess`, `PRODUCTS`/`LEGACY_PRODUCTS`, `resolvePlan(planSlug, permissions)` (Afiliados delegando a `resolveEffectivePlanSlug`), `mergeSharedEntitlements`, contratos `IProductAccessReader` e `ITenantProductRepository`.
**Where**: `api/src/modules/tenants/domain/{services/resolveProductAccess.ts,planCatalog.ts,sharedEntitlements.ts,contracts/}`.
**Depends**: T1 · **Reuses**: `planPresets.ts`, padrão de `chat/domain/services/diffRemoteState.ts` · **Requirement**: PROD-02,11,18 · **Tests**: unit · **Gate**: quick
**Done when**: testes cobrem legado sem linha = ativo, novo sem linha = inativo, linha decide, `CHAT` acompanha `AFFILIATES`; todo slug de T1 resolve igual com `product='AFFILIATES'`; merge: maior vence, `null` vence, legado sem plano = não grava; `ALL_PLAN_SLUGS` exportado sem alterar `PLAN_SLUGS`. **Commit**: `feat(product-access): regras puras de produto e plano`.

### T3 Schema e migrations [P]
**What**: model `TenantProduct` (`design.md` §2) + relação em `Tenant`; migration `create_tenant_products` (sem INSERT) e `add_audit_action_tenant_product_changed`.
**Where**: `api/prisma/schema.prisma`, `api/prisma/migrations/<ts>_*/migration.sql`, união TS de `AuditAction` em `shared/audit/IAuditLogRepository.ts`.
**Depends**: T1 · **Requirement**: PROD-01,21 · **Tests**: none (schema) · **Gate**: build
**Done when**: `prisma migrate deploy` aplica em Postgres descartável; `prisma generate` e `pnpm typecheck` ok; migration sem `INSERT`. **Commit**: `feat(product-access): tabela tenant_products`.

### T4 Repositório e leitor com cache
**What**: `PrismaTenantProductRepository` (aceita `TransactionClient`), `PrismaTenantProductMapper`, `CachedProductAccessReader` (TTL 45 s), `AlwaysGrantedProductAccessReader`.
**Where**: `api/src/modules/tenants/infrastructure/{repositories,mappers,access}/`.
**Depends**: T2, T3 · **Reuses**: `chat/infrastructure/entitlement/CachedChatEntitlementGate.ts`, `PrismaEntitlementReader.ts` · **Requirement**: PROD-03 · **Tests**: unit (mapper, cache com relógio falso) + integration (repo) · **Gate**: full + `integration-db`
**Done when**: upsert concorrente do mesmo (tenant, produto) não duplica; toda consulta filtra `tenantId`. **Commit**: `feat(product-access): repositório e leitor de produtos`.

### T5 Erro, env e gate
**What**: `ProductUnavailableError`; env `PRODUCT_ACCESS_GATE_MODE`; `createProductGate(product, reader, mode)` (lança `AppError`; sem `tenantContext` = passa; super admin passa; produto novo sempre exigido).
**Where**: `api/src/shared/errors/internal/PlanErrors.ts`, `api/src/shared/config/env.ts` (+ `env.productAccess.test.ts`), `api/src/shared/http/hooks/productGate.ts`.
**Depends**: T2 · **Reuses**: precedente `LOGIN_GUARD_MODE` · **Requirement**: PROD-04,05,06,09 · **Tests**: unit · **Gate**: quick
**Done when**: matriz modo × (legado/novo) × (com/sem acesso) × super admin testada; em `off` o reader não é chamado para produto legado; leitor falhando: `enforce` → 503 genérico, `log`/`off` → segue, produto novo → nunca libera. **Commit**: `feat(product-access): gate de produto`.

### T6 Classificação e registro das rotas
**What**: `withProduct` (hook `onRoute` que insere o gate logo após `tenantHook` em array novo), `ROUTE_PRODUCT_MAP`, aplicação em `routes.ts`; teste de classificação (todo `app.register` de `routes.ts` está no mapa) e teste `inject`.
**Where**: `api/src/app/productRoutes.ts`, `api/src/app/routes.ts`, `api/src/app/productRoutes.test.ts`.
**Depends**: T4, T5 · **Reuses**: padrão de teste de `chat.routes.test.ts` · **Requirement**: PROD-05,07,08 · **Tests**: unit com `inject` · **Gate**: full
**Done when**: tenant só-Saver → 403 em rota de afiliado em `enforce`, 200 em `off`/`log`; rota de sessões e `/me` nunca bloqueadas; rota pública de plugin gateado segue respondendo; módulo sem classificação quebra o teste; plugin com `const preHandler` compartilhado por várias rotas: o gate executa **uma vez** por requisição e o array original não é mutado (revisão). **Commit**: `feat(product-access): rotas classificadas por produto`.

### T7 WebSocket e SSE
**What**: mesma regra na abertura do WebSocket do chat e nos SSE de produto.
**Where**: `api/src/shared/http/hooks/sseAuthHook.ts`, rota WS em `chat.routes.ts` (só o ponto de abertura).
**Depends**: T6 · **Requirement**: PROD-10 · **Tests**: unit · **Gate**: quick
**Done when**: abertura negada em `enforce` sem produto; inalterada em `off`. **Commit**: `feat(product-access): gate em conexões persistentes`.

### T8 Lista de tenants com produtos [P]
**What**: `products` em cada tenant devolvido por `GET /tenants` (fonte do `TenantContext` do painel), pela resposta do login e por `/me` (revisão: o painel não chama `/me`).
**Where**: `api/src/modules/tenants/application/use-cases/ListUserTenantsUseCase.ts`, `TenantPresenter`, `tenant.routes.ts` (schema), resposta do login em `auth`, `api/src/modules/users/presentation/routes/me.routes.ts`.
**Depends**: T4 · **Requirement**: PROD-23 · **Tests**: unit (use case/presenter) + `inject` · **Gate**: quick
**Done when**: tenant legado devolve `['AFFILIATES','CHAT']` nas três respostas; campos antigos intactos; uma leitura de produtos por tenant (sem N+1 fora do cache). **Commit**: `feat(product-access): produtos na lista de tenants`.

### T9 Provisionamento com produtos iniciais [P]
**What**: `ProvisionTenantInput.initialProducts?`; com produto novo: `planSlug` nulo, linha do produto ativa e `AFFILIATES` inativo na mesma transação (sem linha `CHAT`); log `error` se o modo do gate não for `enforce`; sem o campo: idêntico a hoje.
**Where**: `api/src/modules/tenants/application/use-cases/ProvisionTenantUseCase.ts` (+ teste).
**Depends**: T4 · **Requirement**: PROD-12 · **Tests**: unit · **Gate**: quick
**Done when**: testes existentes do use case passam sem edição; caso novo coberto. **Commit**: `feat(product-access): provisionamento por produto`.

### T10 Reconciliação pura por produto [P]
**What**: `pickGrantingByProduct` (classifica por `resolvePlan(s.planSlug, s.permissions)`; `byProduct`, `unknownGrants`, `anyGrants`, `legacyGrants`); `pickGrantingSubscription` inalterada; `decideReconcile` com `products` só quando há assinatura de produto novo.
**Where**: `api/src/modules/integrations/domain/services/subscriptionReconcile.ts` (+ teste).
**Depends**: T1, T2 · **Requirement**: PROD-15,17 · **Tests**: unit · **Gate**: quick
**Done when**: testes de T1 passam **sem edição**; casos novos: só Saver; Saver + Afiliados; Afiliados cortado com Saver ativo → Afiliados inativo; **plano desconhecido dando acesso + Saver ativo → Afiliados continua ativo** (revisão); só plano desconhecido → `unknown_plan` sem escrita. **Commit**: `feat(product-access): união de assinaturas por produto`.

### T11 Webhook por produto
**What**: `ApplyBillingEventUseCase` conforme `design.md` §3.4 (ativação de produto novo, consulta à central no caso PROD-14, corte por produto, `excludeKeys` no sync, merge de chaves compartilhadas; `unknownPlanPermissions` ignora permissões de produtos conhecidos).
**Where**: `api/src/modules/integrations/billing/{ApplyBillingEventUseCase,syncPlanEntitlements}.ts` (+ testes).
**Depends**: T9, T10 · **Requirement**: PROD-12..16,18,19 · **Tests**: unit + integration (transação e trava) · **Gate**: full + `integration-db`
**Done when**: testes de T1 inalterados e verdes; novos:
- cliente novo Saver; Saver em tenant ativo não toca `planSlug`/vencimento/entitlements de Afiliados;
- `subscription.updated` de Saver não muda status de tenant suspenso;
- Saver em tenant cancelado: sem assinatura de Afiliados na central → `AFFILIATES` inativo; **com** assinatura de Afiliados ou de plano desconhecido dando acesso → nenhuma linha `AFFILIATES`; central fora → `HUB_UNAVAILABLE` sem recibo;
- mesmo caso com `adminBlockedAt`: status intocado, linha segue o snapshot (revisão);
- corte de Afiliados com Saver ativo → `KEPT_ACTIVE` + `AFFILIATES` inativo; com plano desconhecido dando acesso → Afiliados intocado (revisão);
- corte total → tenant bloqueado, sem linha `AFFILIATES`, linha `SAVER` inativa com `inactiveSince` (revisão);
- ativação `COPYSYNC_*` com linha `AFFILIATES` inativa → volta a ativa;
- tenant legado ilimitado que soma Saver **não ganha** `whatsapp_sessions` nem `telegram_sessions` (revisão);
- `syncPlanEntitlements` sem `excludeKeys` = saída de hoje.
**Commit**: `feat(billing): eventos de assinatura por produto`.

### T12 Reconciliação aplica produtos
**What**: repositório da reconciliação grava linhas de produto na transação; `source=ADMIN` nunca desativado; fila de vencidos (`:56-59`) ignora tenant com `AFFILIATES` inativo.
**Where**: `api/src/modules/integrations/infrastructure/billing/PrismaBillingReconcileRepository.ts`, `ReconcileSubscriptionsUseCase.ts` (+ testes).
**Depends**: T4, T10 · **Requirement**: PROD-17,22,28 · **Tests**: unit + integration · **Gate**: full + `integration-db`
**Done when**: tenant sem assinatura Saver → mesmas escritas de hoje (comparação de estado antes/depois); `unknown_plan` e `noop` seguem sem escrita; tenant só-Saver com vencimento de Afiliados antigo não entra no lote de vencidos (revisão). **Commit**: `feat(billing): reconciliação por produto`.

### T13 Inventário de segundo plano [P]
**What**: listar, com arquivo:linha, todo ponto que processa dado de Afiliados/Chat fora de requisição autenticada (workers, jobs, listeners de evento, rotas públicas) e como cada um trata tenant suspenso hoje. Atualiza `design.md` §3.5.
**Where**: `.specs/features/product-access/design.md`.
**Depends**: T1 · **Requirement**: PROD-20 · **Tests**: none (documento) · **Gate**: —
**Done when**: tabela ponto → tratamento atual → mudança prevista; nenhum "a confirmar"; inclui obrigatoriamente os listeners de `chat/infrastructure/listeners/`, todo consumidor do `internalEventBus` de Afiliados e as rotas da extensão por cookie (revisão). **Commit**: `docs(product-access): inventário de processamento em segundo plano`.

### T14 Páginas públicas respeitam produto [P]
**What**: rodízio público e vitrine pública tratam `AFFILIATES` inativo como indisponível.
**Where**: arquivos listados em T13 (esperado: `ResolvePublicLinkUseCase.ts`, resolução pública do storefront).
**Depends**: T4, T13 · **Requirement**: PROD-20 · **Tests**: unit · **Gate**: quick
**Done when**: com reader "sempre ativo" os testes existentes passam sem edição; caso inativo coberto. **Commit**: `feat(product-access): páginas públicas por produto`.

### T15 Workers respeitam produto [P]
**What**: envio de ofertas, captura de monitoramento, sync de membros do rodízio e ingestão do chat pulam tenant com `AFFILIATES` inativo; rotas da extensão por cookie respondem `PRODUCT_UNAVAILABLE` pelo `mlTenantId` (checagem dentro do módulo `extension`). Se o inventário passar de 4 arquivos de produção, dividir em T15a (workers), T15b (chat), T15c (extensão).
**Where**: arquivos listados em T13.
**Depends**: T4, T13 · **Requirement**: PROD-20 · **Tests**: unit · **Gate**: quick
**Done when**: idem T14; item pulado não é marcado como falha nem reprocessado em laço. **Commit**: `feat(product-access): workers por produto`.

### T16 Concessão manual pelo super admin [P]
**What**: `SetTenantProductUseCase` + `PUT /admin/tenants/:tenantId/products/:product`; preset, merge e `AuditLog`.
**Where**: `api/src/modules/tenants/application/use-cases/SetTenantProductUseCase.ts`, arquivo de rota novo `tenants/presentation/routes/tenantProductAdmin.routes.ts` (prefixo `/admin/tenants` já usado por `marketplaceRiskAdminRoutes`, `routes.ts:114`: rotas não podem colidir), schema; `PrismaPlanEntitlementPresetRepository.ts` (propagação por `tenant_products.planSlug` para plano de produto novo, sem `SHARED_KEYS`, + merge).
**Depends**: T3, T4 · **Reuses**: `SetPlanEntitlementUseCase.ts`, `GrantPremiumSlugUseCase.ts:47-51` (auditoria) · **Requirement**: PROD-21 · **Tests**: unit · **Gate**: quick
**Done when**: plano de outro produto → 400; ligar produto novo sem plano → 400; `CHAT` → 400; auditoria gravada; cache do tenant invalidado; log `error` se o modo do gate não for `enforce`; `SetPlanEntitlementUseCase`/`ListAdminPlanEntitlementsUseCase` aceitam `ALL_PLAN_SLUGS` (revisão); preset de plano Saver alterado no admin chega ao tenant só-Saver e não grava `whatsapp_sessions`/`telegram_sessions` direto. **Commit**: `feat(product-access): concessão de produto pelo super admin`.

### T17 `/subscription` com produtos [P]
**What**: `products[]` aditivo no use case, presenter e schema.
**Where**: `api/src/modules/tenants/presentation/{routes/subscription.routes.ts,presenters/SubscriptionPresenter.ts}` e use case correspondente.
**Depends**: T4 · **Requirement**: PROD-27 · **Tests**: unit · **Gate**: quick
**Done when**: resposta de tenant legado = resposta de hoje + `products` com Afiliados. **Commit**: `feat(product-access): produtos na assinatura`.

### T18 Painel: base de produtos
**What**: `ProductKey`, `hasProduct`, `resolveHomePath` (fallback `/settings/subscription`), `useProductAccess` (`{ loaded, products }`), `ProductRoute` (carregando/sem acesso), `strings.ts`; `products` no tipo de tenant; `tenantsLoaded` no `TenantContext`.
**Where**: `app/src/features/products/`, `app/src/contexts/TenantContext.tsx`, `app/src/types/api.types.ts`.
**Depends**: T8 · **Requirement**: PROD-23,25,26 · **Tests**: unit (funções puras + `ProductRoute` com Testing Library, claro e escuro) · **Gate**: quick
**Done when**: tenant carregado sem `products` → legado; lista ainda não carregada → indicador de carregamento, nunca Afiliados presumido (revisão); só-Saver sem tela de Saver registrada → Assinatura. **Commit**: `feat(app): acesso por produto no painel`.

### T19 Menu por produto
**What**: `BuildNavigationInput.products`, `NavProduct.locked`, produto travado com só o item de planos.
**Where**: `app/src/features/navigation/{model.ts,model.test.ts,strings.ts}`.
**Depends**: T18 · **Requirement**: PROD-24 · **Tests**: unit · **Gate**: quick
**Done when**: caso legado de T1 inalterado; casos só-Saver e ambos cobertos. **Commit**: `feat(app): menu respeita produtos do tenant`.

### T20 Rotas, login e interceptor
**What**: `<ProductRoute>` nas rotas de Afiliados, inclusive `/settings/ai` e `/settings/extension`; index/fallback/pós-login e demais redirecionamentos fixos via `resolveHomePath`; 403 `PRODUCT_UNAVAILABLE` → vitrine do produto; links de upsell apontam para a vitrine do produto dono da chave.
**Where**: `app/src/routes/AppRoutes.tsx`, `app/src/pages/LoginPage.tsx`, `app/src/services/apiClient.ts`, `app/src/app/AppLayout.tsx:488`, `features/ai/components/SuperAdminRoute.tsx:7`; upsell: `features/storefront/planGate.ts:6`, `features/linkRotation/planUpsell.ts:56`, `WizardProviderStep.tsx:86`, `HunterGatesPanel.tsx:39`, `OfferSendPanel.tsx:134`, `OfferConfigWizard.tsx:200`, `GroupPickerDialog.tsx`, `AccountIdentifiersSection.tsx:18`, `features/settings/components/SheinCredentialCard.tsx:406`.
**Depends**: T18 · **Requirement**: PROD-25,26,29 · **Tests**: unit (interceptor, `resolveHomePath`, `planGate`) · **Gate**: full
**Done when**: com Afiliados, início = `/dashboard` e destinos de upsell iguais a hoje; só-Saver nunca cai em laço de redirecionamento; `grep` por `'/dashboard'`, `'/plans'` e `AFFILIATE_PLANS_PATH` em `app/src` com cada ocorrência restante justificada no commit (revisão). **Commit**: `feat(app): rotas protegidas por produto`.

### T21 Layout e dashboard
**What**: cadeado com `AppIcon` + `Tooltip` no produto travado; `ExtensionInstallBanner` só com Afiliados.
**Where**: `app/src/app/AppLayout.tsx` (e o componente do acordeão que ele usa), `app/src/pages/DashboardPage.tsx`.
**Depends**: T19 · **Requirement**: PROD-24,26 · **Tests**: unit (componente do item travado, claro e escuro) · **Gate**: quick
**Done when**: sem emoji nem ícone de brilho; foco por teclado alcança o item travado. **Commit**: `feat(app): produto travado no menu`.

### T22 Assinatura por produto
**What**: um cartão por produto; limites filtrados por produto; CTA para a vitrine certa.
**Where**: `app/src/pages/settings/SubscriptionPage.tsx`, `app/src/features/subscription/components/{SubscriptionPlanCard,SubscriptionLimitsTable}.tsx`, `app/src/services/subscription.service.ts`; chaves por produto em `api/src/modules/tenants/domain/services/subscriptionLimits.ts`.
**Depends**: T17, T18 · **Requirement**: PROD-27 · **Tests**: unit · **Gate**: full
**Done when**: tenant legado vê a mesma tela de hoje. **Commit**: `feat(app): assinatura por produto`.

### T23 Documentação e versões
**What**: `docs/acesso-por-produto.md` (o que é, regra do legado, modos, o que não fazer); linha no `AGENTS.md`; ajustes em `docs/arquitetura-central-billing.md`, `docs/navegacao-produtos.md`, `docs/assinatura.md`, `docs/produto-roadmap.md`; `api/CHANGELOG.md`; versões api 0.100.0 e app 0.123.0 (próxima minor no início da execução).
**Depends**: T1–T22 · **Tests**: none · **Gate**: full
**Done when**: doc cobre regra do legado, `CHAT` acompanha `AFFILIATES`, modos e a ordem "enforce antes de vender", plano desconhecido conta para Afiliados; versões e changelog batem; `pnpm typecheck && pnpm test` verdes nos dois apps.
**Commit**: `docs(product-access): documenta acesso por produto (api 0.100.0, app 0.123.0)`.

### T24 QA e roteiro de implantação
**What**: smoke com agent-browser em Postgres descartável: tenant legado, só-Saver (concedido por T16) e ambos, nos modos claro e escuro; roteiro `off → log (48 h) → enforce` com as consultas somente leitura de conferência.
**Depends**: T23 · **Tests**: smoke · **Gate**: smoke
**Done when**: capturas das três contas; roteiro anexado ao doc. Ligar `log`/`enforce` na Render é ação do dono.

## Validação das tarefas

**Granularidade**: T1–T24 entregam cada uma 1 conceito (1 função/1 hook/1 use case/1 tela). T2 e T18 agrupam 3–4 funções puras coesas no mesmo diretório (aceito). T11 é a maior e fica sozinha na fase por tocar o webhook.

**Diagrama × `Depends`**:

| Task | Depends (corpo) | Diagrama | Status |
| --- | --- | --- | --- |
| T2, T3, T13 | T1 | T1 → T2/T3/T13 | ✅ |
| T4 | T2, T3 | T2,T3 → T4 | ✅ |
| T5 | T2 | T2 → T5 | ✅ |
| T6 | T4, T5 | T4,T5 → T6 | ✅ |
| T7 | T6 | T6 → T7 | ✅ |
| T8, T9, T17 | T4 | T4 → T8/T9/T17 | ✅ |
| T16 | T3, T4 | T4 → T16 (T3 via T4) | ✅ |
| T10 | T1, T2 | T1,T2 → T10 | ✅ |
| T11 | T9, T10 | T9,T10 → T11 | ✅ |
| T12 | T4, T10 | T4,T10 → T12 | ✅ |
| T14, T15 | T4, T13 | T4,T13 → T14/T15 | ✅ |
| T18 | T8 | T8 → T18 | ✅ |
| T19, T20 | T18 | T18 → T19/T20 | ✅ |
| T21 | T19 | T19 → T21 | ✅ |
| T22 | T17, T18 | T17,T18 → T22 | ✅ |
| T23, T24 | anteriores | Fase 6 | ✅ |

**Testes × matriz do `TESTING.md`**:

| Task | Camada | Matriz exige | Task diz | Status |
| --- | --- | --- | --- | --- |
| T2, T10 | funções puras de domínio | unit | unit | ✅ |
| T3 | schema/migration | nenhum (migration em descartável) | none + build | ✅ |
| T4, T12 | mapper + repositório com SQL/transação | unit + integration | unit + integration | ✅ |
| T5, T7 | hooks/shared | unit | unit | ✅ |
| T6, T8 | rotas | nenhum (por ora) | unit com `inject` (acima do mínimo) | ✅ |
| T9, T16, T17 | use cases | unit | unit | ✅ |
| T11 | use case com transação e trava | unit + integration | unit + integration | ✅ |
| T14, T15 | use cases/workers | unit | unit | ✅ |
| T18–T22 | `app/` funções puras e componentes | unit | unit | ✅ |
| T13, T23 | documentos | nenhum | none | ✅ |

Testes de integração não são parallel-safe: T4, T11 e T12 nunca rodam `integration-db` ao mesmo tempo.

## Riscos

| Risco | Mitigação |
| --- | --- |
| Regressão em cobrança | T1 antes de tudo; T10/T11 exigem os testes de T1 sem edição |
| Bloqueio indevido de cliente atual | Sem linha = ativo; modo `log`; reversão por env |
| Módulo novo sem classificação | Teste de T6 |
| Subagente rodar migration em produção | Preâmbulo; `api/.env` nunca usado em teste; setups recusam host remoto |
