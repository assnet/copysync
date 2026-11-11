# Gestão de escala dos workers — Tasks

**Spec:** [`spec.md`](spec.md) · **Design:** [`design.md`](design.md) · **Status:** Draft, aguarda aprovação do dono

## Regras comuns

**Branch e merge** (regra atual do projeto, memória `branch-integracao-rebranding`):
- Tudo nasce de `feature/rebranding-app`. Branch da feature: `feature/worker-scaling`. Cada tarefa roda em worktree
  próprio com branch `ws/t<N>` saído do topo de `feature/worker-scaling`; aprovado no gate, entra por `cherry-pick`.
- Fim de cada fase (P1–P4): gate completo + revisão convergida → `git merge --no-ff feature/worker-scaling` **local** em
  `feature/rebranding-app`. **Sem push** sem o dono pedir (o push publica o CopySync na Render). Nunca push da branch de feature.
- `git add` só com caminhos explícitos. Ficam fora de qualquer commit os arquivos do dono na worktree principal:
  `.specs/features/plans-modal/`, `.specs/features/product-access/`, `.specs/features/saver/`, `docs/mensagens-interativas.md`.
  Conferir com `git show --stat HEAD` depois de cada commit.
- Um commit por tarefa, mensagem `tipo(escopo): descrição`, com `Co-Authored-By`. Migration nova nunca edita migration aplicada.

**Subagentes e RAM** (memória `ram-mac-subagentes`):
- No máximo **7** subagentes ao mesmo tempo; no máximo **1** com Postgres descartável (o script usa a porta 55432), então
  tarefas `integration-db` são sempre sequenciais.
- Monitor de `memory_pressure` armado durante toda onda (OK ≥ 25% livre; ATENÇÃO < 25% ou swap > 10 GB: não abrir nova
  frente; CRÍTICO < 12%: avisar o dono, não matar agente em andamento). Rearmar a cada expiração de 30 min.
- Vitest sempre com `--maxWorkers=2`; integração com `--maxWorkers=1 --no-file-parallelism`.
- Cada agente recebe só a definição da própria tarefa, `design.md`, `.specs/codebase/TESTING.md` e os arquivos citados em
  `Where`/`Reuses`. Remove worktree e para o banco ao terminar.

**Segurança:** nunca `api/.env` nem `api/.env.dev` (produção); nunca `prisma migrate deploy`/`start:migrate` fora do
descartável; nenhuma chamada real à API da Render em teste (só `fetchFn` falso); nenhuma escrita no banco de produção.

**Gates** (`.specs/codebase/TESTING.md`):
- `quick`: `pnpm test -- --maxWorkers=2` no pacote tocado.
- `full`: `pnpm typecheck && pnpm test -- --maxWorkers=2` em `api/` e `app/`.
- `integration-db`: `api/scripts/postgres-descartavel.sh start` → `INTEGRATION_DATABASE_URL=<url> pnpm exec vitest run --config vitest.int.config.mts --project db --maxWorkers=1 --no-file-parallelism` → `stop`.
- `build`: `pnpm build` no `app/` (abas novas em chunk `lazy`).

**Revisão** (`/caveman-review`, memória `revisao-sem-loop`): uma por fase, por subagente `cavecrew-reviewer` sobre
`git diff feature/rebranding-app...feature/worker-scaling`. Uma linha por achado (`arquivo:L<n>: 🔴|🟡|🔵|❓ problema. correção.`).
Só contradição com o código ou com a spec, com arquivo e linha; redesenho não entra. 🔴 corrige e revisa de novo só o
trecho; 🟡 corrige ou registra "aceito" com motivo; para quando sobrar só 🔵 ou texto. Registro em `review.md`
(`Rodada | Achados | Resultado`).

## Status

