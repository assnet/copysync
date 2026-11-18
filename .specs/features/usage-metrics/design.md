# Uso dos recursos — Design

**Spec:** [`spec.md`](spec.md) · **Tasks:** [`tasks.md`](tasks.md) · **Status:** Implementado (P1–P3, api 0.104.0 · app 0.127.0, 2026-11-18). O código mudou o desenho em pontos registrados em [`docs/uso-dos-recursos.md`](../../../docs/uso-dos-recursos.md) (fila no portão de leitura, `inScope`, corte gravado do contador, consolidação por grupo de fonte, adoção só com direito); em caso de divergência, vale o doc e o código.

## 1. Visão geral

```
Painel /admin/usage ──GET──▶ /admin/usage/* (authHook + superAdminHook)
                                  │
                         GetFeatureUsageSummaryUseCase
                          │            │             │
              IFeatureUsageReader  IUsageTenantDirectory  featureUsageCatalog (puro)
              ├─ P1: PrismaLiveFeatureUsageReader (tabelas de domínio, sob demanda)
              └─ P2: PrismaDailyFeatureUsageReader (feature_usage_daily)
                          │
                 aggregateFeatureUsage (função pura) ──▶ presenter ──▶ JSON só com chaves e números

P2: worker ── FeatureUsageRollupJob (lease, flag) ──▶ feature_usage_daily ◀── IFeatureUsageRecorder (Story, chat)
P3: painel ── POST /usage/page-views ──▶ IFeatureUsageRecorder (chave do menu)
```

Ideia central: os dois leitores devolvem a mesma linha, `{ day, tenantId, featureKey, kind, uses, activeDays, lastDay }`
(`day` é o dia ou, no agregado acima de 90 dias, o início da semana ou do mês; numa linha por dia `activeDays = 1` e
`lastDay = day`).
O tipo (`kind`) é do evento: um recurso pode ter linhas de mais de um tipo.
Toda a conta (filtros, alcance, tendência, quebra por plano, recorrência) é função pura sobre essas linhas e sobre o
diretório de contas. Trocar a fonte na P2 não muda use case, presenter nem tela.

Tamanho hoje, no pior caso (toda conta usando todo recurso todo dia), contando período atual + anterior:
- sob demanda (P1, até 90 dias, por dia): 19 contas × 17 pares recurso × tipo × 180 dias = 58 mil linhas; guarda de
  **100 mil** (aguenta 32 contas no pior caso);
- agregado (P2, 18 pares com `chat_send`), até 90 dias por dia: 19 × 18 × 180 = 62 mil linhas;
- agregado acima de 90 dias: a granularidade mínima é **semana** e o SQL já devolve agrupado por semana ou mês
  (§4.5), então 400 dias + anterior = 115 semanas: 19 × 18 × 115 = 39 mil linhas.

Guarda do agregado: **300 mil** linhas. O pior caso do agregado é o de 90 dias por dia (3.240 linhas por conta), então
a guarda aguenta **92 contas** em uso denso (144 no período de 400 dias por semana). Na prática são algumas centenas de
linhas. Visitas de tela (P3) não entram nessa conta: são lidas por consulta própria já agregada no SQL (§4.6).
Passou da guarda = 503, sinal para mover mais agrupamento para o SQL (D3).

## 2. Reuso (conferido no código)

| O quê | Onde | Uso aqui |
| --- | --- | --- |
| Módulo e containers | `api/src/modules/metrics/` (`infraCostsContainer.ts`, `opsMetricsContainer.ts`) | Módulo novo não: as métricas de uso vivem em `metrics`, com `featureUsageContainer.ts` |
| Rotas sem controller | `presentation/routes/infraCosts.routes.ts` + `httpResponse.ok` | Mesmo formato: handler fino chama o use case do container |
| Guard | `preHandler = [authHook, superAdminHook]` (`shared/http/hooks/`) | Igual |
| Timeout de leitura | `$transaction([SET LOCAL statement_timeout, query])`; `isStatementTimeout` em `infrastructure/repositories/infraCostReadTimeout.ts`; instante UTC explícito `${iso}::timestamptz AT TIME ZONE 'UTC'` em `PrismaInfraCostUsageReader.ts` | Mesma técnica, com orçamento global de 2 s para o pedido inteiro, diretório de contas incluído (§4.1); erro próprio `UsageMetricsReadUnavailableError` |
| Limite de taxa | `@fastify/rate-limit` com `rateLimitPresets` e `perTenantRateLimit` em `api/src/shared/http/rateLimitPresets.ts` (uso: `config: { rateLimit: perTenantRateLimit(rateLimitPresets.storefrontSlug) }` em `storefront.routes.ts`) | Preset novo `usagePageViews` para a rota de visitas (P3) |
| `updatedAt` em SQL cru | `@updatedAt` do Prisma não cria `DEFAULT` no banco; `PrismaInfraCostSnapshotRepository.ts` grava a coluna de data explicitamente no `INSERT ... ON CONFLICT` | `feature_usage_daily."updatedAt"` sempre explícito no `INSERT` e no `DO UPDATE` (P2) |
| Conta sem nome | `s.detail.unknownTenant(id)` (`Conta <8 primeiros caracteres>`) em `app/src/features/saverAdmin/strings.ts` | Molde do texto do chip quando o nome não está carregado |
| Cursor keyset assinado | `application/use-cases/infraCostTenantCursor.ts` sobre `shared/http/pagination/OpaqueCursor.ts` | Molde de `featureUsageTenantCursor.ts`; chave `{ uses, tenantId }`; escopo = `featureKey` + filtros |
| Classe da rota | `ROUTE_PRODUCT_MAP` em `api/src/app/productRoutes.ts` (teste `productRoutes.test.ts` falha se um `app.register` não estiver no mapa) | `featureUsageRoutes: 'TENANT'` (P1) e `usagePageViewRoutes: 'TENANT'` (P3) |
| Auditoria | `shared/audit/IAuditLogRepository.ts` (união TS) + enum Prisma `AuditAction`; exemplo `PlatformSaverContactsUseCases.ts` | Ação nova `USAGE_METRICS_VIEWED` (migration `ALTER TYPE` + união) |
| Planos e produtos | `modules/tenants/domain/planPresets.ts` (`PLAN_SLUGS`, `SAVER_PLAN_SLUGS`), `domain/services/resolveProductAccess.ts` (`PRODUCTS`), `entitlementKeys.ts` | Filtro de plano e produto; adoção na P3 |
| Fuso | `campaigns/domain/services/postingWindow.ts` (`POSTING_TIME_ZONE`) | Mesmo valor; a constante de uso fica no domínio de `metrics` (sem importar de `campaigns`) |
| Job e lease | `infrastructure/jobs/InfraCostSnapshotJob.ts` (`ownerId = randomUUID()`, `INFRA_COST_SNAPSHOT_LEASE_TTL_MS` menor que o tick, `release` no fim), `infrastructure/infraCostSnapshotStart.ts`, `IJobLease.tryAcquire(name, ownerId, until, now)`/`PrismaJobLease`, `app/processJobs.ts` (`WORKER_JOBS`), `app/server.ts`, `shared/config/env.ts` | Molde do `FeatureUsageRollupJob` |
| Estado em `platform_settings` | Tabela chave → JSON (`PlatformSetting`: `key`, `value`, `updatedAt`); `PrismaFeatureAudienceRepository.ts` (`FEATURE_AUDIENCE_SETTINGS_KEY`, `platformSetting.findUnique`) e `PrismaInfraCostSettingsRepository.ts` (`INFRA_COST_SETTINGS_KEY`) | Marco do backfill na chave `feature_usage_rollup` (P2), lido a cada pedido |
| Página com abas por sub-rota | `app/src/pages/admin/AdminCostsPage.tsx`, `features/infraCosts/paths.ts` | Molde de `AdminUsagePage.tsx` |
| Gráficos | `@mui/x-charts` 8.29.3 (única lib; `TimeLineChart`, `CommitsBarChart`, `MetricChartCard`, `ChartTable`, `chartColors` em `features/opsMetrics/`) | **Nenhuma lib nova.** `BarChart` horizontal e `LineChart` próprios da feature, com `chartColors(mode)` e tabela alternativa no molde de `MetricChartCard` |
| Componentes | `PageHeader`, `StatCard`, `EmptyState`, `SectionCard`, `ServiceUpdatingState`, `AppIcon`, `OverflowTooltipText`; `HelpTip` de `opsMetrics`; `StickyFirstColumn` e `HeaderHint` de `app/src/features/infraCosts/components/costParts.tsx`; `CursorResetNotice` (hoje função local em `infraCosts/components/TenantsTab.tsx`) | Reuso direto; `CursorResetNotice` é extraído para `infraCosts/components/CursorResetNotice.tsx` e importado pelas duas telas (T14) |
| 503 de leitura lenta | `apiClient.ts` trata 502/503/504 como serviço indisponível (`classifyServiceUnavailable`); exceção em `features/infraCosts/useCostSummary.ts` (`isSlow` pelo código `INFRA_COST_READ_UNAVAILABLE`) | Mesmo desvio para `USAGE_METRICS_READ_UNAVAILABLE`: vira `Alert` com "Tentar de novo", não a tela de serviço atualizando |
| Relógio | `serverNow()` em `app/src/services/serverClock.ts` | "Hoje" e presets de período; `rules.ts` recebe `now` por parâmetro |
| Teste de componente | `renderWithTheme` em `app/src/test/renderWithTheme.tsx` | Todo teste de componente da feature |
| Contrato compartilhado | Não existe pasta comum entre `api/` e `app/` (cada um tem seus tipos) | Pasta nova na raiz, `contracts/feature-usage/`: `summary.response.json`, `feature-detail.response.json` e `catalog.json` (chaves de recurso e códigos de `coverageReasons`). Os testes dos dois lados leem por caminho de arquivo (`fs`), sem import entre pacotes; nada disso entra no build |
| Persistência | `usePersistedState(key, initial, { scope, version, deserialize })` | Filtros |
| Privacidade | `features/privacy/privacyFlags.ts` (`PRIVACY_SCREENS`, cada tela e cada flag com `label`), `Blurred`, `useBlur` | Tela `usage` ("Uso dos recursos"), flag `usage.tenantName` ("Nome da conta") |
| CSV no painel | `downloadBlob` (`features/saver/components/export/downloadFile.ts`) | Baixar o CSV do resumo |
| Datas | Só `Intl`; sem dayjs/date-fns/date-pickers; `<input type="date">` em `PlatformContactsFilters.tsx` | Período personalizado com dois `<input type="date">` |

