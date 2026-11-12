# Design — Custos da infraestrutura

**Spec:** [`spec.md`](spec.md) · **Status:** Draft

## 1. Visão geral

```
painel /admin/costs{,/prices,/tenants,/history}   (super admin; margem = PLAN_CATALOG × câmbio, só no painel)
        │ GET/PUT
        ▼
API (http) ── platform_settings["infra_costs"]  (preços, câmbio, itens manuais)
        │      ops_metrics_samples (P1: instâncias do worker agora, sessions_connected)
        │      PrismaWorkerCapacityReader (contratadas/conectadas por plano)
        │      infra_resource_hours · tenant_session_hours · ai_usage_logs · infra_cost_months   (P2/P3)
        ▼
 calculateInfraCosts (função pura)  ── nunca chama Render/Cloudflare

worker (lease "infra-cost-snapshot", tick 5 min, 1×/hora cheia, flag INFRA_COST_SNAPSHOT_ENABLED)
   ├─ IInfraResourcePlanReader ── Render API (GET serviço/Postgres/Key Value: plano, instâncias, suspenso)
   ├─ grava infra_resource_hours  (hour, resourceKey)
   ├─ 1×/dia após 16h30 UTC (P2, fx.auto, lease infra-fx-rate): PTAX (Olinda) → SGS 1 → infra_fx_rates
   ├─ grava tenant_session_hours  (day, tenantId; soma 1 h × conectadas se lastHour < hora)
   └─ 1ª hora do mês: fecha o mês anterior em infra_cost_months (P3) · limpeza diária > 400 dias
```

A fonte da verdade é o banco. A conta é uma função pura sobre (configuração, quantidades por hora, sessão-hora, tokens),
testável sem banco. Preços em USD; a API devolve USD e BRL (cotação da resposta); margem só no painel.

## 2. Reuso

| Peça | Onde | Como |
| --- | --- | --- |
| `PlatformSetting` + concorrência por `updatedAt` | `PrismaWorkerScalingSettingsRepository.ts` (`sessions/infrastructure/repositories/`) | Mesmo padrão de `get`/`save(expectedUpdatedAt)` e 409, chave `infra_costs` |
| Parse com campo e faixa | `sessions/domain/services/workerScalingSettings.ts` | Mesmo estilo de `parse…` com `field` no erro; listas com limite de tamanho |
| Configuração de escala (teto, ratio) | `workerScalingSettingsProvider().current()` | Custo marginal por sessão; ler a cada uso, nunca guardar (regra do `AGENTS.md`) |
| Capacidade por plano | `PrismaWorkerCapacityReader.ts` (`IWorkerCapacityReader`) | Contratadas e conectadas por plano (P1). Já filtra tenants `ACTIVE` e tem `statement_timeout` 2 s |
| Amostras | `PrismaOpsMetricsSampleRepository.ts`, `opsResourceKind`/`opsWorkerServiceId` (`metrics/domain/services/opsMetricsSeriesPolicy.ts`) | Última `sessions_connected`; instâncias distintas `worker_service` nos últimos 15 min |
| Cliente Render | `RenderPlatformMetricsSource.ts`, `RenderWorkerScaler.ts` | `fetchFn` injetável, `AbortSignal.timeout(5 s)`, chave nunca logada, tradução de 429 |
| Job sob lease | `OpsMetricsSamplerJob.ts`, `shared/jobs/IJobLease.ts`, `app/processJobs.ts` (`WORKER_JOBS`) | Tick `unref`, lease renovado antes de gravar, limpeza em lotes com `statement_timeout` |
| Auditoria sem tenant | `UpdateWorkerScalingSettingsUseCase` | `audit.create({ userId, action, meta: { before, after } })` |
| Cursor | `shared/http/pagination/OpaqueCursor.ts` | Lista por cliente (P3) |
| Tela com abas por sub-rota | `pages/admin/AdminWorkersPage.tsx` (`WORKER_TABS`, `activeWorkersTab`, `lazy`) | Mesmo desenho, página nova `AdminCostsPage.tsx` |
| Tela que edita | `features/workersAdmin/components/SettingsTab.tsx` + `useWorkerSettings.ts` | Rascunho persistido, diff na confirmação, 409 recarrega |
| Gráfico | `features/opsMetrics/components/TimeLineChart.tsx`, `@mui/x-charts` em chunk lazy | Histórico mensal (P3) |
| Catálogo de planos | `app/src/features/plans/catalog.ts` (`PLAN_CATALOG`: `price`, `priceAnnualMonthly`) | Margem; mapeia `COPYSYNC_LITE|PRO|MAX` → `lite|pro|max` |
| Privacidade | `features/privacy/privacyFlags.ts`, `Blurred` | Tela nova `costs` com flag `costs.tenantName` (P3) |