| ID | Título | Deps | [P] | Status |
| --- | --- | --- | --- | --- |
| T1 | Domínio da configuração | — | P | pendente |
| T2 | Ações de auditoria | — | P | pendente |
| T3 | Repositório da configuração | T1 | | pendente |
| T4 | Provider com refresh | T1 | P | pendente |
| T5 | Gate lê limites por função | T4 | P | pendente |
| T6 | Política e job de alerta parametrizados | T4 | P | pendente |
| T7 | Composição e ciclo de vida | T3, T4, T5, T6 | | pendente |
| T8 | Use cases de leitura e gravação | T2, T3, T4 | | pendente |
| T9 | Rotas de configuração | T8 | | pendente |
| T10 | Painel: contratos, regras, serviço | — | P | pendente |
| T11 | Painel: aba Configuração | T9, T10 | | pendente |
| T12 | Docs, versão e changelog da P1 | T7, T11 | | pendente |
| R1 | Revisão da P1 e merge | T12 | | pendente |
| T13 | Métricas de sessões no coletor | R1 | | pendente |
| T14 | Contas de capacidade | R1 | P | pendente |
| T15 | Leitor de capacidade por plano | T13 | | pendente |
| T16 | Use case e rota de capacidade | T14, T15 | | pendente |
| T17 | Alerta de ocupação sem adoção | T13 | P | pendente |
| T18 | Painel: aba Capacidade | T16 | | pendente |
| T19 | Docs, versão e changelog da P2 | T17, T18 | | pendente |
| R2 | Revisão da P2 e merge | T19 | | pendente |
| T20 | Eventos de escala (tabela e repositório) | R2 | | pendente |
| T21 | Porta do escalador e adaptador Render | R2 | P | pendente |
| T22 | Use case de escala | T14, T20, T21 | | pendente |
| T23 | Rotas de escala | T22 | | pendente |
| T24 | Painel: aba Escala | T23 | | pendente |
| T25 | Smoke de subida e redução num serviço de teste | T23 | | pendente (dono) |
| T26 | Docs, versão e changelog da P3 | T24 | | pendente |
| R3 | Revisão da P3 e merge | T26 | | pendente |
| T27 | Job de subida automática | R3 | | pendente |
| T28 | Painel: modo automático e docs da P4 | T27 | | pendente |
| R4 | Revisão da P4 e merge | T28 | | pendente |
| T29 | Drenar worker (P5) | R4, D7 | | não detalhada |

## Execution Plan

```
P1  onda 1 (4 agentes): T1 ∥ T2 ∥ T4* ∥ T10        (*T4 começa quando T1 fecha o tipo; T1 é curta)
    onda 2 (3 agentes): T3 (banco) ∥ T5 ∥ T6
    onda 3 (1 agente) : T7 → T8 → T9
    onda 4 (1 agente) : T11 → T12
    R1: revisão → correções → merge --no-ff local
P2  onda 1 (2 agentes): T13 (banco) ∥ T14
    onda 2 (2 agentes): T15 (banco) ∥ T17
    onda 3 (1 agente) : T16 → T18 → T19
    R2
P3  onda 1 (2 agentes): T20 (banco) ∥ T21
    onda 2 (1 agente) : T22 → T23 → T24 → T26        T25 em paralelo, com o dono
    R3
P4  T27 → T28 → R4
```

Pico de 4 agentes de implementação + 1 revisor; folga para o teto de 7.

## Task Breakdown

### T1: Domínio da configuração [P]
**What**: tipo `WorkerScalingSettings`, `parseWorkerScalingSettings` (faixas de WSCALE-01, rejeita campo desconhecido, erro com `field`), `resolveEffectiveSettings(saved, envDefaults)` devolvendo valor e origem por campo, `maxReplicas ≥ minReplicas`.
**Where**: `api/src/modules/sessions/domain/services/workerScalingSettings.ts` (+ `.test.ts`)
**Depends on**: — · **Requirement**: WSCALE-01, WSCALE-02
**Done when**: testes cobrem cada limite (mín, máx, fora), campo desconhecido, defaults sem linha salva, origem `default`/`saved` por campo
**Tests**: unit · **Gate**: quick · **Commit**: `feat(sessions): domínio da configuração de escala dos workers`

### T2: Ações de auditoria [P]
**What**: migration `add_audit_action_worker_scaling` com `WORKER_SCALING_SETTINGS_CHANGED` e `WORKER_SCALE_REQUESTED`; união em `IAuditLogRepository.ts`.
**Where**: `api/prisma/schema.prisma`, `api/prisma/migrations/<ts>_add_audit_action_worker_scaling/`, `api/src/shared/audit/IAuditLogRepository.ts`
**Depends on**: — · **Requirement**: WSCALE-06, WSCALE-12
**Done when**: `pnpm typecheck` verde; migration aplica no descartável (conferido em T3)
**Tests**: none (enum) · **Gate**: full · **Commit**: `feat(prisma): ações de auditoria da escala dos workers`