Não existe e não será criado: biblioteca de i18n (o painel é pt-BR com `strings.ts` por feature), cache de rota,
flag de conta interna, tabela de contador diário.

## 3. Componentes

### Backend (`api/src/modules/metrics/`)

| Camada | Arquivo | Responsabilidade |
| --- | --- | --- |
| domain/services | `featureUsageCatalog.ts` | Lista fechada `FEATURE_USAGE_CATALOG`: `key`, `product` (`AFFILIATES`/`CHAT`/`SAVER`/`SESSION`/`ACCESS`), `planFamily` (`AFFILIATES` para tudo que não é Saver; `SAVER`), `kinds` (um ou mais de `ACTION`/`AUTOMATIC`/`AUDIENCE`/`ACCESS`; o tipo de cada linha vem do evento; exceção D11: `ai_rewrite` e `offer_dispatch` têm tipo fixo `AUTOMATIC`), `source` (`LIVE`/`RECORDED`), `recordedFrom?` (data de corte: antes dela a fonte é `LIVE`, a partir dela `RECORDED`; ausente na P1 e obrigatória em todo recurso `RECORDED`), `possibleCoverageReasons` (códigos que **podem** valer para o recurso; os que valem no período saem do agregador), `retentionDays?` (logins 30, cliques 90), `entitlementKey?` (P3), `phase`. Puro |
| domain/services | `featureUsagePeriod.ts` | Datas `YYYY-MM-DD` em `America/Sao_Paulo` → instantes UTC `[from, toExclusive)`; período anterior; buckets dia/semana/mês; teto. Puro, relógio injetado |
| domain/services | `aggregateFeatureUsage.ts` | Linhas + contas + filtros → totais (contas ativas distintas entre recursos, recursos usados, recurso mais usado; **sem soma de usos**), por recurso (com quebra por tipo e `coverageReasons` aplicáveis ao período, §4.1), por plano (família do recurso, §4.2), série, nunca usados, tendência (`null` sem base), top contas ordenado por `(uses desc, tenantId)`. Puro |
| domain/services | `featureUsageRetention.ts` (P3) | Adoção, recorrência (≥ N dias), retenção entre períodos. Puro |
| domain/contracts | `IFeatureUsageReader.ts` | `read({ from, toExclusive, featureKeys, granularity, budget }): Promise<{ rows: FeatureUsageRow[]; firstDataDay: Record<key, day \| null> }>` (o leitor sob demanda sempre devolve linha por dia; o diário agrupa por semana ou mês acima de 90 dias); `firstDataDay` vem de **uma** instrução separada (`firstDataDays`, §4.1), dentro do mesmo orçamento |
| domain/contracts | `IUsageTenantDirectory.ts` | `list(budget): { tenantId, affiliatesPlan, saverPlan, status, internal, createdAt }[]` (cada plano já resolvido pela regra do §4.2: slug ou `NONE`) e `names(ids, budget): Map` (só a lista de contas do detalhe chama); as duas leituras gastam o mesmo orçamento do pedido |
| domain/contracts | `IUsageReadGate.ts` | `runExclusive(fn)`: uma leitura de uso por processo; ocupada lança `UsageMetricsReadUnavailableError` |
| domain/contracts | `IFeatureUsageDailyRepository.ts`, `IFeatureUsageRecorder.ts`, `IFeatureUsageRollupStateRepository.ts` (P2) | Agregado, contador e marco do backfill |
| application/use-cases | `GetFeatureUsageSummaryUseCase.ts` | Valida período, lê atual + anterior, agrega |
| | `GetFeatureUsageDetailUseCase.ts` | Um recurso: série, por plano, medidas |
| | `ListFeatureUsageTenantsUseCase.ts` + `featureUsageTenantCursor.ts` | Top contas com keyset; audita a 1ª página |
| | `RollupFeatureUsageUseCase.ts`, `RecordFeatureUsageUseCase.ts` (P2); `RecordPageViewUseCase.ts` (P3) | Agregado, contador, visita |
| infrastructure/repositories | `PrismaLiveFeatureUsageReader.ts` | Uma instrução por fonte (§4.1), em sequência, cada uma em transação com `SET LOCAL statement_timeout` igual ao que resta do orçamento de 2 s do pedido |
| | `featureUsagePeriodSql.ts` | SQL das duas consultas por período de `offers` e `offer_dispatches` (escrito na T5a para o `EXPLAIN`, reutilizado pelo leitor na T5) |
| | `PrismaUsageTenantDirectory.ts` | `tenants` + `user_tenants`/`users.isSuperAdmin` + `tenant_products` |
| | `PrismaDailyFeatureUsageReader.ts`, `PrismaFeatureUsageDailyRepository.ts`, `PrismaFeatureUsageRollupStateRepository.ts` (P2) | Agregado (linha por dia até 90 dias; por semana ou mês acima; guarda de 300 mil linhas; `firstDataDay` por `MIN(day)`) e marco do backfill em `platform_settings["feature_usage_rollup"]` |
| | `PrismaPageViewReader.ts` (P3) | Ranking das telas por consulta já agregada no SQL (§4.6) |
| | `featureUsageReadTimeout.ts` | Orçamento do pedido: `createReadBudget(now, 2000)` → `remainingMs()`; `runWithinBudget(budget, prisma, consulta)` (uma transação por instrução com `SET LOCAL statement_timeout = <ms inteiro>`, recusa `ms < 1` sem ir ao banco, corre contra um temporizador que cobre a espera por conexão); `usageReadGate` (uma leitura de uso por processo; ocupada = 503 na hora); tradução de `isStatementTimeout`/orçamento esgotado em `UsageMetricsReadUnavailableError`. Usado pelo leitor e pelo diretório |
| infrastructure/jobs | `FeatureUsageRollupJob.ts` (P2) | Job do `worker` |
| infrastructure | `featureUsageRollupStart.ts` (P2) | Partida do job, ao lado de `infraCostSnapshotStart.ts` |
| infrastructure | `featureUsageContainer.ts` | Factories |
| presentation | `routes/featureUsage.routes.ts`, `schemas/featureUsage.schema.ts`, `presenters/featureUsagePresenter.ts` | HTTP |
| shared/errors/internal | `UsageMetricsErrors.ts` | Erros do §6 |

Registro: `app.register(featureUsageRoutes, { prefix: \`${env.API_PREFIX}/admin/usage\` })` em `api/src/app/routes.ts`, com
`featureUsageRoutes: 'TENANT'` em `ROUTE_PRODUCT_MAP` (`api/src/app/productRoutes.ts`) antes do registro.

### Painel (`app/src/features/featureUsage/`)