## 3. Componentes

### Backend (`api/src/modules/metrics/` — dado operacional da plataforma, junto do coletor)

| Componente | Camada | Responsabilidade |
| --- | --- | --- |
| `InfraCostSettings`, `parseInfraCostSettings`, `DEFAULT_INFRA_COST_SETTINGS` | `domain/services/infraCostSettings.ts` | Faixas, unicidade de `key`, limites de lista, valores iniciais, origem |
| `calculateInfraCosts(input)` | `domain/services/infraCostCalculator.ts` | Função pura: custo por item (fixo, por instância, uso), por hora quando há leitura, projeção, rateio por sessão-hora/contratadas, por plano e por tenant, custo marginal por sessão, avisos (`plan_without_price`, `model_without_price`, `missing_hours`, `price_to_confirm`, `fx_missing`, `unlimited_contracted`) |
| `IInfraCostSettingsRepository` / `PrismaInfraCostSettingsRepository` | contrato / `infrastructure/repositories` | `platform_settings`, 409 por `updatedAt` |
| `IInfraCostUsageReader` / `PrismaInfraCostUsageReader` | contrato / repositório | Agregados do mês: horas por recurso (P2), sessão-hora por plano/tenant (P2), tokens por modelo e tenant (P3); `statement_timeout` 2 s |
| `GetInfraCostSettingsUseCase`, `UpdateInfraCostSettingsUseCase` | `application/use-cases` | Leitura com origem; validação, gravação, auditoria |
| `GetInfraCostSummaryUseCase` | `application/use-cases` | Junta configuração, leitor de capacidade (porta do `sessions`), amostras, uso do mês; chama o calculador |
| `ListInfraCostTenantsUseCase` (P3) | `application/use-cases` | Página por cliente, ordenada por custo |
| `IInfraResourcePlanReader` / `RenderInfraResourcePlanReader` / `NotConfiguredInfraResourcePlanReader` | contrato / `infrastructure/sources` | `GET /v1/services/{id}` (`serviceDetails.plan`, `numInstances`, `suspended`), `GET /v1/postgres/{id}` e `GET /v1/key-value/{id}` (`plan`, `status`). Tipo pelo prefixo do id (`srv-`, `dpg-`, `red-`). Formato das respostas conferido numa leitura real antes de ligar (como a unidade das métricas) |
| `InfraCostSnapshotJob` | `infrastructure/jobs` | COST-09/10/15; lease, hora cheia, idempotência, limpeza |
| `IInfraCostSnapshotRepository` / `PrismaInfraCostSnapshotRepository` | contrato / repositório | `upsert` de `infra_resource_hours`; incremento condicional de `tenant_session_hours`; fechamento; limpeza em lotes |
| `IFxRateSource` / `BcbPtaxFxRateSource` + `BcbSgsFxRateSource` (P2) | contrato / `infrastructure/sources` | Olinda `CotacaoDolarPeriodo` (janela 7 dias, `cotacaoVenda`, `dataHoraCotacao`) e SGS série 1 (`ultimos/1`); URLs fixas, timeout 5 s, `fetchFn` injetável, valor finito 1–20 |
| `infraCosts.routes.ts` (+ schema, presenter) | `presentation/routes` | `GET`/`PUT /admin/costs/settings`, `GET /admin/costs/summary`, `GET /admin/costs/tenants` (P3), `GET /admin/costs/history` (P3); `authHook` + `superAdminHook` |

O `metrics` lê a capacidade por plano pela porta `IWorkerCapacityReader` de `sessions/domain/contracts`, injetada na
composição (não importa a classe Prisma de outro módulo).

### Painel (`app/src/features/infraCosts/`)

| Componente | Responsabilidade |
| --- | --- |
| `types.ts`, `strings.ts` | Contratos e textos (pt-BR, sem marca) |
| `rules.ts` | `formatUsd`/`formatBrl` (2 casas, 4 abaixo de 0,01), `planMargin(planSlug, costBrl, catalog)`, `catalogSlugOf('COPYSYNC_LITE') → 'lite'`, `diffSettings`, `validateSettingsDraft`, rótulo de origem |
| `app/src/services/adminCosts.service.ts` | `getSettings`, `updateSettings`, `getSummary`, `listTenants`, `getHistory` |
| `pages/admin/AdminCostsPage.tsx` | Abas por sub-rota (`COST_TABS`, `activeCostsTab`), cada aba em chunk `lazy` |
| `components/SummaryTab.tsx` + `useCostSummary.ts` | Cartões, tabela por plano com margem, tabela de serviços, avisos, selo "estimado" |
| `components/PricesTab.tsx` + `useCostSettings.ts` | Itens, preços por plano da Render, preços por modelo de IA, câmbio; diálogo de confirmação com diff |
| `components/TenantsTab.tsx` (P3) | Lista paginada, `Blurred` no nome |
| `components/HistoryTab.tsx` (P3) | 12 meses, barras por plano, tabela |