### T3: Repositório da configuração
**What**: `IWorkerScalingSettingsRepository` e `PrismaWorkerScalingSettingsRepository` (`get` → `{ value, updatedAt, updatedById } | null`; `save(value, actorId, expectedUpdatedAt)` com conflito quando a linha mudou).
**Where**: `sessions/domain/contracts/`, `sessions/infrastructure/repositories/` (+ `.int.test.ts`)
**Depends on**: T1 · **Reuses**: `PrismaAiSettingsRepository.ts` · **Requirement**: WSCALE-01, WSCALE-06
**Done when**: integração cobre criar, atualizar, conflito por `expectedUpdatedAt` e JSON inválido no banco → `null` + log
**Tests**: integration-db · **Gate**: integration-db · **Commit**: `feat(sessions): repositório da configuração de escala`

### T4: Provider com refresh [P]
**What**: `IWorkerScalingSettingsProvider` e `RefreshingWorkerScalingSettingsProvider` (`current()` síncrono, `refresh()`, `start()` com timer de 30 s `unref`, `stop()`); falha mantém o último valor bom e loga `warn` uma vez por sequência de falhas.
**Where**: `sessions/domain/contracts/`, `sessions/infrastructure/lease/` (+ `.test.ts`)
**Depends on**: T1 · **Requirement**: WSCALE-03
**Done when**: testes com timer falso: valor inicial = env, troca após refresh, falha preserva o anterior, `stop` cancela o timer
**Tests**: unit · **Gate**: quick · **Commit**: `feat(sessions): provider da configuração de escala com refresh`

### T5: Gate lê limites por função [P]
**What**: `CapacityLimitedLeaseGate` recebe `() => SessionCapacityLimits`; toda checagem chama a função. Sem mudança de regra.
**Where**: `sessions/application/services/CapacityLimitedLeaseGate.ts` (+ `.test.ts`)
**Depends on**: T4 · **Requirement**: WSCALE-04, WSCALE-05
**Done when**: testes atuais verdes; novos: teto sobe entre dois `acquire` → libera; teto cai abaixo das ativas → nega novo, não solta existente
**Tests**: unit · **Gate**: quick · **Commit**: `refactor(sessions): gate do lease lê o teto a cada uso`

### T6: Política e job de alerta parametrizados [P]
**What**: `capacityAlertReason` recebe `ratio` e `awaitingSeconds`; `WorkerCapacityAlertJob` e `WorkerHeartbeatJob` leem do provider a cada tick (`maxSessions` do batimento = teto efetivo).
**Where**: `sessions/domain/services/sessionAdoptionPolicy.ts`, `sessions/infrastructure/jobs/WorkerCapacityAlertJob.ts`, `WorkerHeartbeatJob.ts` (+ testes)
**Depends on**: T4 · **Requirement**: WSCALE-04, WSCALE-17
**Done when**: testes cobrem limiar alterado em runtime e batimento com teto novo
**Tests**: unit · **Gate**: quick · **Commit**: `refactor(sessions): alerta e batimento usam a configuração de escala`

### T7: Composição e ciclo de vida
**What**: `sessionLeaseContainer` e `sessionAdoptionContainer` criam um provider único e o injetam; `AdoptNextSessionUseCase.hasCapacity` passa a ler do provider; `server.ts` faz `provider.start()` antes do lease e `stop()` no shutdown. Env continua como valor inicial.
**Where**: `sessions/infrastructure/lease/sessionLeaseContainer.ts`, `sessionAdoptionContainer.ts`, `sessions/application/use-cases/AdoptNextSessionUseCase.ts`, `api/src/app/server.ts`, `shared/config/workerAdoption.ts`
**Depends on**: T3, T4, T5, T6 · **Requirement**: WSCALE-02, WSCALE-04
**Done when**: `grep` não acha leitura de `WORKER_MAX_SESSIONS`/`WORKER_MAX_PENDING_LOGINS` fora de `env.ts` e do cálculo de `envDefaults`; testes dos containers e do use case verdes
**Tests**: unit · **Gate**: full · **Commit**: `feat(sessions): teto dos workers vem da configuração em banco`

