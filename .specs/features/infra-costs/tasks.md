# Custos da infraestrutura — Tasks

**Spec:** [`spec.md`](spec.md) · **Design:** [`design.md`](design.md) · **Status:** Draft, aguarda aprovação do dono

## Regras comuns

**Branch e merge** (memória `branch-integracao-rebranding`):
- Tudo nasce de `feature/rebranding-app`. Branch da feature: `feature/infra-costs`. Cada tarefa roda em worktree próprio
  com branch `ic/t<N>` saído do topo de `feature/infra-costs`; aprovada no gate, entra por `cherry-pick`.
- Fim de cada fase: gate completo + revisão convergida → `git merge --no-ff feature/infra-costs` **local** em
  `feature/rebranding-app`. **Sem push** sem o dono pedir.
- `git add` só com caminhos explícitos; arquivos do dono fora de qualquer commit (`.specs/features/plans-modal/`,
  `.specs/features/product-access/`, `.specs/features/saver/`, `docs/mensagens-interativas.md`; conferir com `git status`
  no início de cada fase). `git show --stat HEAD` depois de cada commit.
- Um commit por tarefa, `tipo(escopo): descrição` + `Co-Authored-By`. Migration nova nunca edita migration aplicada; timestamp
  maior que a última do topo (hoje `20261111150000`).
- **Versões:** próxima minor acima do topo no início de cada fase (hoje api 0.86.0 · app 0.106.0 → P1 previsto
  api 0.87.0 · app 0.107.0, P2 0.88.0 · 0.108.0, P3 0.89.0 · 0.109.0; reconferir no topo antes, outra feature pode
  ter usado). `package.json` + `CHANGELOG.md` juntos.

**Subagentes e RAM** (memória `ram-mac-subagentes`): no máximo **7** ao mesmo tempo; no máximo **1** com Postgres
descartável (porta 55432), tarefas `integration-db` sempre em sequência. Monitor de `memory_pressure` armado em toda
onda (ATENÇÃO < 25% livre: não abrir frente nova; CRÍTICO < 12%: avisar o dono, não matar agente). Vitest
`--maxWorkers=2`; integração `--maxWorkers=1 --no-file-parallelism`. Cada agente recebe só a própria tarefa,
`design.md`, `.specs/codebase/TESTING.md` e os arquivos de `Where`/`Reuses`.

**Segurança:** nunca `api/.env`/`api/.env.dev` (produção); nunca `prisma migrate deploy`/`start:migrate` fora do
descartável; nenhuma chamada real à Render em teste (`fetchFn` falso); nenhuma escrita no banco de produção; ids da
Render nunca em código, teste, doc, log ou resposta (use `srv-teste` etc.).

**Gates** (`.specs/codebase/TESTING.md`): `quick` = `pnpm test -- --maxWorkers=2` no pacote; `full` = `pnpm typecheck
&& pnpm test -- --maxWorkers=2` em `api/` e `app/`; `integration-db` = `api/scripts/postgres-descartavel.sh start` →
`INTEGRATION_DATABASE_URL=<url> pnpm exec vitest run --config vitest.int.config.mts --project db --maxWorkers=1
--no-file-parallelism` → `stop`; `build` = `pnpm build` no `app/`.

**Revisão** (`/caveman-review`, memória `revisao-sem-loop`): uma por fase, `cavecrew-reviewer` sobre
`git diff feature/rebranding-app...feature/infra-costs`, uma linha por achado com arquivo:linha; só contradição com
código ou spec. 🔴 corrige e revisa o trecho; 🟡 corrige ou "aceito" com motivo; para quando sobrar só 🔵. Smoke
visual pelo `agent-browser` (claro, escuro, 390 px). Registro em `review.md`.

## Status