| Arquivo | Responsabilidade |
| --- | --- |
| `paths.ts` | `USAGE_PATH = '/admin/usage'`, `USAGE_PLANS_PATH`, `USAGE_SCREENS_PATH` (P3), `usageFeaturePath(key)` = `/admin/usage/features/:key`, `USAGE_TABS` (`overview`, `plans`, P3 `screens`), `activeUsageTab` (no detalhe a aba ativa é `overview`) |
| `types.ts`, `rules.ts` | Contratos; `UsageFilters` (período como preset `today|7d|30d|90d|custom` + datas só no `custom`, granularidade, produto, tipos, plano, status, internas, `tenantId?`, ordenação); `DEFAULT_USAGE_FILTERS` (iguais aos padrões do schema da rota), `parseUsageFilters` (descarta `custom` no futuro ou acima do teto do painel, `USAGE_MAX_DAYS` = 90 na P1 e 400 na P2), `resolvePeriod(filters, now)`, `toUsageQuery` (envia todo filtro explícito, nunca conta com o padrão do servidor), presets de período com `now` injetado (quem chama passa `serverNow()`), datas em `America/Sao_Paulo` via `Intl`, formatação de tendência, `summaryToCsv` com neutralização de fórmula |
| `strings.ts` | `featureUsageStrings`: `navLabel`, títulos, rótulo e descrição de cada chave do catálogo, medidas, tooltips, estados |
| `services/adminUsage.service.ts` (em `app/src/services/`) | `adminUsageService.getSummary/getDetail/getTenants` (P3: `getScreens`) com `apiClient` |
| `services/usagePageViews.service.ts` (P3, em `app/src/services/`) | `usagePageViewsService.report(key)`: chamado por qualquer usuário, por isso fora do serviço admin |
| `hooks/useUsageSummary.ts`, `useUsageDetail.ts`, `useUsageTenants.ts` | Estado, recarga, descarte de resposta antiga, `slow` para o 503 de leitura lenta, cursor com "Carregar mais" e `cursorReset` (molde `useCostTenants`) |
| `hooks/useLoadedAccountNames.ts` | Nomes de conta já carregados pela lista do detalhe, só em memória (nunca persistidos): a lista registra, o chip consulta; criado na T11 para a T14 não tocar a página |
| `hooks/usePageViewReporter.ts` (P3) | Envia a chave do item do menu na troca de rota (§4.6) |
| `components/UsageFiltersBar.tsx` | Período (`ToggleButtonGroup` + personalizado), granularidade, produto, tipo de uso, plano, internas (`Switch`), status; chip removível da conta filtrada (recebe `tenantId` e, opcional, o nome já carregado; sem nome mostra o id curto; sempre sob `Blurred`) |
| `components/UsageKpiRow.tsx` | 3 KPIs: contas ativas, recursos usados, mais usado |
| `components/FeatureRankingChart.tsx` | Barras horizontais + tabela alternativa |
| `components/UsageTrendChart.tsx` | Linha: contas ativas (geral) ou usos e contas de um recurso |
| `components/PlanMatrixTable.tsx` | Recurso × plano |
| `components/NeverUsedList.tsx`, `CoverageChip.tsx` | Nunca usados; aviso de cobertura parcial (um texto por código de `coverageReasons`) e "dados desde" |
| `components/FeatureDetail.tsx`, `FeatureTenantsTable.tsx` | Detalhe e top contas com `Blurred` |
| `components/OverviewTab.tsx`, `PlansTab.tsx`, `FeatureDetailTab.tsx` | Contêiner de cada sub-rota, criado na T11 com KPIs e estados; as tarefas seguintes montam seus componentes cada uma no seu contêiner |
| `app/src/pages/admin/AdminUsagePage.tsx` | Cabeçalho, abas por sub-rota com `lazy` + `Suspense` + `Skeleton` |

Entradas:
- Rotas em `routes/AppRoutes.tsx` dentro de `<Route element={<SuperAdminRoute />}>`, **uma `<Route>` por caminho** (não
  há wildcard; mesmo padrão de `/admin/costs/*`), todas com `element={<AdminUsagePage />}`: `/admin/usage`,
  `/admin/usage/plans`, `/admin/usage/features/:key` (P1) e `/admin/usage/screens` (P3).
- Menu: `{ key: 'admin-usage', label: featureUsageStrings.navLabel, path: '/admin/usage', icon: ChartColumn, matchPrefix: '/admin/usage' }`
  no array `platform` de `features/navigation/model.ts`, logo depois de `admin-costs`. `icon` é o componente Lucide
  (não JSX); `ChartColumn` existe no `lucide-react` instalado (`chart-column`).
- Rótulo do menu em `featureUsageStrings.navLabel`, como o código já faz (`infraCostsStrings.navLabel`).
  `docs/navegacao-produtos.md` diz que todo rótulo fica em `navigation/strings.ts`; a frase diverge do código e a
  task de docs (T16) a corrige para "rótulo de item de Plataforma fica no `strings.ts` da feature".
- Privacidade: `{ id: 'usage', label: 'Uso dos recursos', flags: [{ id: 'usage.tenantName', label: 'Nome da conta' }] }` em `PRIVACY_SCREENS`.

## 4. Dados

### 4.1 Consultas da P1 (uma instrução por fonte; toda consulta de uso tem `GROUP BY dia, "tenantId"` + a coluna de classificação indicada)

As colunas de data são `timestamp(3)` **sem fuso**, gravadas em UTC. Por isso:
- **Dia** (definição única, usada no `SELECT` e no `GROUP BY` de toda consulta de uso desta seção, onde a tabela abaixo escreve `dia`):
  `to_char((("coluna" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD')`.
  O primeiro `AT TIME ZONE` diz que o valor é UTC, o segundo converte, e o `to_char` devolve **texto** (um `::date` cru
  voltaria do Prisma como `Date` à meia-noite UTC). Um só `AT TIME ZONE 'America/Sao_Paulo'` trataria o valor como hora
  de Brasília e erraria o dia. Nenhuma consulta devolve `date`.
- Período = coluna crua `>= (${fromIso}::timestamptz AT TIME ZONE 'UTC') AND < (${toIso}::timestamptz AT TIME ZONE 'UTC')`
  (molde `PrismaInfraCostUsageReader.ts`), independente do `TimeZone` da sessão e servido por índice.

| Fonte | Recursos | Filtro e `GROUP BY` | Índice que serve |
| --- | --- | --- | --- |
| `offers` | `offer_generator`, `group_monitoring` | `origin IN ('GENERATOR','MONITORING')`; `GROUP BY dia, "tenantId", origin` | **novo** `(createdAt)` (T5a); o atual `(tenantId, createdAt)` não serve filtro sem `tenantId` |
| `offer_dispatches` | `offer_dispatch` | `status = 'SENT'`, por `updatedAt`, qualquer origem (sem join com `offers`: envio do Caçador também conta); `GROUP BY dia, "tenantId"` | **novo** `(status, updatedAt)` (T5a); o atual `(tenantId, updatedAt)` não serve |
| `offer_hunt_runs` | `offer_hunter` | por `startedAt`, `status <> 'SKIPPED'` (execução pulada por pausa ou portão recusado não é uso); `GROUP BY dia, "tenantId", trigger` (`MANUAL` → `ACTION`, `SCHEDULED` → `AUTOMATIC`) | varredura (50 linhas; índice atual começa por `tenantId`) |
| `ai_usage_logs` | `ai_rewrite`, `offer_story` (só dias antes de `recordedFrom`) | `success = true`, `purpose IN ('offer.text','offer_story_headline')`; `GROUP BY dia, "tenantId", purpose` | varredura (193 linhas) |
| `link_rotations` | `link_rotation` | só linhas que ainda existem; `GROUP BY dia, "tenantId"` | varredura (8 linhas) |
| `link_clicks` | `link_rotation_click` | só cliques de links que ainda existem; `GROUP BY dia, "tenantId"` | varredura (38 linhas hoje, apagadas após 90 dias; ver §8 D6) |
| `storefront_offers` | `storefront` | só linhas que ainda existem, `DRAFT` ou `PUBLISHED`; `GROUP BY dia, "tenantId"` | varredura (24 linhas) |
| `sessions` | `whatsapp_session`, `telegram_session` | `engine = 'telegram'` → Telegram, qualquer outro → WhatsApp (regra de `channelForEngine`); inclui removidas (`deletedAt`); `GROUP BY dia, "tenantId", (engine = 'telegram')` | varredura (43 linhas) |
| `saver_extractions` | `saver_extraction` | `GROUP BY dia, "tenantId"` | varredura (5 linhas) |
| `audit_logs` | `affiliate_credentials`, `extension_sync`, `saver_export` | `action IN (...)`, `tenantId IS NOT NULL`; `SAVER_EXPORTED` só com `meta->>'completed' = 'true'`; `GROUP BY dia, "tenantId", action` | `(action)`; 282 linhas |
| `login_events` + `user_tenants` | `panel_login` | `type IN ('LOGIN_OK','LOGIN_CODE_VERIFIED')`, `userId IS NOT NULL` (o `userId` só faz o join para achar a conta); `GROUP BY dia, ut."tenantId"` | varredura (111 linhas; podada em 30 dias) |