### T8: Use cases de leitura e gravação
**What**: `GetWorkerScalingSettingsUseCase` (efetivo + origem + `updatedAt`); `UpdateWorkerScalingSettingsUseCase` (valida, salva com `expectedUpdatedAt`, audita antes/depois, `provider.refresh()`).
**Where**: `sessions/application/use-cases/` (+ `.test.ts`)
**Depends on**: T2, T3, T4 · **Reuses**: `SetPlanEntitlementUseCase.ts:46` · **Requirement**: WSCALE-06
**Done when**: testes cobrem sucesso, validação, conflito, auditoria com diff e refresh chamado
**Tests**: unit · **Gate**: quick · **Commit**: `feat(sessions): leitura e gravação da configuração de escala`

### T9: Rotas de configuração
**What**: `GET`/`PUT /admin/workers/settings` com schema, presenter e erros `INVALID_WORKER_SCALING_SETTINGS` (400) e `WORKER_SCALING_SETTINGS_CONFLICT` (409). Handlers finos; `return reply…` em todo caminho.
**Where**: `sessions/presentation/routes/workerAdmin.routes.ts`, `schemas/workerAdmin.schema.ts`, `shared/errors/internal/`
**Depends on**: T8 · **Requirement**: WSCALE-06
**Done when**: `pnpm typecheck` verde; teste de rota com `app.inject` cobre 401 sem super admin, 200, 400 e 409
**Tests**: unit (inject) · **Gate**: full · **Commit**: `feat(sessions): rotas da configuração de escala`

### T10: Painel — contratos, regras, serviço [P]
**What**: tipos de configuração; `validateSettingsDraft`, `diffSettings`; métodos `getSettings`/`updateSettings` no serviço; textos (rótulo, ajuda e faixa por campo, erros).
**Where**: `app/src/features/workersAdmin/{types,rules,strings}.ts`, `app/src/services/adminWorkers.service.ts` (+ `rules.test.ts`)
**Depends on**: — (contrato do `design.md` §3/§5) · **Requirement**: WSCALE-07
**Done when**: testes de `rules` cobrem cada faixa e o diff
**Tests**: unit · **Gate**: quick · **Commit**: `feat(app): contratos e regras da configuração de workers`

### T11: Painel — aba Configuração
**What**: aba `Configuração` em `/admin/workers/settings` (chunk `lazy`), `useWorkerSettings`, formulário com `TextField` numérico + ajuda em `Tooltip`, `Switch`/seletor do modo, `ConfirmDialog` com o diff, `Snackbar`, aviso de teto abaixo da ocupação, rascunho em `usePersistedState('workers.settings.draft')` limpo ao salvar; rota em `AppRoutes`.
**Where**: `app/src/features/workersAdmin/components/SettingsTab.tsx`, `useWorkerSettings.ts`, `pages/admin/AdminWorkersPage.tsx`, `routes/AppRoutes.tsx` (+ testes)
**Depends on**: T9, T10 · **Reuses**: `AdminPlanEntitlementsPage.tsx`, `AiProviderDialog.tsx` · **Requirement**: WSCALE-07
**Tools**: skills `ui-ux-pro-max` (layout) e `agent-browser` (conferência visual claro/escuro/sistema e largura de celular)
**Done when**: testes de componente: carrega, valida, confirma, salva, conflito 409, rascunho restaurado; conferência visual anexada
**Tests**: unit (Testing Library) · **Gate**: full + build · **Commit**: `feat(app): aba Configuração dos workers`

### T12: Docs, versão e changelog da P1
**What**: `docs/workers-escala.md` (o que é, campos, origem do valor, o que não fazer), linha no `AGENTS.md`, linha em "Ferramentas operacionais" do roadmap, `docs/arquitetura-escala.md` (tabela de envs: `WORKER_MAX_*` = valor inicial), `api` 0.79.0, `app` 0.98.0, `CHANGELOG.md` e `api/CHANGELOG.md`.
**Where**: arquivos citados · **Depends on**: T7, T11 · **Requirement**: WSCALE-19
**Tests**: none · **Gate**: full · **Commit**: `docs(workers): configuração de escala em banco (api 0.79.0, app 0.98.0)`

### R1: Revisão da P1 e merge
**What**: `/caveman-review` do diff da fase; correções em tarefas `T12a…`; gate `full` + `integration-db` + `build`; smoke P1 da spec num ambiente local com Postgres descartável; `merge --no-ff` local em `feature/rebranding-app`.
**Done when**: `review.md` com rodada convergida; merge feito; `git status` da worktree principal igual ao de antes (arquivos do dono intactos)