| ID | Título | Deps | [P] | Status |
| --- | --- | --- | --- | --- |
| T1 | Domínio da configuração de custos | — | P | pendente |
| T2 | Calculador (função pura), modo foto | T1 | | pendente |
| T3 | Ação de auditoria | — | P | pendente |
| T4 | Repositório da configuração | T1, T3 | | pendente |
| T5 | Leitor do momento (amostras + capacidade) | — | P | pendente |
| T6 | Use cases e rotas (settings, summary) | T2, T4, T5 | | pendente |
| T7 | Painel: contratos, regras, serviço, margem | — | P | pendente |
| T8 | Painel: página, navegação, aba Resumo | T6, T7 | | pendente |
| T9 | Painel: aba Preços | T8 | | pendente |
| T10 | Docs, versão e changelog da P1 | T9 | | pendente |
| R1 | Revisão da P1 e merge | T10 | | pendente |
| T11 | Tabelas de snapshot (migration + repositório) | R1 | | pendente |
| T12 | Leitor de plano da Render | R1 | P | pendente |
| T12b | Cotação PTAX do BCB | R1 | P | pendente |
| T13 | Job de snapshot horário | T11, T12, T12b | | pendente |
| T14 | Calculador por hora + leitor do mês | T11 | | pendente |
| T15 | Summary por mês e projeção; painel com mês e avisos | T13, T14 | | pendente |
| T16 | Docs, versão e changelog da P2 | T15 | | pendente |
| R2 | Revisão da P2 e merge | T16 | | pendente |
| T17 | Custo de IA por tenant | R2 | P | pendente |
| T18 | Fechamento mensal (migration + job) | R2 | | pendente |
| T19 | Rotas por cliente e histórico | T17, T18 | | pendente |
| T20 | Painel: abas Por cliente e Histórico, privacidade | T19 | | pendente |
| T21 | Docs, versão e changelog da P3 | T20 | | pendente |
| R3 | Revisão da P3 e merge | T21 | | pendente |
| T22 | R2 automático pela API da Cloudflare (P4) | R3 | | não detalhada |

## Execution Plan

```
P1  onda 1 (3 agentes): T1 ∥ T3 ∥ T7
    onda 2 (2 agentes): T2 ∥ T4 (banco) → T5 (banco, depois da T4)
    onda 3 (1 agente) : T6 → T8 → T9 → T10
    R1
P2  onda 1 (3 agentes): T11 (banco) ∥ T12 ∥ T12b
    onda 2 (1 agente) : T13 (banco) → T14 → T15 → T16
    R2
P3  onda 1 (2 agentes): T17 ∥ T18 (banco)
    onda 2 (1 agente) : T19 → T20 → T21
    R3
```

Pico de 3 agentes + 1 revisor.

## Task Breakdown

### P1 — mínima útil (sem tabela nova, sem chamada externa)

### T1: Domínio da configuração de custos [P]
**What**: `InfraCostSettings`, `parseInfraCostSettings` (COST-01: faixas, `key` única, limites de lista, campo desconhecido → erro com `field`), `DEFAULT_INFRA_COST_SETTINGS` (COST-02, valores da tabela do Problema, preço por GB `null`), `resolveInfraCostSettings(saved)` com origem `default`/`saved`. Contratos `IInfraCostSettingsRepository`.
**Where**: `api/src/modules/metrics/domain/services/infraCostSettings.ts` (+ `.test.ts`), `metrics/domain/contracts/IInfraCostSettingsRepository.ts`
**Depends on**: — · **Reuses**: `sessions/domain/services/workerScalingSettings.ts` (estilo) · **Requirement**: COST-01, COST-02
**Done when**: testes cobrem limites, `key` duplicada, `renderKey` inválida, `storageUsdPerGb` nulo aceito, default sem linha
**Tests**: unit · **Gate**: quick · **Commit**: `feat(metrics): domínio da configuração de custos da infraestrutura`

### T2: Calculador, modo foto
**What**: `resolveFxRate` puro com o ramo manual (`source: 'manual'`, `stale`, `null` → `fx_missing`; a T12b só acrescenta PTAX e `last_known`) e `calculateInfraCosts` com `basis: 'snapshot'`, devolvendo USD e BRL: custo por item (fixo, por instância, uso, armazenamento), total, fixo × variável, por sessão (conectadas e contratadas), por plano proporcional às conectadas, custo por tenant médio, marginal por sessão, avisos `price_to_confirm`; `null` em toda divisão por zero. Assinatura já aceita entradas por hora (vazias na P1) para a T14 só preencher.
**Where**: `metrics/domain/services/infraCostCalculator.ts`, `metrics/domain/services/fxRate.ts` (+ `.test.ts`)
**Depends on**: T1 · **Requirement**: COST-04, COST-05, COST-06a, COST-06b
**Done when**: testes com os valores reais (89 com 1 worker, 114 com 2), sem sessão, sem amostra, storage a confirmar, marginal = 25 ÷ (teto × ratio)
**Tests**: unit · **Gate**: quick · **Commit**: `feat(metrics): cálculo de custos e rateio por sessão e plano`