Onze instruções de uso + uma de primeiro dado (`firstDataDays`) + uma leitura do diretório de contas = **treze idas
ao banco** por pedido de resumo ou de detalhe (a lista de contas faz mais uma, `names`), em sequência (o pool tem
`connection_limit=5`; nada de `Promise.all`).
O período anterior é lido na mesma chamada alargando `from` (uma passada por fonte, não duas).

**Orçamento:** o pedido inteiro tem 2 s, contados desde a primeira leitura: fontes, primeiro dado e diretório de contas
gastam o mesmo orçamento. Sem isso, treze consultas de 2 s somariam até 26 s. Mecânica (`featureUsageReadTimeout.ts`):
- **Uma transação por instrução:** `prisma.$transaction([ $executeRawUnsafe(\`SET LOCAL statement_timeout = ${ms}\`), consulta ])`,
  com `ms = Math.floor(budget.remainingMs())` calculado na hora de cada ida ao banco. Não copiar o `SET` fixo de
  `PrismaInfraCostUsageReader.ts` (lá três consultas dividem uma transação de 2 s).
- **`ms < 1` nunca vai ao banco:** lança `UsageMetricsReadUnavailableError` direto (`statement_timeout = 0` desligaria o limite).
- **Espera por conexão também conta:** o pool tem 5 conexões e a URL não define `pool_timeout`
  (`shared/database/datasourceUrl.ts` só acrescenta `socket_timeout`); o `statement_timeout` só começa depois que a
  consulta ganha conexão. Por isso cada leitura corre contra um temporizador de `remainingMs()` (`Promise.race`): se o
  temporizador vence, a leitura lança o 503 e a consulta em curso termina sozinha pelo `statement_timeout`. A URL do banco não muda.
- `statement_timeout` estourado (SQLSTATE 57014) e temporizador vencido viram o mesmo erro (503).
- **Instruções em sequência, nunca `Promise.all`:** quando o temporizador vence, a instrução que estava na fila do pool
  segue e roda depois (o Prisma não cancela). Em sequência, no máximo **uma** instrução fica órfã por pedido.
- **Uma leitura de uso por processo** (`usageReadGate`, em `featureUsageReadTimeout.ts`): um semáforo de 1 vaga na
  memória do processo cobre o pedido inteiro (fontes, primeiro dado, diretório). Pedido que chega com outra leitura em
  andamento, ou com uma instrução órfã ainda não resolvida, recebe `UsageMetricsReadUnavailableError` (503) na hora,
  sem ir ao banco. A vaga só é devolvida quando a última instrução do pedido resolve ou falha (inclusive a órfã).
  Assim a feature ocupa no máximo 1 das 5 conexões da API. É um limitador de concorrência local, não estado
  operacional (§9): nada depende dele entre réplicas e reinício o zera sem perda.

**Tipos devolvidos pelo SQL:** contagem sempre `count(*)::int AS uses` (sem o cast o `$queryRaw` devolve `BigInt`; molde
`PrismaInfraCostUsageReader.ts`), com `Number()` no mapper. Dia sempre como **texto**, pela definição única acima
(`... AS day`); passado por `dayInZone`, um `Date` à meia-noite UTC cairia no dia anterior.

**Conteúdo:** nenhuma consulta seleciona coluna de conteúdo (USAGE-11). Exceção única: o booleano `meta.completed` de
`SAVER_EXPORTED` (a auditoria é gravada no `finally`, também quando a exportação falha).

**Primeiro dado:** uma instrução separada, `firstDataDays`, com um `MIN` por recurso: mesmo `WHERE` de classificação
da consulta de uso, **sem** filtro de período e sem `GROUP BY` (a regra "todo `GROUP BY` inclui `tenantId`" vale só
para as linhas de uso; aqui sai um instante por recurso, sem conta). O instante (`timestamp`, não `date`) é convertido
para o dia de Brasília em código (`dayInZone`). `MIN` sem linha devolve `NULL`: o recurso fica com `firstDataDay = null`
(sem dado), `dataFrom = null` e tendência sem base.

```sql
SELECT 'offer_generator' AS key, MIN("createdAt") AS first FROM offers WHERE origin = 'GENERATOR'
UNION ALL SELECT 'group_monitoring', MIN("createdAt") FROM offers WHERE origin = 'MONITORING'
UNION ALL SELECT 'offer_dispatch', MIN("updatedAt") FROM offer_dispatches WHERE status = 'SENT'
UNION ALL SELECT 'offer_hunter', MIN("startedAt") FROM offer_hunt_runs WHERE status <> 'SKIPPED'
UNION ALL SELECT 'ai_rewrite', MIN("createdAt") FROM ai_usage_logs WHERE success AND purpose = 'offer.text'
UNION ALL SELECT 'offer_story', MIN("createdAt") FROM ai_usage_logs WHERE success AND purpose = 'offer_story_headline'
UNION ALL SELECT 'link_rotation', MIN("createdAt") FROM link_rotations
UNION ALL SELECT 'link_rotation_click', MIN("createdAt") FROM link_clicks
UNION ALL SELECT 'storefront', MIN("createdAt") FROM storefront_offers
UNION ALL SELECT 'whatsapp_session', MIN("createdAt") FROM sessions WHERE engine <> 'telegram'
UNION ALL SELECT 'telegram_session', MIN("createdAt") FROM sessions WHERE engine = 'telegram'
UNION ALL SELECT 'saver_extraction', MIN("createdAt") FROM saver_extractions
UNION ALL SELECT 'affiliate_credentials', MIN("createdAt") FROM audit_logs WHERE action = 'AFFILIATE_CREDENTIAL_UPSERTED' AND "tenantId" IS NOT NULL
UNION ALL SELECT 'extension_sync', MIN("createdAt") FROM audit_logs WHERE action = 'AFFILIATE_SESSION_SYNCED' AND "tenantId" IS NOT NULL
UNION ALL SELECT 'saver_export', MIN("createdAt") FROM audit_logs WHERE action = 'SAVER_EXPORTED' AND "tenantId" IS NOT NULL AND meta->>'completed' = 'true'
UNION ALL SELECT 'panel_login', MIN("createdAt") FROM login_events WHERE type IN ('LOGIN_OK','LOGIN_CODE_VERIFIED') AND "userId" IS NOT NULL
```

Dois campos por recurso, com sentidos diferentes: `firstDataDay` = esse dia (primeiro dado real; é o que a tela mostra em
"dados desde"); `dataFrom` = limite efetivo para comparação = o maior entre `firstDataDay` e `hoje − retentionDays`
(usado só para decidir se há base de tendência). O corte por retenção aparece na tela pelo motivo `RETENTION`, não por "dados desde".

**Motivos de cobertura do período:** o catálogo lista os motivos possíveis; o agregador devolve em `coverageReasons` só
os que valem para o período pedido (`coverage = PARTIAL` quando sobra algum):

| Código | Vale quando |
| --- | --- |
| `RETENTION` | o período pedido começa antes de `hoje − retentionDays` |
| `EXISTING_ONLY` | sempre na fonte viva; com agregado (P2), só quando o período começa antes do primeiro dia agregado do recurso |
| `AI_HEADLINE_ONLY` | o período tem algum dia anterior a `recordedFrom` (sempre, enquanto não há corte) |
| `MIXED_EVENTS`, `MIXED_TRIGGERS`, `TOKEN_CHANGE_ONLY` | sempre |

`MIXED_TRIGGERS` é o motivo de `ai_rewrite` e `offer_dispatch`: contam como automático, mas incluem o que foi disparado
à mão, porque a fonte não distingue (`ai_usage_logs` não tem origem; `offer_dispatches` exigiria join com `offers`).
É um código separado de `MIXED_EVENTS` (credencial + etiqueta) para o painel ter um texto por código.

**Envio × criação:** `offer_dispatch` é o recurso de entrega e conta todo envio concluído, de qualquer origem. A oferta
`HUNTER` não é contada como criação em nenhum recurso; a execução dela entra em `offer_hunter`. Sem soma entre
recursos, nada é contado duas vezes.

**O que ainda existe:** `storefront_offers`, `link_rotations` e `link_clicks` (cascade) são apagados de verdade pelo
usuário. Na P1 esses recursos medem o que ainda existe; o histórico só fica firme a partir do agregado da P2.

Usuários distintos por recurso ficaram fora (spec, "Fora do escopo"): nenhuma consulta devolve `userId` nem contagem dele.

### 4.2 Diretório de contas

`tenants` (`id`, `planSlug`, `status`, `createdAt`) + `EXISTS (user_tenants ⨝ users WHERE "isSuperAdmin")` como
`internal` + `tenant_products` (`product`, `status`, `planSlug`). 19 linhas hoje; lido a cada pedido, sem cache, dentro
do orçamento de 2 s. `name` só em `names(ids)`, chamado pela lista de contas do detalhe com os ids da página.