### T13: Métricas de sessões no coletor
**What**: `sessions_connected`, `sessions_pending_login`, `sessions_awaiting`, `sessions_capacity` em `OPS_METRIC`; `SessionsOccupancySource` com as contagens de `design.md` §4; plugar em `opsMetricsContainer`.
**Where**: `metrics/domain/OpsMetric.ts`, `metrics/infrastructure/sources/SessionsOccupancySource.ts`, `opsMetricsContainer.ts` (+ `.int.test.ts`)
**Depends on**: R1 · **Requirement**: WSCALE-08
**Done when**: integração cobre lease vivo/vencido, status de login, aguardando sem dono, capacidade com e sem heartbeat
**Tests**: integration-db · **Gate**: integration-db · **Commit**: `feat(metrics): métricas de sessões no coletor`

### T14: Contas de capacidade [P]
**What**: `requiredReplicas`, `mbPerSession`, `suggestedMaxSessions` (0,7 × limite ÷ MB por sessão), `canScaleDownTo`, `shouldScaleUp(samples, settings, now)`; sem amostra → `null`.
**Where**: `sessions/domain/services/capacityPlan.ts` (+ `.test.ts`)
**Depends on**: R1 · **Requirement**: WSCALE-09, WSCALE-12, WSCALE-15, WSCALE-16
**Tests**: unit · **Gate**: quick · **Commit**: `feat(sessions): contas de capacidade e regras de escala`

### T15: Leitor de capacidade por plano
**What**: `IWorkerCapacityReader`/`PrismaWorkerCapacityReader`: por `planSlug` de tenants `ACTIVE`, soma de `whatsapp_sessions`/`telegram_sessions`, tenants ilimitados, sessões criadas e conectadas; uma consulta, `SET LOCAL statement_timeout = '2s'`.
**Where**: `sessions/domain/contracts/`, `sessions/infrastructure/repositories/` (+ `.int.test.ts`)
**Depends on**: T13 (banco livre) · **Requirement**: WSCALE-09
**Done when**: integração cobre tenant suspenso fora, entitlement nulo = ilimitado, plano sem tenant
**Tests**: integration-db · **Gate**: integration-db · **Commit**: `feat(sessions): leitor de capacidade por plano`

### T16: Use case e rota de capacidade
**What**: `GetWorkerCapacityUseCase` + `GET /admin/workers/capacity`.
**Where**: `sessions/application/use-cases/`, `presentation/routes/workerAdmin.routes.ts`, schema (+ testes)
**Depends on**: T14, T15 · **Requirement**: WSCALE-09
**Tests**: unit · **Gate**: full · **Commit**: `feat(sessions): rota de capacidade dos workers`

### T17: Alerta de ocupação sem adoção [P]
**What**: `opsAlertPolicy` ganha limiar de ocupação de sessões (configuração) aplicado às amostras `sessions_*`; o coletor levanta o alerta em `all` sem adoção.
**Where**: `metrics/domain/services/opsAlertPolicy.ts`, `OpsMetricsSamplerJob.ts` (+ testes)
**Depends on**: T13 · **Requirement**: WSCALE-17
**Tests**: unit · **Gate**: quick · **Commit**: `feat(metrics): alerta de ocupação de sessões`

### T18: Painel — aba Capacidade
**What**: `/admin/workers/capacity`: cartões do cluster, tabela por plano, série sessões × capacidade (`TimeLineChart`, `skipAnimation`), projeção por plano (`clientsThatFit`), estado "sem amostra".
**Where**: `app/src/features/workersAdmin/components/CapacityTab.tsx`, `useWorkerCapacity.ts`, `rules.ts`, `strings.ts`, `types.ts`, serviço, página, rotas (+ testes)
**Depends on**: T16 · **Tools**: `ui-ux-pro-max`, `dataviz`, `agent-browser` · **Requirement**: WSCALE-10
**Tests**: unit (Testing Library) · **Gate**: full + build · **Commit**: `feat(app): aba Capacidade dos workers`

### T19: Docs, versão e changelog da P2
**What**: `docs/workers-escala.md`, `docs/ops-metricas.md` (métricas novas), versões e changelogs.
**Depends on**: T17, T18 · **Requirement**: WSCALE-19 · **Tests**: none · **Gate**: full · **Commit**: `docs(workers): capacidade e métricas de sessões`

### R2: Revisão da P2 e merge
Como R1, com o smoke P2 da spec.