### T3: Ação de auditoria [P]
**What**: migration `add_audit_action_infra_costs` (`ALTER TYPE ... ADD VALUE 'INFRA_COST_SETTINGS_CHANGED'`), união em `IAuditLogRepository.ts`.
**Where**: `api/prisma/schema.prisma`, `api/prisma/migrations/<ts>_add_audit_action_infra_costs/`, `api/src/shared/audit/IAuditLogRepository.ts`
**Depends on**: — · **Requirement**: COST-03
**Done when**: typecheck verde; migration aplica no descartável (na T4)
**Tests**: none · **Gate**: full · **Commit**: `feat(prisma): ação de auditoria da configuração de custos`

### T4: Repositório da configuração
**What**: `PrismaInfraCostSettingsRepository` (`get`, `save(value, actorId, expectedUpdatedAt)` com conflito; linha inválida → default + `updatedAt` real).
**Where**: `metrics/infrastructure/repositories/` (+ `.int.test.ts`)
**Depends on**: T1, T3 · **Reuses**: `PrismaWorkerScalingSettingsRepository.ts` · **Requirement**: COST-01, COST-03
**Done when**: integração cobre criar, atualizar, conflito, linha inválida
**Tests**: integration-db · **Gate**: integration-db · **Commit**: `feat(metrics): repositório da configuração de custos`

### T5: Leitor do momento [P]
**What**: `IInfraCostLiveReader` + Prisma: última `sessions_connected` e `sessions_capacity` (janela 1 h), instâncias distintas do worker (`worker_service`) nos últimos 15 min, via `PrismaOpsMetricsSampleRepository`; capacidade por plano pela porta `IWorkerCapacityReader` injetada. `statement_timeout` 2 s.
**Where**: `metrics/domain/contracts/IInfraCostLiveReader.ts`, `metrics/infrastructure/repositories/PrismaInfraCostLiveReader.ts` (+ `.int.test.ts`)
**Depends on**: — · **Reuses**: `opsWorkerServiceId`, `opsResourceKind` · **Requirement**: COST-04, COST-05
**Done when**: integração com amostras sintéticas de 1 e 2 instâncias, sem amostra → `null`, instância antiga (> 15 min) fora
**Tests**: integration-db · **Gate**: integration-db (depois da T4) · **Commit**: `feat(metrics): leitura do momento para custos`

### T6: Use cases e rotas
**What**: `GetInfraCostSettingsUseCase`, `UpdateInfraCostSettingsUseCase` (auditoria antes/depois), `GetInfraCostSummaryUseCase` (lê `workerScalingSettingsProvider().current()` a cada chamada); rotas `GET`/`PUT /admin/costs/settings`, `GET /admin/costs/summary` (super admin, schema, presenter, handlers finos). Composição no container do `metrics`, registro em `routes.ts`.
**Where**: `metrics/application/use-cases/`, `metrics/presentation/routes/infraCosts.routes.ts` (+ schema, presenter, testes), `api/src/app/routes.ts`
**Depends on**: T2, T4, T5 · **Requirement**: COST-03, COST-04, COST-05, COST-06a
**Done when**: testes de rota: 401 sem super admin, 400 com `field`, 409, resposta sem preço de plano nem id da Render
**Tests**: unit + rota · **Gate**: full · **Commit**: `feat(metrics): rotas de custos da infraestrutura`

### T7: Painel: contratos, regras, serviço [P]
**What**: `types.ts`, `strings.ts`, `rules.ts` (`formatUsd`/`formatBrl` com o arredondamento de COST-06b, `planMargin` mensal e anual-equivalente com `PLAN_CATALOG`, `catalogSlugOf`, `diffSettings`, `validateSettingsDraft`), `adminCosts.service.ts`.
**Where**: `app/src/features/infraCosts/`, `app/src/services/adminCosts.service.ts` (+ testes)
**Depends on**: — · **Requirement**: COST-06, COST-06b, COST-16
**Done when**: testes de margem com câmbio, sem câmbio (`null`), plano sem catálogo; nenhum preço sai no corpo do serviço
**Tests**: unit · **Gate**: quick · **Commit**: `feat(app): regras e serviço dos custos da infraestrutura`