**Duas famílias de plano.** O plano de cada conta em cada família é resolvido no diretório:
- família **Afiliados** (recursos de `AFFILIATES`, `CHAT`, `SESSION` e `ACCESS`): `Tenant.planSlug`, **só se**
  `resolveProductAccess('AFFILIATES', linha de AFFILIATES em tenant_products)` for verdadeiro; senão `NONE`.
  `Tenant.planSlug` é nulo em conta só-Saver (`ProvisionTenantUseCase`) e **sobrevive ao cancelamento**
  (`ApplyBillingEventUseCase` só grava `planSlug` em evento de sincronização), então o slug sozinho não prova plano ativo;
- família **Saver** (recursos de `SAVER`): `tenant_products(SAVER).planSlug`, só se `resolveProductAccess('SAVER', linha)`
  for verdadeiro; senão `NONE`.

`population.byPlan` e `features[].byPlan` usam a mesma conta: **em cada família, cada conta do recorte conta uma vez**,
no plano dela naquela família ou em `NONE`. Assim o denominador da matriz (contas do plano) é o mesmo nos dois lugares.
As famílias não se somam (cada conta aparece nas duas); a tela mostra uma família por vez.

**Filtro `plan`:** um slug restringe às contas com aquele plano **e** aos recursos da família dele (`SAVER_PRO` esconde
os recursos de Afiliados; `COPYSYNC_MAX` esconde os do Saver). `NONE` mantém as duas famílias, cada uma só com as contas
sem plano nela (a mesma conta pode entrar numa família e não na outra). Sem filtro, todas as contas nas duas famílias.
`population.tenants` e `totals.activeTenants` contam contas distintas presentes em alguma família do recorte.

### 4.3 Tabela nova da P2

```prisma
model FeatureUsageDaily {
  day        DateTime @db.Date      // dia em America/Sao_Paulo
  tenantId   String
  featureKey String                 // chave do catálogo ou "view:<chave do menu>"
  kind       String                 // ACTION | AUTOMATIC | AUDIENCE | ACCESS (tipo do evento)
  uses       Int
  updatedAt  DateTime @updatedAt    // sem DEFAULT no banco: SQL cru grava a coluna explicitamente
  tenant     Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  @@id([day, tenantId, featureKey, kind])
  @@index([featureKey, day])
  @@map("feature_usage_daily")
}
```

Migration aditiva `create-feature-usage-daily` (só tabela nova + relação inversa em `Tenant`). Volume: no pior caso
contas × pares recurso × tipo por dia (19 × 18 = 342 linhas/dia com `chat_send`, ~125 mil/ano, mais as telas da P3); retenção de 400 dias em lotes, no molde
de `INFRA_COST_SNAPSHOT_RETENTION_DAYS`.

### 4.4 Job da P2 (`FeatureUsageRollupJob`)

- Só em `WORKER_JOBS` (`worker`/`all`, nunca `http`); liga com `jobs.has('featureUsageRollup') && env.FEATURE_USAGE_ROLLUP_ENABLED`
  (padrão `false`, ligada só na Render). Nada roda no boot além de armar o timer.
- Lease `feature-usage-rollup` (`IJobLease.tryAcquire(name, ownerId, until, now)`, `ownerId = randomUUID()` por processo), tick de 15 min, TTL de 10 min (menor que o tick, como `INFRA_COST_SNAPSHOT_LEASE_TTL_MS`), `release` ao terminar; tick que ainda roda não é reentrado.
- A cada tick: recalcula **hoje e ontem** para os recursos `LIVE` com o mesmo SQL do leitor da P1 e grava com
  `INSERT (..., "updatedAt") VALUES (..., now) ON CONFLICT (day, "tenantId", "featureKey", kind) DO UPDATE SET uses = EXCLUDED.uses, "updatedAt" = EXCLUDED."updatedAt"`
  (idempotente; linha que zerou é removida). `"updatedAt"` vai explícito porque `@updatedAt` não cria `DEFAULT` no banco.
  O `replaceDay` de um dia (apagar as linhas das chaves que zeraram + `INSERT ... ON CONFLICT`) roda numa **única
  transação**: falha no meio desfaz tudo e o dia fica como estava.
- **Uma fonte por faixa de data:** o job nunca grava recurso `RECORDED`, nem dia ≥ `recordedFrom` de recurso que tem
  data de corte (`offer_story`). O `replaceDay(day, keys, rows)` recebe só as chaves que o job pode gravar naquele dia;
  o que não está em `keys` não é tocado nem apagado. Assim o +1 do contador nunca é sobrescrito.
- Backfill: lease `feature-usage-backfill` (TTL 10 min); a cada tick processa no máximo 7 dias para trás, a partir do dia mais
  antigo já gravado, até o primeiro dado das fontes (2026-10-26 hoje: 4 ticks). Sem escrita em massa.
- **Marco do backfill:** ao terminar, o use case grava `platform_settings["feature_usage_rollup"] = { backfillCompletedAt, backfilledFrom }`
  (upsert pelo Prisma, molde `PrismaFeatureAudienceRepository`). A leitura (T22) consulta essa linha a cada pedido para
  decidir se o agregado pode responder. Nada disso fica em memória: réplica nova ou reinício leem o mesmo marco.
- Retenção: lease `feature-usage-retention` (24 h), apaga `day < hoje − 400` em lotes de 5 mil com `SET LOCAL statement_timeout`.

### 4.5 Contador (`IFeatureUsageRecorder`, P2 e P3)

Duas operações, as duas com `"updatedAt"` explícito no `INSERT` e no `DO UPDATE`:
- `increment({ tenantId, featureKey, kind, at })` → `ON CONFLICT DO UPDATE SET uses = feature_usage_daily.uses + 1` (Story, chat);
- `markOnce({ tenantId, featureKey, kind, at })` → `INSERT` com `uses = 1` e `ON CONFLICT DO NOTHING` (visita de tela: idempotente por dia × conta × tela).

Chamado sem `await` bloqueante e com `catch` que só loga (`warn`): falha do contador não falha o use case.
O contador recebe só conta, chave, tipo e instante. O `day` gravado sai de `dayInZone(at)` (helper de fuso do domínio,
T2), nunca do dia UTC: uso às 00:30 UTC conta no dia anterior de Brasília, igual à fonte viva.

**Data de corte (`recordedFrom`):** constante por recurso no catálogo. `offer_story` nasce na P1 sem corte (fonte
`LIVE`, `ai_usage_logs`). A T21, que liga o contador, preenche `OFFER_STORY_RECORDED_FROM` com o dia seguinte ao deploy
previsto da P2 (conferido de novo na R2 e no checklist da T24: se o deploy atrasar, a constante é adiada antes de ligar).
Antes do corte: fonte `LIVE`, código `AI_HEADLINE_ONLY`. A partir do corte: só o contador, cobertura total; o contador
ignora chamadas com dia < corte e o leitor `LIVE` não devolve `offer_story` para dia ≥ corte.

**Todo recurso `RECORDED` tem `recordedFrom` no catálogo:** `OFFER_STORY_RECORDED_FROM` e `CHAT_SEND_RECORDED_FROM`
(T21, mesma regra: dia seguinte ao deploy previsto da P2) e `PAGE_VIEW_RECORDED_FROM` para as chaves `view:*` (T28, dia
seguinte ao deploy previsto da P3). `chat_send` e `view:*` não têm fonte anterior ao corte. O rollup nunca grava
recurso `RECORDED`.

**`chat_send` só conta envio do painel:** o `SendMessageUseCase` também é usado pelo envio automático de oferta
(`campaigns/infrastructure/adapters/ChatOfferMessageSender.ts`). O input ganha `origin: 'PANEL' | 'AUTOMATION'`
(obrigatório): a rota do painel (`chat.routes.ts`) informa `PANEL`, o adapter de ofertas informa `AUTOMATION`, e o
contador só soma em `PANEL`. A mesma regra vale para `SendMediaMessageUseCase` (mídia enviada pelo painel conta).

**Leitura de recurso `RECORDED`:** sempre de `feature_usage_daily`, qualquer que seja a fonte escolhida para os
recursos `LIVE` (agregado ou sob demanda).

**`dataFrom` e cobertura por recurso na P2:** recurso com agregado deixa de ter o corte de retenção a partir do
primeiro dia agregado (`dataFrom` = o menor entre o primeiro dia agregado e o `dataFrom` da fonte viva), e os códigos
`RETENTION`/`EXISTING_ONLY` só aparecem quando o período pedido começa antes desse dia. Recurso `RECORDED` tem
`dataFrom = recordedFrom` e `firstDataDay` = `MIN(day)` dele em `feature_usage_daily` (`null` enquanto ninguém usou):
o `firstDataDays` do leitor diário é `SELECT "featureKey" AS key, to_char(MIN(day), 'YYYY-MM-DD') AS first FROM
feature_usage_daily GROUP BY "featureKey"`, uma linha a mais no `UNION ALL` quando os recursos `LIVE` são lidos sob demanda.