### T20: Eventos de escala (tabela e repositório)
**What**: migration `create_worker_scale_events`; repositório (gravar, atualizar resultado, último sucesso, listar por cursor opaco, limpeza de 180 dias em lotes de 5 mil com `statement_timeout` 2 s).
**Where**: `api/prisma/`, `sessions/infrastructure/repositories/PrismaWorkerScaleEventRepository.ts` (+ `.int.test.ts`)
**Depends on**: R2 · **Requirement**: WSCALE-13
**Tests**: integration-db · **Gate**: integration-db · **Commit**: `feat(sessions): eventos de escala dos workers`

### T21: Porta do escalador e adaptador Render [P]
**What**: `IWorkerScaler`; `RenderWorkerScaler` (`getState` = `numInstances`, instâncias reais, `hasDisk`, `autoscalingEnabled`; `scaleTo`); `NotConfiguredWorkerScaler`; envs `WORKER_SCALER_ENABLED` (default `false`) e `WORKER_SCALER_SERVICE_ID`; tradução de erros; recusa com disco ou autoescala nativa ligada.
**Where**: `sessions/domain/contracts/IWorkerScaler.ts`, `sessions/infrastructure/scaler/`, `shared/config/env.ts`, `shared/errors/internal/` (+ `.test.ts` com `fetchFn` falso)
**Depends on**: R2 · **Reuses**: `RenderPlatformMetricsSource.ts` · **Requirement**: WSCALE-11
**Done when**: testes cobrem 202, 401/403, 404, 429 com `Retry-After`, 5xx, timeout, disco, não configurado; nenhum teste toca a rede
**Tests**: unit · **Gate**: quick · **Commit**: `feat(sessions): escalador de workers com adaptador Render`

### T22: Use case de escala
**What**: `ScaleWorkersUseCase` com as regras de WSCALE-12, evento `requested` antes da chamada e `failed` no erro, auditoria `WORKER_SCALE_REQUESTED`, idempotência por `requestId`.
**Where**: `sessions/application/use-cases/` (+ `.test.ts`)
**Depends on**: T14, T20, T21 · **Requirement**: WSCALE-12, WSCALE-13
**Tests**: unit · **Gate**: quick · **Commit**: `feat(sessions): escala dos workers por decisão do super admin`

### T23: Rotas de escala
**What**: `GET /admin/workers/scale` (estado + configuração + `cooldownUntil`), `POST /admin/workers/scale`, `GET /admin/workers/scale/events`.
**Where**: `presentation/routes/workerAdmin.routes.ts`, schema, presenter (+ teste com `inject`)
**Depends on**: T22 · **Requirement**: WSCALE-12, WSCALE-13
**Tests**: unit (inject) · **Gate**: full · **Commit**: `feat(sessions): rotas de escala dos workers`

### T24: Painel — aba Escala
**What**: `/admin/workers/scale`: estado, lista do que falta quando não configurado, subir/reduzir com `ConfirmDialog` e motivo obrigatório, `CooldownBar` com `serverNow()`, histórico paginado.
**Where**: `app/src/features/workersAdmin/components/ScaleTab.tsx`, `useWorkerScale.ts`, demais arquivos da feature (+ testes)
**Depends on**: T23 · **Tools**: `ui-ux-pro-max`, `agent-browser` · **Requirement**: WSCALE-14
**Tests**: unit (Testing Library) · **Gate**: full + build · **Commit**: `feat(app): aba Escala dos workers`

### T25: Smoke de subida e redução num serviço de teste (dono)
**What**: com um Private Service de teste na Render (sem disco) e `WORKER_SCALER_*` apontando para ele: subir 1→2, reduzir 2→1, conferir `SIGTERM` + prazo de encerramento na redução e ajustar `maxShutdownDelaySeconds`. Resultado anotado em `docs/workers-escala.md`.
**Depends on**: T23 · **Requirement**: WSCALE-11, WSCALE-12 · **Tests**: smoke manual
**Bloqueia**: liberar a redução em produção (não bloqueia o merge da P3, que sai com o escalador desligado por env)

### T26: Docs, versão e changelog da P3
**Depends on**: T24 · **Requirement**: WSCALE-19 · **Commit**: `docs(workers): escala por decisão do super admin`
Inclui `docs/arquitetura-escala.md` §5.1 (itens novos do checklist) e §6.