Navegação: item `admin-costs` ("Custos", ícone `Receipt` ou `Wallet` via `AppIcon`) em `platform` de
`navigation/model.ts`, `matchPrefix: '/admin/costs'`; rótulo em `strings.ts`. Rotas em `AppRoutes.tsx`. Cartão da aba
Capacidade de Workers ganha link "Ver custos".

## 4. Dados

- **Configuração:** `platform_settings.key = 'infra_costs'`, JSON de COST-01. Sem migration.
- **`AuditAction`** (migration `add_audit_action_infra_costs`): `INFRA_COST_SETTINGS_CHANGED`; união em
  `shared/audit/IAuditLogRepository.ts`.
- **`infra_resource_hours`** (P2, migration `create_infra_cost_snapshots`): `hour timestamp` (UTC, hora cheia),
  `resourceKey text` (`api`|`worker`|`redis`|`postgres`|`static`), `plan text null`, `instances int`, `suspended bool`,
  `readAt timestamp default now()`. PK `(hour, resourceKey)`. Sem tenant (infra), sem id da Render.
- **`tenant_session_hours`** (P2, mesma migration): `day date`, `tenantId text` (FK `tenants`, `onDelete Cascade`),
  `planSlug text null` (último visto no dia), `connectedHours int`, `contractedSessions int null` (null = ilimitado), `lastHour timestamp`.
  Fonte das contratadas por tenant: leitor novo `IInfraTenantUsageReader.readHour()` (T13) — sessões `CONNECTED` com lease
  vivo e limite de sessões de `tenant_entitlements` por tenant `ACTIVE` (mesma regra numérica do
  `PrismaWorkerCapacityReader`, que só agrega por plano).
  PK `(day, tenantId)`, índice `(day)`. Tabela tenant-aware: toda leitura por tenant leva `tenantId`; os agregados de
  plataforma são `GROUP BY` de super admin.
- **`infra_cost_months`** (P3, migration `create_infra_cost_months`): `month date` PK, `totals jsonb` (itens, planos,
  câmbio, preços usados, avisos), `closedAt`. Por tenant do mês fechado: `infra_cost_month_tenants` (`month`, `tenantId`,
  `planSlug`, `sessionHours`, `sharedUsd`, `aiUsd`) PK `(month, tenantId)`.
- **`infra_fx_rates`** (P2, mesma migration dos snapshots): `referenceDate date` PK, `rate numeric(10,4)`, `source text`
  (`ptax`|`sgs`), `fetchedAt`. Retenção igual (400 dias).
- Volume: `infra_resource_hours` ≈ 5 × 8.760 = 44 mil linhas/ano; `tenant_session_hours` = tenants × 365.

Contagem por hora (job): sessões com `leaseUntil` vivo e status `CONNECTED` agrupadas por `tenantId` (mesma regra da
`sessions_connected`). Incremento:
`INSERT … ON CONFLICT (day, tenantId) DO UPDATE SET connectedHours = connectedHours + EXCLUDED.connectedHours, lastHour = EXCLUDED.lastHour WHERE tenant_session_hours.lastHour < EXCLUDED.lastHour`.

## 5. Conta (função pura)

- Horas do mês = horas do calendário em UTC (720/744/672/696). Custo de uma hora de um recurso = `monthlyUsd(plano) ÷ horas do mês × instâncias`
  (suspenso = 0). A Render cobra por segundo; a proporção por hora é aproximação documentada.
- Item `per_instance` sem leitura: `monthlyUsd × quantity`. Item `fixed`: `monthlyUsd × quantity`. Item `usage`: `monthlyUsd` informado.
- Armazenamento: `+ storage.gb × storage.usdPerGb` por mês (não multiplica por instância; disco/storage é do serviço). `gb` ou `usdPerGb` nulo → soma só a computação e aviso `price_to_confirm` com `key`; a tela mostra o item com "+ armazenamento a confirmar".
- **Compartilhado** = itens `allocation = shared` exceto IA. **Direto** = IA da plataforma por tenant (P3).
- Custo por sessão-hora = compartilhado do período ÷ Σ `connectedHours`; por sessão-mês = × 730 (média). Por tenant =
  `connectedHours × custo por sessão-hora + IA do tenant`. Por plano = soma dos tenants; por tenant médio = ÷ tenants
  `ACTIVE` do plano com sessão-hora > 0 (os sem uso aparecem à parte).