**Granularidade do leitor diário:** o leitor recebe a granularidade. Até 90 dias devolve linha por dia. Acima de 90
dias a granularidade mínima é semana (o schema recusa `day`, e o painel desabilita "Dia") e o SQL já agrupa:
`date_trunc('week'|'month', day)` como bucket, `"tenantId"`, `"featureKey"`, `kind`, `sum(uses)::int AS uses`,
`count(DISTINCT day)::int AS "activeDays"`, `to_char(max(day), 'YYYY-MM-DD') AS "lastDay"` (bucket também em texto por `to_char`). A linha interna ganha `activeDays` e `lastDay`
(numa linha por dia valem 1 e o próprio dia), para "último uso", dias ativos da lista de contas e recorrência da P3
continuarem exatos com menos linhas. `date_trunc('week')` começa na segunda, como os buckets do domínio.

### 4.6 Visita de tela (P3)

`POST ${API_PREFIX}/usage/page-views` (plugin `usagePageViewRoutes`, prefixo `/usage`, classe `'TENANT'` em
`ROUTE_PRODUCT_MAP`: rota da conta, fora do gate de produto; `authHook` + `tenantHook`, corpo `{ key }`): `key` validada contra a lista fechada das
chaves de `buildNavigation` espelhada no catálogo (`view:offers`, `view:monitoring`, …). Super admin não conta.
O painel envia quando a rota muda para um item do menu, no máximo 1 vez por chave × aba × dia (marcador em
`sessionStorage`, conveniência; o servidor não depende dele). Sem `userId`, IP ou URL gravados. Resposta 204.

- **Idempotente no servidor:** `markOnce` grava no máximo uma linha por dia × conta × tela (`ON CONFLICT DO NOTHING`,
  `uses = 1`). A medida é "contas que abriram a tela no dia", não número de aberturas; repetir a chamada não muda nada.
- **Limite de taxa no servidor:** `config: { rateLimit: perTenantRateLimit(rateLimitPresets.usagePageViews) }`
  (`@fastify/rate-limit`, preset novo de 60 por minuto por conta em `shared/http/rateLimitPresets.ts`), com teste de rota.
- **Leitura das telas fora da linha em memória:** `GET /admin/usage/screens` usa consulta própria já agregada no SQL
  (`SELECT "featureKey", count(DISTINCT "tenantId")::int AS tenants, count(*)::int AS "tenantDays" FROM feature_usage_daily
  WHERE "featureKey" LIKE 'view:%' AND day no período GROUP BY "featureKey"`, com o mesmo recorte de contas), sob o
  mesmo orçamento e a mesma vaga de leitura. As chaves `view:*` nunca entram nas linhas do resumo nem na guarda de 300 mil.

## 5. API

Todas `GET`, `preHandler = [authHook, superAdminHook]`, resposta `httpResponse.ok`.

**Query comum:** `from`, `to` (`YYYY-MM-DD`, inclusivos, no fuso da feature), `granularity` (`day|week|month`),
`product`, `kind` (lista), `plan` (`COPYSYNC_LITE|COPYSYNC_PRO|COPYSYNC_MAX|SAVER_LITE|SAVER_PRO|SAVER_MAX|NONE`; ausente = todos;
um slug restringe contas e recursos à família dele; `NONE` = contas sem plano em cada família, §4.2), `tenantStatus`
(`ACTIVE|SUSPENDED|CANCELLED|ALL`), `includeInternal` (`true|false`), `tenantId?`.

**Padrões no schema da rota** (`featureUsage.schema.ts`; pedido sem query responde com eles): período = últimos 30 dias
terminando hoje em Brasília (relógio do servidor), `granularity` = `day` até 31 dias e `week` acima, `kind` =
`ACTION,AUTOMATIC`, `tenantStatus` = `ACTIVE`, `includeInternal` = `false`, `product` e `plan` = todos. O painel envia
todos os filtros explícitos; os padrões servem a quem chama a API direto e são os mesmos de `DEFAULT_USAGE_FILTERS`.
Granularidade × período: `day` só é aceito até 90 dias; acima disso o schema devolve 400 de validação e o padrão passa
a `week`. Período máximo em duas camadas: o **schema** valida o formato das datas e o teto absoluto de 400 dias; o **use case**
aplica o teto da fonte (90 dias sem agregado na P1; 400 quando o agregado responde) e lança
`USAGE_METRICS_RANGE_INVALID` (400). `range.maxDays` devolve o teto em vigor; o painel bloqueia o personalizado acima
dele antes de enviar e, se mesmo assim receber esse erro, mostra o aviso do período e volta ao preset padrão.
Sem token = 401; autenticado sem super admin = 401 `UNAUTHORIZED` (é o que o `superAdminHook` lança hoje).

### `GET /admin/usage/summary`

```jsonc
{
  "range": { "from": "2026-10-19", "to": "2026-11-17", "timeZone": "America/Sao_Paulo",
             "previousFrom": "2026-09-19", "previousTo": "2026-10-18", "granularity": "day", "maxDays": 90 },
  "source": "live",                       // "daily" na P2
  "freshAt": "2026-11-17T18:02:11.000Z",  // agora (live) ou última atualização do agregado
  "population": { "tenants": 15, "internalExcluded": 4,
                  "byPlan": [{ "family": "AFFILIATES", "plan": "COPYSYNC_MAX", "tenants": 7 },
                             { "family": "SAVER", "plan": "NONE", "tenants": 15 }] },
  "totals": { "activeTenants": 0, "activeTenantsPrevious": null,   // contas distintas entre recursos
              "featuresUsed": 0, "featuresNeverUsed": 0,
              "topFeature": "group_monitoring" },                 // por contas que usaram; null sem uso
  "features": [{
    "key": "offer_generator", "product": "AFFILIATES", "planFamily": "AFFILIATES", "kinds": ["ACTION"],
    "coverage": "FULL", "coverageReasons": [], "retentionDays": null,
    "firstDataDay": "2026-10-26", "dataFrom": "2026-10-26",
    "uses": 0, "usesPrevious": null, "activeTenants": 0, "activeTenantsPrevious": null,
    "reach": 0.0, "lastUsedDay": null,
    "byKind": [{ "kind": "ACTION", "uses": 0, "activeTenants": 0 }],
    "byPlan": [{ "plan": "COPYSYNC_LITE", "tenants": 5, "activeTenants": 0, "uses": 0 }],   // plan pode ser "NONE"
    "eligibleTenants": null, "adoption": null, "recurringTenants": null, "retainedTenants": null   // P3
  }],
  "series": [{ "bucket": "2026-11-17", "activeTenants": 0 }]
}
```

Sem nome de conta, sem rótulo (rótulo é do painel). Não há `totals.uses`: usos só existem por recurso (somar recursos
contaria a mesma oferta na criação e no envio). Não há contagem de usuários. `population.byPlan` traz as duas famílias;
em cada uma, cada conta do recorte conta uma vez (plano ou `"NONE"`), o mesmo número de `features[].byPlan[].tenants`
dos recursos daquela família; as famílias não se somam (§4.2). `reach` = contas que usaram ÷ contas do recorte na
família do recurso. `kinds` = tipos que o recurso pode ter; o filtro `kind` recorta as
linhas, então `uses` e `activeTenants` de um recurso com dois tipos (Caçador) refletem só os tipos pedidos, e `byKind`
traz a quebra. `coverageReasons` traz só os motivos que valem para o período pedido (regra em §4.1) e `coverage` =
`PARTIAL` quando a lista não é vazia; códigos: `EXISTING_ONLY`, `RETENTION`, `AI_HEADLINE_ONLY`, `MIXED_EVENTS`,
`MIXED_TRIGGERS`, `TOKEN_CHANGE_ONLY`. `retentionDays` = retenção da fonte (30, 90 ou `null`).
`firstDataDay` = primeiro dado real do recurso (`null` sem dado); `dataFrom` = limite efetivo, o maior entre
`firstDataDay` e hoje menos `retentionDays` (§4.1). `usesPrevious`/`activeTenantsPrevious` do recurso = `null` quando
o período anterior começa antes de `dataFrom`.

**Recorte por tipo:** `features[]`, `featuresUsed`, `featuresNeverUsed`, `topFeature` e o total de recursos (o "N" de
"x de N") consideram só recursos cujos `kinds` cruzam o filtro `kind`. Recurso fora do tipo pedido não vem na resposta,
nem como nunca usado: com o padrão (`ACTION,AUTOMATIC`), `panel_login` e `link_rotation_click` não aparecem.
`MIXED_TRIGGERS` é o motivo fixo de `ai_rewrite` e `offer_dispatch` (D11).