### T8: Painel: página, navegação, aba Resumo
**What**: `AdminCostsPage.tsx` com abas por sub-rota (lazy), rotas em `AppRoutes.tsx`, item `admin-costs` em `navigation/model.ts` (+ teste do modelo), `SummaryTab` + `useCostSummary` (cartões, por plano com margem, serviços, avisos, selo "estimado"/"a confirmar", USD e BRL lado a lado, faixa da cotação com data, origem e "Fonte: Banco Central do Brasil (PTAX)" quando `source` for `ptax`/`sgs`), link "Ver custos" no cartão da aba Capacidade, rota em `SUPPORT_CHAT_HIDDEN_PATHS` se houver ação fixa no canto.
**Where**: `app/src/pages/admin/AdminCostsPage.tsx`, `app/src/routes/AppRoutes.tsx`, `features/navigation/model.ts`, `features/infraCosts/components/SummaryTab.tsx`, `features/workersAdmin/components/CapacityTab.tsx`
**Depends on**: T6, T7 · **Requirement**: COST-07, COST-16
**Done when**: testes com `renderWithTheme` claro e escuro, estado "sem amostra", sem câmbio sem margem; build verde
**Tests**: unit · **Gate**: full + build · **Commit**: `feat(app): página de custos com resumo por serviço e plano`

### T9: Painel: aba Preços
**What**: `PricesTab` + `useCostSettings`: itens, preços por plano da Render, preços por modelo de IA, cotação (liga `fx.auto` a partir da P2; override manual com valor e data, botão "remover override"); rascunho `usePersistedState('costs.prices.draft', null, { scope: 'tab' })` (toda chamada do plano passa valor inicial; filtros: `usePersistedState('costs.filters', DEFAULT_COST_FILTERS, { scope: 'tab' })`), diálogo próprio com diff, erro por campo, 409 recarrega.
**Where**: `features/infraCosts/components/PricesTab.tsx`, `useCostSettings.ts` (+ testes)
**Depends on**: T8 · **Reuses**: `workersAdmin/components/SettingsTab.tsx` · **Requirement**: COST-08
**Done when**: testes de rascunho restaurado, diff, 409, campo inválido; build verde
**Tests**: unit · **Gate**: full + build · **Commit**: `feat(app): edição dos preços da infraestrutura`

### T10: Docs, versão e changelog da P1
**What**: `docs/custos-infraestrutura.md` (o que existe, conta, rateio, margem, o que não fazer), linha no `AGENTS.md` ("Marca e domínios"), linha em "Ferramentas operacionais" do roadmap, nota em `docs/planos.md` (margem lê o catálogo), versões e `CHANGELOG.md` dos dois apps.
**Depends on**: T9 · **Requirement**: COST-17
**Done when**: gate `full` + build; smoke P1 (spec, critério 1) no descartável
**Tests**: none · **Gate**: full · **Commit**: `docs(metrics): custos da infraestrutura (P1)`

### P2 — custo proporcional ao tempo

### T11: Tabelas de snapshot
**What**: migration `create_infra_cost_snapshots` (`infra_resource_hours`, `tenant_session_hours`, design §4); `IInfraCostSnapshotRepository` + Prisma: `upsert` por `(hour, resourceKey)`, incremento condicional por `lastHour`, limpeza > 400 dias em lotes de 5 mil com `statement_timeout` 2 s.
**Where**: `api/prisma/schema.prisma`, migration, `metrics/infrastructure/repositories/PrismaInfraCostSnapshotRepository.ts` (+ `.int.test.ts`)
**Depends on**: R1 · **Requirement**: COST-09, COST-10
**Done when**: integração: gravar a mesma hora duas vezes não dobra; dois processos na mesma hora somam uma vez; limpeza por lote
**Tests**: integration-db · **Gate**: integration-db · **Commit**: `feat(prisma): snapshots horários de recursos e sessão-hora`