### R3: Revisão da P3 e merge
Como R1, com atenção de segurança: chave e id de serviço fora de resposta, log, evento e auditoria.

### T27: Job de subida automática
**What**: `WorkerAutoscalerJob` (lease `worker-autoscaler`, tick 60 s, `unref`), decisão por `shouldScaleUp` sobre as amostras do banco, chama `ScaleWorkersUseCase` com `trigger=auto`; `rejected: no_samples` no máximo uma vez por hora; registro em `processJobs.ts` (`WORKER_JOBS`) e `server.ts`.
**Where**: `sessions/infrastructure/jobs/WorkerAutoscalerJob.ts`, `app/processJobs.ts`, `app/server.ts` (+ `.test.ts`; `.int.test.ts` para a leitura das amostras)
**Depends on**: R3 · **Requirement**: WSCALE-15, WSCALE-16
**Done when**: testes cobrem modo `off`/`manual` (não age), sustentado incompleto, intervalo mínimo, teto de réplicas, troca de dono do lease sem escalada dupla
**Tests**: unit + integration-db · **Gate**: full + integration-db · **Commit**: `feat(sessions): subida automática de workers`

### T28: Painel — modo automático e docs da P4
**What**: indicador do modo e da próxima avaliação na aba Escala; textos de ajuda do modo automático; `docs/arquitetura-escala.md` §3.2 ("Autoescala (diferido)" vira a descrição do que existe) e §3.3 (linha do job); versões e changelogs.
**Depends on**: T27 · **Requirement**: WSCALE-14, WSCALE-19 · **Tests**: unit · **Gate**: full + build
**Commit**: `feat(app): modo automático na escala dos workers`

### R4: Revisão da P4 e merge
Como R1, com o smoke P4 da spec.

### T29: Drenar worker (P5)
Só se o dono aprovar a D7. Detalhar em tarefas próprias antes de executar (WSCALE-18).

## Decisões para o dono

| # | Decisão (proposta) | Alternativa | Por quê |
| --- | --- | --- | --- |
| D1–D8 | Ver [`spec.md`](spec.md), seção Decisões | | |
| D9 | Entregar P1 e P2 antes de ligar a escala em produção (funcionam no modo `all` atual) | Esperar o checklist §5.1 | Mede MB por sessão e dá o teto no painel já para a pré-venda |
| D10 | P3 e P4 saem com `WORKER_SCALER_ENABLED=false`; ligar é passo do dono depois do T25 | Ligar no deploy | Nenhuma chamada à Render sem teste real |
| D11 | Uma versão minor por fase, a partir de api 0.79.0 e app 0.98.0 (ajustar ao que estiver no topo na hora) | Uma só no fim | Regra do projeto: versão a cada entrega |

## Riscos

- **Teto errado digitado** (ex.: 400 em vez de 40) estoura a RAM: faixa validada, confirmação com diff e aviso quando o valor passa do `suggestedMaxSessions`.
- **Refresh de 30 s** deixa réplicas com tetos diferentes por instantes: aceito; nenhuma sessão cai por isso.
- **Coletor desligado** (`OPS_METRICS_SAMPLER_ENABLED=false`): sem amostras não há série nem subida automática; a tela diz isso.
- **Chave da Render com escrita ampla**: só na env do serviço; rota nunca a devolve; recomendação de scoped key registrada.
- **Redução na Render sem garantia documentada de `SIGTERM`**: T25 antes de liberar em produção.
- **Outras sessões mexem em `server.ts`/`env.ts`**: conflitos de merge prováveis; resolver no cherry-pick de cada tarefa, nunca no fim.

## Diagram-Definition Cross-Check

Toda caixa do diagrama de `design.md` §1 tem tarefa: configuração (T1, T3, T8, T9), provider (T4, T7), consumidores (T5, T6, T7),
coletor e fonte (T13), capacidade (T14–T16), escalador (T21), use case e eventos (T20, T22, T23), job (T27), painel (T10, T11, T18, T24, T28).

## Test Co-location Validation

Use cases e domínio: unit na própria tarefa (T1, T4–T8, T14, T16, T17, T21, T22, T27). Repositórios com SQL novo:
integration-db na própria tarefa (T3, T13, T15, T20, T27). Componentes com lógica: Testing Library (T11, T18, T24, T28).
Sem teste só T2 (enum), T12/T19/T26 (docs) e T25 (smoke manual).