### `GET /admin/usage/features/:featureKey`

Mesmo recorte; devolve o item do recurso + `series` do recurso (`{ bucket, uses, activeTenants }`). `featureKey` fora do catálogo = 404 `USAGE_METRICS_FEATURE_NOT_FOUND`.

### `GET /admin/usage/features/:featureKey/tenants?cursor=`

O painel só chama esta rota **depois** que `GET /admin/usage/features/:featureKey` respondeu, e nunca dispara duas
leituras de uso ao mesmo tempo (resumo, detalhe, lista de contas, "Carregar mais"): com o `usageReadGate` de uma vaga
por processo, a segunda chamada simultânea receberia 503.

```jsonc
{ "items": [{ "tenantId": "...", "tenantName": "...", "plan": "COPYSYNC_PRO", "status": "ACTIVE",
              "internal": false, "uses": 0, "activeDays": 0, "lastUsedDay": "2026-11-17" }],
  "nextCursor": "..." }
```

Página de 25 (servidor decide), ordem `(uses desc, tenantId asc)`, cursor no molde de `infraCostTenantCursor.ts` com
escopo = `featureKey` + hash dos filtros (cursor de outro recurso ou de outro recorte = 400). Primeira página grava `USAGE_METRICS_VIEWED` com `{ kind: 'tenants', featureKey, filters, count }`.
`plan` de cada item é o da família do produto do recurso (§4.2; pode ser `NONE`).
`tenantName` é o único dado sensível da feature; o painel borra. Não há endpoint para buscar o nome de uma conta
avulsa: o chip do filtro de conta usa o nome desta lista quando ela está carregada e, senão, o id curto.

### P3

`GET /admin/usage/summary` passa a preencher `eligibleTenants`, `adoption`, `recurringTenants`, `retainedTenants`
(parâmetro `recurringDays`, padrão 3). Direito ao recurso: o leitor busca a linha de `tenant_products` do produto
**fonte** (`accessSourceOf(product)`: `CHAT` segue `AFFILIATES`) e só então chama `resolveProductAccess`. `GET /admin/usage/screens` devolve o ranking das chaves `view:*`.
`POST /usage/page-views` (§4.6).

## 6. Erros (`shared/errors/internal/UsageMetricsErrors.ts`, estendem `AppError`)

| Erro | Código | HTTP | Quando |
| --- | --- | --- | --- |
| `UsageMetricsRangeInvalidError` | `USAGE_METRICS_RANGE_INVALID` | 400 | Lançado pelo use case: `from > to`, data futura, período acima do teto da fonte (90 dias sem agregado, 400 com). Formato inválido, mais de 400 dias e granularidade `day` acima de 90 dias param antes, no schema (400 de validação) |
| `UsageMetricsFeatureNotFoundError` | `USAGE_METRICS_FEATURE_NOT_FOUND` | 404 | Chave fora do catálogo |
| `UsageMetricsCursorInvalidError` | `USAGE_METRICS_CURSOR_INVALID` | 400 | Cursor adulterado, vencido, de outro recurso ou de outro recorte |
| `UsageMetricsReadUnavailableError` | `USAGE_METRICS_READ_UNAVAILABLE` | 503 | Orçamento de 2 s do pedido esgotado (inclusive esperando conexão), `statement_timeout` (SQLSTATE 57014), outra leitura de uso em andamento no mesmo processo, ou linhas acima da guarda (100 mil sob demanda, 300 mil no agregado) |

Painel: o `apiClient` trata todo 503 como serviço indisponível; os hooks da feature olham o código antes
(`USAGE_METRICS_READ_UNAVAILABLE` → `slow`, molde `isSlow` de `useCostSummary.ts`) e mostram `Alert` com "Tentar de novo".
Outro 502/503/504 segue para `ServiceUpdatingState`. Cursor inválido → recarrega do início com `CursorResetNotice`.

## 7. Tela

Rota `/admin/usage`, título "Uso dos recursos", seção Plataforma. Abas por sub-rota: **Visão geral** (`/admin/usage`),
**Por plano** (`/admin/usage/plans`), **Telas** (P3, `/admin/usage/screens`); o detalhe abre em
`/admin/usage/features/:key` (recurso aberto na URL, sobrevive a reload), com a aba **Visão geral** marcada e um
"voltar" para ela.

```
Desktop (≥ md)
┌ PageHeader: Uso dos recursos ················ [Exportar CSV] [Atualizar] ┐
│ Filtros: [Hoje|7d|30d|90d|Personalizado] [Dia|Semana|Mês] Produto ▾ Tipo ▾ Plano ▾ Status ▾ (○ internas) [Conta ✕] │
│ "Dias no horário de Brasília · dados desde 26/10 · atualizado às 15:02"                                  │
├ KPIs ─────────────────────────────────────────────────────────────────────┤
│ Contas ativas (12 de 15, +2)   │   Recursos usados (11 de 14)   │   Mais usado (Monitoramento, 11 contas)   │
├ Ranking de recursos (barras horizontais) ───────┬ Tendência (linha) ──────┤
│ ordenar: [Contas | Usos | Tendência]            │ contas ativas ou recurso │
│ Monitoramento  ████████████ 11 contas · 24 mil  │                          │
│ Gerador        █████ 5 · 89          [ação]     │                          │
├ Nunca usados no período (chips) ──────────────────────────────────────────┤
└───────────────────────────────────────────────────────────────────────────┘
Aba Por plano: tabela recurso × plano (contas que usaram / contas do plano, e usos), 1ª coluna fixa.
Detalhe: medidas do recurso, série, quebra por plano, tabela "Contas que mais usam" (nome borrado, "Carregar mais").
Mobile (390 px): filtros em gaveta ("Filtros (3)"), KPIs empilhados, ranking e tendência empilhados, tabelas com rolagem
interna e 1ª coluna fixa; nenhuma rolagem horizontal da página.
```

- **KPIs:** três `StatCard` (contas ativas, recursos usados, mais usado) com valor, comparação ("+2 contas", "sem base de comparação") e `Tooltip` com a definição. Não há KPI de usos somados.
- **Ranking:** `BarChart` horizontal do `@mui/x-charts`, uma cor (`chartColors(mode)`), no máximo 12 barras + "ver todos"
  na tabela; rótulo de cada tipo do recurso (`ação`/`automático`/`audiência`; o Caçador pode levar dois) e `CoverageChip` quando parcial. Clique na barra ou na
  linha da tabela abre o detalhe. Tabela alternativa sempre disponível (acessibilidade).
- **Tendência:** `LineChart`, eixo em dia/semana/mês; sem recurso escolhido mostra contas ativas por bucket; com recurso, usos e contas dele, e o período anterior em linha tracejada quando há base.
- **Estados:** carregando = `Skeleton` no formato de cada bloco; vazio = `EmptyState` ("Nenhum uso neste recorte" + limpar filtros);
  erro, leitura lenta e outra leitura em andamento (503 `USAGE_METRICS_READ_UNAVAILABLE`) = `Alert` + "Tentar de novo"; API em deploy = `ServiceUpdatingState`.
  Resposta de pedido antigo é descartada (o `apiClient` não cancela requisição).
- **Período:** "hoje" e os presets usam `serverNow()`, nunca `Date.now()`. O filtro guarda o preset (`today`, `7d`, `30d`, `90d`, `custom`) e as datas só no `custom`; assim "30 dias" salvo ontem continua sendo os últimos 30 dias hoje. Personalizado acima de `range.maxDays` ou no futuro é barrado no formulário (mensagem ao lado do campo) e descartado por `parseUsageFilters` ao reler.
- **Granularidade:** "Dia" fica desabilitado (com `Tooltip`) quando o período passa de 90 dias; trocar para um período maior muda a granularidade para "Semana". O "N" de "Recursos usados (x de N)" é o total de recursos do recorte (14 no padrão ação + automático, 16 com todos os tipos).
- **"Dados desde":** usa `firstDataDay` do recurso (linha de contexto: o menor entre os recursos visíveis). O corte por retenção aparece pelo `CoverageChip` (`RETENTION`), não aqui.
- **Conta filtrada:** "filtrar por esta conta" no detalhe grava só `tenantId` em `UsageFilters` (nome é dado do servidor e não é persistido). O chip removível mostra o nome quando a conta está na lista carregada do detalhe e, senão, o id curto ("Conta 1a2b3c4d", molde `unknownTenant` do Saver admin), sempre sob `Blurred`. Depois de um reload fora do detalhe o chip mostra o id curto.
- **CSV:** botão gera no painel, a partir do resumo carregado, `uso-dos-recursos_<from>_<to>.csv` (BOM, `;`, colunas:
  recurso, produto, tipo, usos, contas que usaram, alcance, tendência, último uso). Sem nome de conta, então sem rota nem auditoria.