### T12: Leitor de plano da Render [P]
**What**: `IInfraResourcePlanReader`, `RenderInfraResourcePlanReader` (tipo pelo prefixo, timeout 5 s, 429 com `Retry-After`, erro traduzido sem id), `NotConfiguredInfraResourcePlanReader`; parse de `INFRA_COST_RENDER_RESOURCES` (fallback `worker` = `WORKER_SCALER_SERVICE_ID`) em `shared/config`.
**Where**: `metrics/infrastructure/sources/` (+ testes), `api/src/shared/config/`
**Depends on**: R1 · **Reuses**: `RenderWorkerScaler.ts`, `RenderPlatformMetricsSource.ts` · **Requirement**: COST-09
**Done when**: testes com `fetchFn` falso: serviço, Postgres, Key Value, suspenso, 429, timeout, env inválida ignorada sem logar o id
**Tests**: unit · **Gate**: quick · **Commit**: `feat(metrics): leitura do plano e das instâncias na Render`

### T12b: Cotação PTAX do BCB [P]
**What**: `IFxRateSource` + `BcbPtaxFxRateSource` (Olinda `CotacaoDolarPeriodo`, janela 7 dias, `cotacaoVenda`) e `BcbSgsFxRateSource` (série 1, `ultimos/1`), URLs fixas, timeout 5 s, `fetchFn` injetável, valor finito 1–20; estende `resolveFxRate` (da T2) com override → gravada → `last_known` → `null`.
**Where**: `metrics/infrastructure/sources/BcbPtaxFxRateSource.ts`, `BcbSgsFxRateSource.ts`, `metrics/domain/services/fxRate.ts` (+ testes)
**Depends on**: R1 · **Requirement**: COST-06a
**Done when**: testes com resposta falsa (`value` com 1 linha, `value: []`, valor 0/NaN/25 recusado, erro, timeout, SGS como fallback); nenhuma chamada real
**Tests**: unit · **Gate**: quick · **Commit**: `feat(metrics): cotação PTAX do dólar para os custos`

### T13: Job de snapshot horário
**What**: `InfraCostSnapshotJob` (com `fx.auto`, passo da cotação 1×/dia após 16h30 UTC sob lease `infra-fx-rate`: PTAX → SGS → mantém a última e no máximo 1 nova tentativa 1 h depois, grava `infra_fx_rates`; lease `infra-cost-snapshot`, tick 5 min `unref`, grava só se a hora cheia ainda não tem linha, renova lease antes de gravar, sessão-hora e contratadas por tenant via `IInfraTenantUsageReader` novo (design §4), limpeza diária com lease de 24 h); `INFRA_COST_SNAPSHOT_ENABLED` (default `false`) em `env.ts`; registro em `WORKER_JOBS`; linha no §3.3.
**Where**: `metrics/infrastructure/jobs/InfraCostSnapshotJob.ts` (+ `.test.ts`, `.int.test.ts`), `metrics/infrastructure/repositories/PrismaInfraTenantUsageReader.ts`, `api/src/app/processJobs.ts`, `shared/config/env.ts`
**Depends on**: T11, T12 · **Reuses**: `OpsMetricsSamplerJob.ts` · **Requirement**: COST-09, COST-10
**Done when**: flag desligada não chama nada; Render fora → hora sem linha e `warn` único; troca de dono do lease não dobra
**Tests**: unit + integration-db · **Gate**: integration-db + full · **Commit**: `feat(metrics): job horário de snapshot de custos`

### T14: Calculador por hora + leitor do mês
**What**: `calculateInfraCosts` com `basis: 'hours'` (COST-11/12: hora × preço do plano lido, hora sem leitura = manual + `missing_hours`, `plan_without_price`, projeção, sessão-hora, contratadas, ociosidade); `PrismaInfraCostUsageReader` (horas por recurso, sessão-hora por plano no mês).
**Where**: `metrics/domain/services/infraCostCalculator.ts`, `metrics/infrastructure/repositories/PrismaInfraCostUsageReader.ts` (+ testes)
**Depends on**: T11 · **Requirement**: COST-11, COST-12
**Done when**: teste 1 → 2 instâncias no dia 15 de um mês de 30 dias = 25 + 12,50; fevereiro (672 h); plano sem preço → `null` + aviso
**Tests**: unit + integration-db · **Gate**: integration-db · **Commit**: `feat(metrics): custo proporcional ao tempo e rateio por sessão-hora`