- Leitura por contratadas: compartilhado ÷ Σ sessões contratadas (último valor do mês).
- Ociosidade: `compartilhado × (1 − Σ sessão-hora ÷ (capacidade instalada × horas))` quando há `sessions_capacity`;
  senão `null`.
- Marginal: `preço por instância do worker ÷ (maxSessionsPerWorker × alertOccupancyRatio)`; é a referência de quanto
  custa uma sessão a mais quando o cluster está cheio.
- P1 sem séries: tudo multiplicado pelo mês inteiro com as quantidades de agora; "por sessão" usa a última
  `sessions_connected`; resposta marca `basis: 'snapshot'` (P2+: `'hours'`).
- Cotação: `resolveFxRate(fx, latestSaved, today)` (função pura) → `{ rate, referenceDate, source, stale }` na ordem
  override → última PTAX/SGS gravada → `null` (`fx_missing`); `last_known` quando a gravada é de busca anterior que
  falhou hoje. BRL = USD × `rate`, no servidor, para todo número da resposta.
- Arredondamento só na apresentação (COST-06b); a API devolve 4 casas em USD e BRL; somas sobre valores cheios.

## 6. Erros

| Cenário | Tratamento | Efeito para o admin |
| --- | --- | --- |
| Configuração inválida | 400 `INVALID_INFRA_COST_SETTINGS` com `field` | Erro no campo |
| Outro admin salvou antes | 409 `INFRA_COST_SETTINGS_CONFLICT` | Recarrega e descarta o rascunho |
| Preço por GB nulo | Aviso `price_to_confirm`; soma só a computação | Selo "a confirmar" no item |
| Plano lido sem preço | Aviso `plan_without_price` com `resourceKey` e `plan`; item com custo `null` | Cartão de aviso com atalho para Preços |
| Hora sem leitura | Usa quantidade manual; aviso `missing_hours` com contagem | Selo "estimado" |
| Render 429/5xx/timeout no job | Não grava a hora; `warn` uma vez por sequência; sem retry além do próximo tick | Hora "sem leitura" |
| Sem amostra/sem sessão | Campos `null` | "sem amostra" no lugar do número |
| Leitura lenta | `statement_timeout` 2 s → 503 genérico | Bloco com erro e "tentar de novo" |

## 7. Decisões técnicas

- **Módulo `metrics`:** custo é dado operacional de plataforma, como o coletor; evita módulo novo para 3 tabelas.
- **Ids fora do banco:** `INFRA_COST_RENDER_RESOURCES="api=srv-…,worker=srv-…,redis=red-…,postgres=dpg-…"` só no
  `worker`; parse em `shared/config` (como `env.ts`), lido na composição do job; chave fora da lista ou id inválido é ignorado com `warn` sem o id. O `worker`
  pode reaproveitar `WORKER_SCALER_SERVICE_ID` quando `worker=` faltar.
- **Por que não ler o plano no coletor de métricas:** o coletor roda a cada minuto e falha por tick; plano muda raramente
  e o custo precisa de uma linha por hora durável. Job separado, mesmo papel e mesma chave.
- **Mês fechado** congela preços e câmbio (D7); o mês corrente sempre usa a configuração atual (corrigir um preço errado
  conserta o mês em curso).
- **Margem só no painel:** a API devolve `costPerTenantUsd` por `planSlug`; o painel lê `PLAN_CATALOG`. Testes do painel
  travam que nenhum preço vai na requisição.
- **Sem flag de privacidade na P1/P2:** só números de plataforma e agregados por plano. A P3 cria a tela `costs` em
  `PRIVACY_SCREENS` com `costs.tenantName`.
- **Dono por job:** linha nova na tabela do §3.3 (`InfraCostSnapshotJob`: `worker`/`all`, lease global).

## 8. O que não fazer

- Chamar Render/Cloudflare numa rota; guardar ou devolver id de recurso da Render, chave ou resposta crua.
- Preço de plano (R$) no banco, na API ou em env.
- Custo 0 quando falta preço (sempre aviso + `null`).
- Ler `WORKER_MAX_*` (usar o provider da escala).
- Persistir resposta da API no painel; só filtros e rascunho.
- `Date.now()` do navegador para "mês corrente": usar `serverNow()`.