- **Persistência:** `usePersistedState<UsageFilters>('usage.filters', DEFAULT_USAGE_FILTERS, { scope: 'tab', version: 1, deserialize: parseUsageFilters })`;
  ordenação do ranking na mesma chave. Dado do servidor nunca é salvo.
- **Privacidade:** `{ id: 'usage', label: 'Uso dos recursos', flags: [{ id: 'usage.tenantName', label: 'Nome da conta' }] }`; `useBlur('usage.tenantName')` + `<Blurred>` na tabela de contas e no chip da conta filtrada.
- **Texto:** tudo em `featureUsageStrings`, sem marca; rótulos dos recursos iguais aos do menu (reusar as strings de navegação onde já existem). Sem ícone de brilho.
- **Ícones:** Lucide via `AppIcon` (`sm`/`md`), `Tooltip` do MUI em todo botão de ícone; ícone do menu `ChartColumn`.

## 8. Decisões técnicas

| # | Decisão | Motivo |
| --- | --- | --- |
| D1 | Dentro de `metrics`, sem módulo novo | Mesmo dono de custos e ops; evita módulo de uma tela |
| D2 | Leitor único com duas implementações | P2 troca a fonte sem tocar conta nem tela |
| D3 | Agregação em função pura no domínio; o SQL só reduz o volume (semana ou mês acima de 90 dias; telas da P3 agregadas) | Testável sem banco; volume cabe em memória: sob demanda 58 mil linhas no pior caso de hoje (guarda de 100 mil, 32 contas); agregado 62 mil (guarda de 300 mil, 92 contas em uso denso). Rever quando uma guarda disparar ou perto desses números |
| D4 | Sem cache de rota na P1 | Rotas de custos também não têm; treze idas pequenas ao banco sob orçamento de 2 s; cache em memória seria estado por processo. P2 resolve com o agregado |
| D5 | Plano e status de **hoje** | Não há histórico de plano; a tela avisa no tooltip do filtro |
| D6 | Dois índices novos na P1 (`offers(createdAt)`, `offer_dispatches(status, updatedAt)`, com `IF NOT EXISTS`); nenhum nas tabelas pequenas | Os índices atuais começam por `tenantId` e não servem filtro só por período; nas duas tabelas grandes (24 mil e 216 mil linhas) isso seria varredura a cada pedido. A migration roda no boot sem `CONCURRENTLY` e bloqueia escrita em `offer_dispatches` (worker de envio) enquanto cria: a T5a mede o tempo com 250 mil linhas; acima de 2 s, o índice é criado antes do deploy com `CREATE INDEX CONCURRENTLY IF NOT EXISTS` e a migration vira no-op. `link_clicks` e as demais têm dezenas ou centenas de linhas; índice só se o `EXPLAIN` da P2 pedir |
| D7 | Auditar só detalhe por conta | Resumo não tem dado sensível; auditar cada abertura encheria `audit_logs` |
| D8 | Agregado só com contagem, sem `userId`; sem "usuários distintos" | Nada produz esse número hoje e ele exigiria reter `userId` por uso; fica para o futuro |
| D9 | Visita mede item do menu, não URL | Lista fechada, sem id de recurso do cliente no caminho |
| D10 | Rótulo no painel, chave na API | White label e i18n num lugar só |
| D11 | Tipo de uso é do evento, não do recurso. **Exceção:** `ai_rewrite` e `offer_dispatch` têm tipo fixo `AUTOMATIC` com o motivo `MIXED_TRIGGERS` | O Caçador tem execução manual e agendada (`OfferHuntRunTrigger`); tipo fixo por recurso erraria o filtro "só ação". Nos dois da exceção a fonte não distingue manual de automático (`AiUsageLog` sem origem; envio exigiria join novo), então ficam como automático e a tela avisa; "só ação" não os mostra |
| D12 | Uma fonte por faixa de data em cada recurso | Duas fontes na mesma chave fariam o rollup apagar o contador; a data de corte no catálogo decide quem grava cada dia |
| D13 | Visita idempotente por dia × conta × tela | Mede contas que abriram, não aberturas; chamada repetida ou forjada não infla o número |
| D14 | Marco do backfill em `platform_settings` | "Backfill concluído" precisa valer para toda réplica e sobreviver a reinício; memória não serve (`docs/arquitetura-escala.md`) |
| D15 | Origem explícita no envio do chat | O mesmo use case serve o painel e o envio automático de oferta; sem a origem o contador contaria automação como pessoa |
| D16 | Contrato amarrado por fixture em `contracts/feature-usage/` | API e painel não se importam; sem um arquivo comum, campo renomeado só apareceria no smoke. Os dois testes leem o mesmo JSON por caminho de arquivo |
| D17 | Recorte por tipo vale para "nunca usado" e para o total de recursos | Com o padrão ação + automático, recurso só de acesso ou audiência apareceria como nunca usado sem ter sido medido |

## 9. O que não fazer

- Nome de função, tabela, rota, evento ou chave com a marca; tudo descreve o recurso (`featureUsage*`, `feature_usage_daily`).
- Consulta de uso sem `tenantId` no agrupamento (a de primeiro dado, `firstDataDays`, é a única sem conta: devolve só um instante por recurso); devolver model Prisma; Prisma fora da infraestrutura; regra no handler.
- Ler conteúdo: texto de mensagem, nome/telefone de contato, título/link de oferta, e-mail, IP, `meta` de auditoria
  (exceção única: o booleano `meta.completed` de `SAVER_EXPORTED`). Métrica é contagem.
  Nada de `saver_contacts` nem `chat_contacts`.
- Somar usos de recursos diferentes num total; converter dia com um só `AT TIME ZONE`; `Date.now()` do navegador para "hoje".
- Devolver nome de conta fora do endpoint de contas; devolver lista de contas sem cursor assinado; aceitar `limit`/`offset` do painel.
- Estado operacional novo em memória (contador, buffer de eventos, cache de resultado): `docs/arquitetura-escala.md`.
  O semáforo `usageReadGate` não é isso: é um limitador de concorrência local, sem dado de negócio, que pode zerar
  a qualquer reinício e não precisa valer entre réplicas. Não usar esse argumento para guardar resultado ou contagem.
- Rodar as instruções de uma leitura em paralelo; aceitar granularidade `day` acima de 90 dias; ler as chaves `view:*` pelas linhas do resumo; recurso `RECORDED` sem `recordedFrom`.
- Chamar a Render, instalar APM, expor `/metrics` público ou script de analytics externo.
- Biblioteca nova de gráfico, de data ou de i18n.
- Job fora do `worker`, sem lease ou ligado por padrão; escrita em massa no boot; backfill sem passo limitado.
- Editar migration aplicada; `db push`; rodar `prisma migrate deploy`/`start:migrate` fora do Postgres descartável (`api/.env` = produção).
- Gravar `userId`, IP ou URL na visita de tela; contar super admin; aceitar chave de tela fora da lista.
- Deixar o contador derrubar o use case (sempre fail-open) ou o job sobrescrever recurso `RECORDED` ou dia a partir da data de corte.
- `INSERT` cru em `feature_usage_daily` sem `"updatedAt"` (a coluna não tem `DEFAULT`); somar visita a cada abertura; rota de visita sem limite de taxa.
- Somar as duas famílias de plano; tratar o tipo de uso como atributo fixo do recurso (fora a exceção de D11); tratar `Tenant.planSlug` como prova de plano ativo.
- `count(*)` sem `::int`; devolver o dia como `date`; `SET LOCAL statement_timeout = 0` ou menor que 1 ms; uma transação só para todas as fontes; confiar no `statement_timeout` para cobrir a espera por conexão.
- Listar como "nunca usado" recurso fora do filtro de tipo; persistir datas absolutas de um preset; mudar o contrato sem atualizar a fixture de `contracts/feature-usage/`.
- Contar em `chat_send` envio que não veio da rota do painel; guardar "backfill concluído" em memória; contar execução `SKIPPED` do Caçador.
- Renomear recurso ou item de menu para caber no gráfico (ajustar o componente).
- Preço de plano em qualquer resposta; adoção calculada com preço ou receita.

## 10. Roadmap

Cabe em "Ferramentas operacionais da plataforma" de `docs/produto-roadmap.md`. Linha a acrescentar (na task de docs):

| Ferramenta | O que faz | Módulo | Status |
| --- | --- | --- | --- |
| Uso dos recursos | Ranking dos recursos por contas que usaram e por volume, tendência, quebra por plano e contas que mais usam (`/admin/usage`), só super admin | `metrics` ([doc](uso-dos-recursos.md)) | P1 |