### T15: Summary por mês e painel
**What**: `?month=YYYY-MM` (mês corrente por padrão; meses sem dado → `basis: 'snapshot'` só no corrente, senão vazio), projeção; painel com seletor de mês e divisor (sessão-hora × contratadas) persistidos, avisos com atalho para Preços.
**Where**: use case e rota da T6, `SummaryTab.tsx`, `useCostSummary.ts`
**Depends on**: T13, T14 · **Requirement**: COST-11, COST-12, COST-16
**Done when**: smoke P2 (spec, critério 2); testes do painel claro/escuro
**Tests**: unit · **Gate**: full + build · **Commit**: `feat(metrics): custos do mês com projeção`

### T16: Docs, versão e changelog da P2
**What**: `custos-infraestrutura.md`, `ops-metricas.md` (job, envs, "rota nunca chama a Render" segue valendo), `arquitetura-escala.md` §3.3 e §5.1 (envs `INFRA_COST_*`, só na Render), versões, changelogs.
**Depends on**: T15 · **Requirement**: COST-17 · **Gate**: full · **Commit**: `docs(metrics): custos proporcionais ao tempo (P2)`

### P3 — por cliente, IA e histórico

### T17: Custo de IA por tenant [P]
**What**: leitor de `ai_usage_logs` (`source = PLATFORM`, `success`, mês, `GROUP BY tenantId, kind, model`) e cálculo com `aiModelPrices` (`model_without_price`).
**Where**: `PrismaInfraCostUsageReader.ts`, `infraCostCalculator.ts` (+ testes)
**Depends on**: R2 · **Requirement**: COST-13
**Tests**: unit + integration-db · **Gate**: integration-db · **Commit**: `feat(metrics): custo de IA da plataforma por cliente`

### T18: Fechamento mensal
**What**: migration `create_infra_cost_months` (`infra_cost_months`, `infra_cost_month_tenants`); passo do job na 1ª hora do mês (idempotente, lease); mês fechado com preços e câmbio usados.
**Where**: migration, `PrismaInfraCostSnapshotRepository.ts`, `InfraCostSnapshotJob.ts` (+ testes)
**Depends on**: R2 · **Requirement**: COST-15
**Done when**: fechar duas vezes não duplica; editar preço depois não muda o mês fechado
**Tests**: integration-db · **Gate**: integration-db · **Commit**: `feat(metrics): fechamento mensal dos custos`

### T19: Rotas por cliente e histórico
**What**: `GET /admin/costs/tenants?month=&plan=&cursor=` (cursor opaco, página do servidor, ordem por custo) e `GET /admin/costs/history` (12 meses).
**Where**: `metrics/application/use-cases/`, `infraCosts.routes.ts` (+ testes)
**Depends on**: T17, T18 · **Requirement**: COST-14, COST-15
**Tests**: unit + rota · **Gate**: full · **Commit**: `feat(metrics): custos por cliente e histórico mensal`

### T20: Painel: Por cliente e Histórico
**What**: `TenantsTab` (nome com `Blurred`, flag nova `costs.tenantName` em `PRIVACY_SCREENS`, filtro de plano persistido) e `HistoryTab` (barras por plano em chunk lazy, tabela).
**Where**: `features/infraCosts/components/`, `features/privacy/privacyFlags.ts`, `AdminCostsPage.tsx`
**Depends on**: T19 · **Requirement**: COST-14, COST-15, COST-16
**Done when**: smoke P3 (spec, critério 3); testes claro/escuro; flag ligada borra o nome
**Tests**: unit · **Gate**: full + build · **Commit**: `feat(app): custos por cliente e histórico`

### T21: Docs, versão e changelog da P3
**What**: `docs/custos-infraestrutura.md` (por cliente, IA, fechamento, privacidade), `docs/ops-metricas.md` (passo de fechamento do job), `docs/planos.md` (margem por cliente), `docs/padrao-ui-painel.md` só se surgir padrão novo; versões e `CHANGELOG.md` dos dois apps.
**Where**: arquivos acima, `api/package.json`, `app/package.json`, changelogs
**Tests**: none · **Depends on**: T20 · **Requirement**: COST-17 · **Gate**: full · **Commit**: `docs(metrics): custos por cliente e histórico (P3)`

### T22: R2 automático (P4, não detalhada)
Ler GB armazenados e operações pela API de analytics da Cloudflare (token novo, só no `worker`), no mesmo job. Só se o
dono pedir e o custo do R2 deixar de ser irrelevante.
