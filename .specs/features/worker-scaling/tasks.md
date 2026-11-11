# Gestão de escala dos workers — Tasks

**Spec:** [`spec.md`](spec.md) · **Design:** [`design.md`](design.md) · **Status:** Draft, aguarda aprovação do dono

## Regras comuns

**Branch e merge** (regra atual do projeto, memória `branch-integracao-rebranding`):
- Tudo nasce de `feature/rebranding-app` (decisão do dono de 2026-10-26, que prevalece sobre o `AGENTS.md` §31.2). Branch da feature: `feature/worker-scaling`. Cada tarefa roda em worktree
  próprio com branch `ws/t<N>` saído do topo de `feature/worker-scaling`; aprovado no gate, entra por `cherry-pick`.
- Fim de cada fase (P1–P4): gate completo + revisão convergida → `git merge --no-ff feature/worker-scaling` **local** em
  `feature/rebranding-app`. **Sem push** sem o dono pedir (o push publica o CopySync na Render). Nunca push da branch de feature.
- `git add` só com caminhos explícitos. Ficam fora de qualquer commit os arquivos do dono na worktree principal:
  `.specs/features/plans-modal/`, `.specs/features/product-access/`, `.specs/features/saver/`,
  `docs/mensagens-interativas.md` (conferir a lista com `git status` no início de cada fase).
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
| T1 | Domínio da configuração | — | P | feito |
| T2 | Ações de auditoria | — | P | feito |
| T3 | Repositório da configuração | T1 | P | feito |
| T4 | Provider com refresh | T1 | P | feito |
| T5 | Gate lê limites por função | T4 | P | feito |
| T6 | Política e job de alerta parametrizados | T4 | P | feito |
| T7 | Composição e ciclo de vida | T3, T4, T5, T6 | | feito |
| T8 | Use cases de leitura e gravação | T2, T3, T4 | | feito |
| T9 | Rotas de configuração | T8 | | feito |
| T10 | Painel: contratos, regras, serviço | — | P | feito |
| T11 | Painel: aba Configuração | T9, T10 | | feito |
| T12 | Docs, versão e changelog da P1 | T7, T11 | | feito |
| R1 | Revisão da P1 e merge | T12 | | feito |
| T13 | Métricas de sessões no coletor | R1 | | feito |
| T14 | Contas de capacidade | R1 | P | feito |
| T15 | Leitor de capacidade por plano | T13 | | feito |
| T16 | Use case e rota de capacidade | T14, T15 | | feito |
| T17 | Alerta de ocupação sem adoção | T13 | | feito |
| T18 | Painel: aba Capacidade | T16 | | feito |
| T19 | Docs, versão e changelog da P2 | T17, T18 | | feito |
| R2 | Revisão da P2 e merge | T19 | | feito |
| T20 | Eventos de escala (tabela e repositório) | R2 | | feito |
| T21 | Porta do escalador e adaptador Render | R2 | P | feito |
| T22 | Use case de escala | T14, T20, T21 | | feito |
| T23 | Rotas de escala | T22 | | feito |
| T24 | Painel: aba Escala | T23 | | feito |
| T25 | Smoke de subida e redução num serviço de teste | T23 | | pendente (dono) |
| T26 | Docs, versão e changelog da P3 | T24 | | feito |
| R3 | Revisão da P3 e merge | T26 | | pendente |
| T27 | Job de subida automática | R3 | | pendente |
| T28 | Painel: modo automático e docs da P4 | T27 | | pendente |
| R4 | Revisão da P4 e merge | T28 | | pendente |
| T29 | Drenar worker (P5) | R4, D7 | | não detalhada |

## Execution Plan

```
P1  onda 1 (4 agentes): T1 ∥ T2 ∥ T4* ∥ T10        (*T4 começa quando T1 fecha tipo e contratos; T1 é curta)
    onda 2 (3 agentes): T3 (banco) ∥ T5 ∥ T6
    onda 3 (1 agente) : T7 → T8 → T9
    onda 4 (1 agente) : T11 → T12
    R1: revisão → correções → merge --no-ff local
P2  onda 1 (2 agentes): T13 (banco) ∥ T14
    onda 2 (1 agente) : T15 (banco) → T17      (T17 edita o mesmo `OpsMetricsSamplerJob.ts` da T13)
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
**What**: tipo `WorkerScalingSettings`, `parseWorkerScalingSettings` (faixas de WSCALE-01, rejeita campo desconhecido, erro com `field`), `resolveEffectiveSettings(saved, envDefaults)` devolvendo valor e origem por campo, `maxReplicas ≥ minReplicas`. Também os contratos `IWorkerScalingSettingsRepository` e `IWorkerScalingSettingsProvider` (só interface), para T3 e T4 rodarem em paralelo.
**Where**: `api/src/modules/sessions/domain/services/workerScalingSettings.ts` (+ `.test.ts`), `sessions/domain/contracts/IWorkerScalingSettingsRepository.ts`, `IWorkerScalingSettingsProvider.ts`
**Depends on**: — · **Requirement**: WSCALE-01, WSCALE-02
**Done when**: testes cobrem cada limite (mín, máx, fora), campo desconhecido, defaults sem linha salva, origem `default`/`saved` por campo
**Tests**: unit · **Gate**: quick · **Commit**: `feat(sessions): domínio da configuração de escala dos workers`

### T2: Ações de auditoria [P]
**What**: migration `add_audit_action_worker_scaling` com `WORKER_SCALING_SETTINGS_CHANGED` e `WORKER_SCALE_REQUESTED`; união em `IAuditLogRepository.ts`.
**Where**: `api/prisma/schema.prisma`, `api/prisma/migrations/<ts>_add_audit_action_worker_scaling/` (`<ts>` maior que a última migration do topo, hoje `20261111130000`; uma migration só, com dois `ALTER TYPE ... ADD VALUE` e nada mais, como `20261029040000_add_premium_slug_audit_actions`), `api/src/shared/audit/IAuditLogRepository.ts`
**Depends on**: — · **Requirement**: WSCALE-06, WSCALE-12
**Done when**: `pnpm typecheck` verde; migration aplica no descartável (conferido em T3)
**Tests**: none (enum) · **Gate**: full · **Commit**: `feat(prisma): ações de auditoria da escala dos workers`

### T3: Repositório da configuração
**What**: `PrismaWorkerScalingSettingsRepository`, implementação do contrato da T1 (`get` → `{ value, updatedAt, updatedById } | null`; `save(value, actorId, expectedUpdatedAt)` com conflito quando a linha mudou).
**Where**: `sessions/infrastructure/repositories/` (+ `.int.test.ts`)
**Depends on**: T1 · **Reuses**: `PrismaAiSettingsRepository.ts` (mesma tabela e injeção do `PrismaClient`; ele faz `upsert` cego, a checagem de `updatedAt` é código novo) · **Requirement**: WSCALE-01, WSCALE-06
**Done when**: integração cobre criar, atualizar, conflito por `expectedUpdatedAt` e JSON inválido no banco → `null` + log
**Tests**: integration-db · **Gate**: integration-db · **Commit**: `feat(sessions): repositório da configuração de escala`

### T4: Provider com refresh [P]
**What**: `RefreshingWorkerScalingSettingsProvider`, implementação do contrato da T1; recebe o `IWorkerScalingSettingsRepository` (contrato da T1, falso nos testes) e os `envDefaults`; nasce já com o valor da env, sem I/O no construtor (`current()` síncrono, `refresh()`, `start()` com timer de 30 s `unref`, `stop()`); falha mantém o último valor bom e loga `warn` uma vez por sequência de falhas.
**Where**: `sessions/infrastructure/lease/` (+ `.test.ts`)
**Depends on**: T1 · **Requirement**: WSCALE-03
**Done when**: testes com timer falso: valor inicial = env, troca após refresh, falha preserva o anterior, `stop` cancela o timer
**Tests**: unit · **Gate**: quick · **Commit**: `feat(sessions): provider da configuração de escala com refresh`

### T5: Gate lê limites por função [P]
**What**: `CapacityLimitedLeaseGate` recebe `() => SessionCapacityLimits`; toda checagem chama a função. Sem mudança de regra. Ajuste mínimo do chamador para o `tsc` e os testes do container seguirem verdes: `sessionLeaseContainer.ts:91` passa `() => capacity` (a troca pelo provider é da T7).
**Where**: `sessions/application/services/CapacityLimitedLeaseGate.ts` (+ `.test.ts`), `sessions/infrastructure/lease/sessionLeaseContainer.ts` (só a linha do construtor)
**Depends on**: T4 · **Requirement**: WSCALE-04, WSCALE-05
**Done when**: testes atuais verdes; novos: teto sobe entre dois `acquire` → libera; teto cai abaixo das ativas → nega novo, não solta existente
**Tests**: unit · **Gate**: full · **Commit**: `refactor(sessions): gate do lease lê o teto a cada uso`

### T6: Política e job de alerta parametrizados [P]
**What**: `capacityAlertReason` recebe `ratio` e `awaitingSeconds`; `WorkerCapacityAlertJob` e `WorkerHeartbeatJob` leem de uma função `() => WorkerScalingSettings` a cada tick (`maxSessions` do batimento = teto efetivo). Ajuste mínimo do chamador: `sessionAdoptionContainer.ts:70-78` passa função sobre os valores da env (a troca pelo provider é da T7).
**Where**: `sessions/domain/services/sessionAdoptionPolicy.ts`, `sessions/infrastructure/jobs/WorkerCapacityAlertJob.ts`, `WorkerHeartbeatJob.ts`, `sessions/infrastructure/lease/sessionAdoptionContainer.ts` (só a montagem dos dois jobs) (+ testes)
**Depends on**: T4 · **Requirement**: WSCALE-04, WSCALE-17
**Done when**: testes cobrem limiar alterado em runtime e batimento com teto novo
**Tests**: unit · **Gate**: full · **Commit**: `refactor(sessions): alerta e batimento usam a configuração de escala`

### T7: Composição e ciclo de vida
**What**: provider único (singleton) criado junto do `sessionLeaseContainer`, já com o valor da env (o container nasce em `composeForRole`, antes da conexão com o banco); `sessionLeaseContainer` e `sessionAdoptionContainer` o injetam; `AdoptNextSessionUseCase.hasCapacity` e a fila `session-open` do worker (`roleComposition.ts:98`, hoje `adoption.maxSessions` capturado no boot) leem `provider.current()` dentro da closure; `server.ts` faz `await provider.refresh()` + `provider.start()` **logo após** `connectDatabaseWithRetry()` (`:139`), antes do bootstrap das sessões e de `adoption.ticker.start()` (`:418`), e `stop()` no shutdown (no papel `worker` a fila `session-open` já consome dentro de `composeForRole`: até o primeiro refresh vale o teto da env, janela de boot degradado aceita); o log de boot (`:422`) mostra o teto do provider. Env continua como valor inicial.
**Where**: `sessions/infrastructure/lease/sessionLeaseContainer.ts`, `sessionAdoptionContainer.ts`, `sessions/application/use-cases/AdoptNextSessionUseCase.ts`, `api/src/app/server.ts`, `api/src/app/roleComposition.ts` (+ `roleComposition.test.ts`), `shared/config/workerAdoption.ts`
**Depends on**: T3, T4, T5, T6 · **Requirement**: WSCALE-02, WSCALE-04
**Done when**: nenhuma leitura de `.maxSessions`/`.maxPendingLogins` vinda de `workerAdoptionConfig()` nem de `env.WORKER_MAX_*` fora do cálculo de `envDefaults` (conferir com `grep -rnE "WORKER_MAX_|\.maxSessions\b|\.maxPendingLogins\b" api/src`, ocorrência por ocorrência; seguem permitidos `workerAdoptionConfig().enabled`/`.shard`, `limits().max*` dentro do gate, o campo `maxSessions` do batimento, comentários e testes); teste de `roleComposition` cobre `session-open` com teto alterado em runtime; com adoção desligada o gate continua sem teto (teste explícito: comportamento igual ao de hoje) e o provider ainda sobe para servir as rotas; boot com falha de leitura usa a env; testes dos containers e do use case verdes
**Tests**: unit · **Gate**: full · **Commit**: `feat(sessions): teto dos workers vem da configuração em banco`

### T8: Use cases de leitura e gravação
**What**: `GetWorkerScalingSettingsUseCase` (efetivo + origem + `updatedAt` + `enforced` = adoção ligada); `UpdateWorkerScalingSettingsUseCase` (valida, salva com `expectedUpdatedAt`, audita antes/depois, `provider.refresh()`).
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
**Where**: edição dos arquivos que já existem: `app/src/features/workersAdmin/{types,rules,strings}.ts`, `rules.test.ts`, `app/src/services/adminWorkers.service.ts`. T11, T18 e T24 tocam os mesmos arquivos, por isso são sequenciais
**Depends on**: — (contrato do `design.md` §3/§5) · **Requirement**: WSCALE-07
**Done when**: testes de `rules` cobrem cada faixa e o diff
**Tests**: unit · **Gate**: quick · **Commit**: `feat(app): contratos e regras da configuração de workers`

### T11: Painel — aba Configuração
**What**: aba `Configuração` em `/admin/workers/settings` (chunk `lazy`), `useWorkerSettings`, formulário com `TextField` numérico + ajuda em `Tooltip` nos campos simples, `RangeSlider` no par mínimo–máximo de réplicas (`docs/padrao-ui-painel.md:11`), seletor do modo, diálogo próprio da feature com o diff (`components/ConfirmDialog.tsx` só aceita `description: string`, sem conteúdo nem campo: usar `Dialog` do MUI no modelo de `AiProviderDialog.tsx`), confirmação reforçada (digitar o valor, botão desabilitado até conferir) sempre que o teto muda na P1 (ainda não existe `suggestedMaxSessions`; a T18 passa a dispensá-la quando o teto novo fica até o sugerido), faixa "sem efeito até ligar a adoção" quando `enforced: false`, `Snackbar`, aviso de teto abaixo da ocupação, rascunho em `usePersistedState('workers.settings.draft')` limpo ao salvar; rota em `AppRoutes`. Em `AdminWorkersPage.tsx:249-277` o seletor de aba é um ternário de duas abas com `Tabs` `fullWidth` e `maxWidth` 360: trocar por mapa caminho→aba e `variant="scrollable"` sem o `maxWidth` (base para as abas de T18 e T24).
**Where**: `app/src/features/workersAdmin/components/SettingsTab.tsx`, `SettingsConfirmDialog.tsx`, `useWorkerSettings.ts`, `pages/admin/AdminWorkersPage.tsx`, `routes/AppRoutes.tsx` (+ testes)
**Depends on**: T9, T10 · **Reuses**: `AdminPlanEntitlementsPage.tsx`, `AiProviderDialog.tsx` · **Requirement**: WSCALE-07
**Tools**: skills `ui-ux-pro-max` (layout) e `agent-browser` (conferência visual claro/escuro/sistema e largura de celular)
**Done when**: testes de componente: carrega, valida, confirma, salva, conflito 409, rascunho restaurado; conferência visual anexada
**Tests**: unit (Testing Library) · **Gate**: full + build · **Commit**: `feat(app): aba Configuração dos workers`

### T12: Docs, versão e changelog da P1
**What**: `docs/workers-escala.md` (o que é, campos, origem do valor, o que não fazer), linha no `AGENTS.md`, linha em "Ferramentas operacionais" do roadmap, `docs/arquitetura-escala.md` (as duas tabelas de envs, §3.2 e §5.1, e as menções em prosa ao teto por env: `WORKER_MAX_*` = valor inicial), próxima minor de `api` e `app` acima do topo na hora (topo em `d30c625`: api 0.81.0, app 0.100.0 → P1 = 0.82.0 e 0.101.0), `CHANGELOG.md` e `api/CHANGELOG.md`.
**Where**: arquivos citados · **Depends on**: T7, T11 · **Requirement**: WSCALE-19
**Tests**: none · **Gate**: full · **Commit**: `docs(workers): configuração de escala em banco (api X.Y.0, app X.Y.0)` com as versões reais

### R1: Revisão da P1 e merge
**What**: `/caveman-review` do diff da fase; correções em tarefas `T12a…`; gate `full` + `integration-db` + `build`; smoke P1 da spec num ambiente local com Postgres descartável; `merge --no-ff` local em `feature/rebranding-app`.
**Done when**: `review.md` com rodada convergida; merge feito; `git status` da worktree principal igual ao de antes (arquivos do dono intactos)

### T13: Métricas de sessões no coletor
**What**: `sessions_connected`, `sessions_pending_login`, `sessions_awaiting`, `sessions_capacity` em `OPS_METRIC`; `SessionsOccupancySource` com as contagens de `design.md` §4 (`sessions_awaiting` = 0 com a adoção desligada, igual à rota `GET /admin/workers`); plugar em `opsMetricsContainer`; atualizar o comentário de fontes em `schema.prisma:416` (sem migration) — a fonte `sessions` cai em `kind: 'other'` no `/series` e aparece no `/latest`.
**Where**: `metrics/domain/OpsMetric.ts` (`OpsMetricSource` + `OPS_METRIC`), `metrics/infrastructure/sources/SessionsOccupancySource.ts`, `metrics/infrastructure/jobs/OpsMetricsSamplerJob.ts` (opção nova no construtor `:40-53` e array `sources` `:176`), `opsMetricsContainer.ts` (+ `.int.test.ts`)
**Depends on**: R1 · **Requirement**: WSCALE-08
**Done when**: integração cobre lease vivo/vencido, status de login, aguardando sem dono, aguardando = 0 sem adoção, capacidade com e sem heartbeat
**Tests**: integration-db · **Gate**: integration-db · **Commit**: `feat(metrics): métricas de sessões no coletor`

### T14: Contas de capacidade [P]
**What**: `requiredReplicas`, `mbPerSession` (entrada já em MB: média de memória usada e média de `sessions_connected`; sem uma das duas → `null`), `suggestedMaxSessions` (0,7 × `memoryLimitMb` ÷ MB por sessão; sem limite → `null`), `canScaleDownTo`, `shouldScaleUp({ occupancySamples, awaitingOlderThanThreshold, settings, now })`; sem amostra → `null`. Funções puras: quem converte unidade e escolhe o recurso é a T16; quem conta as aguardando é a T27.
**Where**: `sessions/domain/services/capacityPlan.ts` (+ `.test.ts`)
**Depends on**: R1 · **Requirement**: WSCALE-09, WSCALE-12, WSCALE-15, WSCALE-16
**Tests**: unit · **Gate**: quick · **Commit**: `feat(sessions): contas de capacidade e regras de escala`

### T15: Leitor de capacidade por plano
**What**: `IWorkerCapacityReader`/`PrismaWorkerCapacityReader`: por `planSlug` de tenants `ACTIVE`, soma de `whatsapp_sessions`/`telegram_sessions`, tenants ilimitados, sessões criadas e conectadas; uma consulta, `SET LOCAL statement_timeout = '2s'`. `tenant_entitlements.value` é `Json?`: aceitar número e string numérica, como `PrismaEntitlementReader.ts:5-12`; `planSlug` é anulável (grupo "sem plano").
**Where**: `sessions/domain/contracts/`, `sessions/infrastructure/repositories/` (+ `.int.test.ts`)
**Depends on**: T13 (banco livre) · **Requirement**: WSCALE-09
**Done when**: integração cobre tenant suspenso fora, entitlement nulo = ilimitado, valor em string, `planSlug` nulo, plano sem tenant
**Tests**: integration-db · **Gate**: integration-db · **Commit**: `feat(sessions): leitor de capacidade por plano`

### T16: Use case e rota de capacidade
**What**: `GetWorkerCapacityUseCase` + `GET /admin/workers/capacity`. Memória para `mbPerSession`: amostras `memory` e `memory_pct` (fonte `render`) só de recursos `srv-`, convertidas para MB por `meta.unit`, somadas por `at` entre instâncias; `memoryLimitMb = memory ÷ (memory_pct ÷ 100)` da mesma série (o limite não é gravado). Mais de um `srv-` em `RENDER_RESOURCE_IDS` → `null` na P2 (a T23 passa a filtrar por `WORKER_SCALER_SERVICE_ID`).
**Where**: `sessions/application/use-cases/`, `presentation/routes/workerAdmin.routes.ts`, schema (+ testes)
**Depends on**: T14, T15 · **Requirement**: WSCALE-09
**Tests**: unit · **Gate**: full · **Commit**: `feat(sessions): rota de capacidade dos workers`

### T17: Alerta de ocupação sem adoção
**What**: `OpsAlertInput` (`opsAlertPolicy.ts:35-44`) ganha `sessionOccupancy: { connected, capacity, ratio }` calculado pelo coletor a partir das leituras `sessions_*` do tick; `OpsAlertReason` (`:18`) ganha `session_occupancy`; o alerta dispara quando `connected ÷ capacity > ratio`. O coletor levanta sempre que a adoção está desligada, em `all` ou `worker` (com adoção o `WorkerCapacityAlertJob` já cobre: não duplicar); `ratio` e a flag de adoção entram pela montagem do job.
**Where**: `metrics/domain/services/opsAlertPolicy.ts`, `OpsMetricsSamplerJob.ts`, `metrics/infrastructure/opsMetricsContainer.ts` (+ testes)
**Depends on**: T13 · **Requirement**: WSCALE-17
**Tests**: unit · **Gate**: quick · **Commit**: `feat(metrics): alerta de ocupação de sessões`

### T18: Painel — aba Capacidade
**What**: `/admin/workers/capacity`: cartões do cluster, tabela por plano, série sessões × capacidade de 7 dias vinda de `GET /admin/ops/metrics/series` (`sessions_connected` e `sessions_capacity`; a rota de capacidade não devolve série), em `TimeLineChart` com `range='7d'`, projeção por plano (`clientsThatFit`), estado "sem amostra". Sem formulário: nada a persistir além da aba (URL).
A `SettingsTab` passa a ler `suggestedMaxSessions` da rota de capacidade: confirmação reforçada só quando o teto passa do sugerido ou não há amostra (WSCALE-07).
**Where**: `app/src/features/workersAdmin/components/CapacityTab.tsx`, `useWorkerCapacity.ts`, `SettingsTab.tsx`, `useWorkerSettings.ts`, `rules.ts`, `strings.ts`, `types.ts`, serviço, página, rotas (+ testes)
**Depends on**: T16 · **Reuses**: `services/opsMetrics.service.ts`, `features/opsMetrics/components/TimeLineChart.tsx`, `features/opsMetrics/chartColors.ts`, `features/opsMetrics/rules.ts` · **Tools**: `ui-ux-pro-max`, `dataviz`, `agent-browser` · **Requirement**: WSCALE-10, WSCALE-07
**Tests**: unit (Testing Library) · **Gate**: full + build · **Commit**: `feat(app): aba Capacidade dos workers`

### T19: Docs, versão e changelog da P2
**What**: `docs/workers-escala.md`, `docs/ops-metricas.md` (métricas novas, fonte `sessions`), próxima minor de `api` e `app` acima do topo na hora e changelogs.
**Depends on**: T17, T18 · **Requirement**: WSCALE-19 · **Tests**: none · **Gate**: full · **Commit**: `docs(workers): capacidade e métricas de sessões`

### R2: Revisão da P2 e merge
Como R1, com o smoke P2 da spec.

### T20: Eventos de escala (tabela e repositório)
**What**: migration `create_worker_scale_events` (colunas em `design.md` §4; `actorUserId` é `text`, `User.id` é cuid); contrato `IWorkerScaleEventRepository` e repositório (gravar, atualizar resultado, último sucesso, listar por cursor opaco, limpeza de 180 dias em lotes de 5 mil com `statement_timeout` 2 s).
**Where**: `api/prisma/`, `sessions/domain/contracts/IWorkerScaleEventRepository.ts`, `sessions/infrastructure/repositories/PrismaWorkerScaleEventRepository.ts` (+ `.int.test.ts`)
**Depends on**: R2 · **Requirement**: WSCALE-13
**Tests**: integration-db · **Gate**: integration-db · **Commit**: `feat(sessions): eventos de escala dos workers`

### T21: Porta do escalador e adaptador Render [P]
**What**: `IWorkerScaler`; `RenderWorkerScaler` (`getState` = `numInstances`, instâncias reais, `hasDisk`, `autoscalingEnabled`; `scaleTo`); `NotConfiguredWorkerScaler` (estado `not_configured` com `missing`: nomes das envs ausentes, nunca valores); envs `WORKER_SCALER_ENABLED` (default `false`) e `WORKER_SCALER_SERVICE_ID`; tradução de erros; recusa com disco ou autoescala nativa ligada. As três envs (`RENDER_API_KEY`, `WORKER_SCALER_ENABLED`, `WORKER_SCALER_SERVICE_ID`) valem nos dois papéis: as rotas rodam no `http` e o job no `worker`.
**Where**: `sessions/domain/contracts/IWorkerScaler.ts`, `sessions/infrastructure/scaler/`, `shared/config/env.ts`, `shared/errors/internal/` (+ `.test.ts` com `fetchFn` falso)
**Depends on**: R2 · **Reuses**: `RenderPlatformMetricsSource.ts` · **Requirement**: WSCALE-11
**Done when**: testes cobrem 202, 401/403, 404, 429 com `Retry-After`, 5xx, timeout, disco, não configurado; nenhum teste toca a rede
**Tests**: unit · **Gate**: quick · **Commit**: `feat(sessions): escalador de workers com adaptador Render`

### T22: Use case de escala
**What**: `ScaleWorkersUseCase` com as regras de WSCALE-12, evento `requested` antes da chamada e `failed` no erro, auditoria `WORKER_SCALE_REQUESTED`, idempotência por `requestId`. Expõe `checkPreconditions()` (mesmas regras, sem gravar evento) para a T27.
**Where**: `sessions/application/use-cases/` (+ `.test.ts`)
**Depends on**: T14, T20, T21 · **Requirement**: WSCALE-12, WSCALE-13
**Tests**: unit · **Gate**: quick · **Commit**: `feat(sessions): escala dos workers por decisão do super admin`

### T23: Rotas de escala
**What**: `GET /admin/workers/scale` (estado + configuração + `cooldownUntil` + `missing` quando `not_configured`), `POST /admin/workers/scale`, `GET /admin/workers/scale/events`. `GetWorkerCapacityUseCase` passa a escolher o recurso de memória pelo `WORKER_SCALER_SERVICE_ID` quando definido (amostra grava `instance ?? resource`, `RenderPlatformMetricsSource.ts:73,83`: casar por prefixo do id do serviço; sem casamento → `null`; o formato real do id de instância é conferido no T25).
**Where**: `presentation/routes/workerAdmin.routes.ts`, schema, presenter, `application/use-cases/GetWorkerCapacityUseCase.ts` (+ teste com `inject`)
**Depends on**: T22 · **Requirement**: WSCALE-09, WSCALE-12, WSCALE-13
**Tests**: unit (inject) · **Gate**: full · **Commit**: `feat(sessions): rotas de escala dos workers`

### T24: Painel — aba Escala
**What**: `/admin/workers/scale`: estado, lista do que falta quando não configurado, subir/reduzir com diálogo próprio (motivo obrigatório; `ConfirmDialog` não tem campo), `CooldownBar` (`startAt = cooldownUntil − scaleCooldownSeconds`, `endAt = cooldownUntil`, `formatRemaining` em min/h; `serverNow` já é o relógio padrão), histórico paginado sem nome nem e-mail do ator (só `Manual`/`Automática`; quem pediu fica na auditoria). Rascunho (réplicas alvo + motivo) em `usePersistedState('workers.scale.draft')`, limpo ao confirmar ou cancelar.
**Where**: `app/src/features/workersAdmin/components/ScaleTab.tsx`, `ScaleConfirmDialog.tsx`, `useWorkerScale.ts`, `{types,rules,strings}.ts`, `services/adminWorkers.service.ts`, `pages/admin/AdminWorkersPage.tsx`, `routes/AppRoutes.tsx` (+ testes)
**Depends on**: T23 · **Tools**: `ui-ux-pro-max`, `agent-browser` · **Requirement**: WSCALE-14
**Tests**: unit (Testing Library) · **Gate**: full + build · **Commit**: `feat(app): aba Escala dos workers`

### T25: Smoke de subida e redução num serviço de teste (dono)
**What**: ambiente: API local com env sintético (nunca `api/.env`), Postgres descartável e `WORKER_ADOPTION_ENABLED=true` (sem adoção o `POST /scale` responde 409 `ADOPTION_DISABLED`); com um Private Service de teste na Render (sem disco) e `WORKER_SCALER_*` apontando para ele: subir 1→2, reduzir 2→1, conferir `SIGTERM` + prazo de encerramento na redução e ajustar `maxShutdownDelaySeconds`; anotar o formato do id de instância nas amostras (casamento por prefixo da T23). Formato `srv-<id>-<sufixo>` já confirmado em produção (2026-11-11, leitura de `ops_metrics_samples`). Resultado anotado em `docs/workers-escala.md`.
**Depends on**: T23 · **Requirement**: WSCALE-11, WSCALE-12 · **Tests**: smoke manual
**Bloqueia**: liberar a redução em produção (não bloqueia o merge da P3, que sai com o escalador desligado por env)

### T26: Docs, versão e changelog da P3
**Depends on**: T24 · **Requirement**: WSCALE-19 · **Commit**: `docs(workers): escala por decisão do super admin`
Inclui `docs/arquitetura-escala.md` §5.1 (itens novos do checklist, envs do escalador nos serviços `http` e `worker`) e §6; `docs/ops-metricas.md` ("O que não fazer", linha `RENDER_API_KEY` da tabela de envs e o parágrafo de custo com "Zero no `http`", `:109-115`) e a linha de métricas do `AGENTS.md`, registrando o recorte: só as rotas de escala chamam a Render, com cache de 30 s e timeout; as rotas de métricas continuam proibidas. Próxima minor de `api` e `app` acima do topo na hora.

### R3: Revisão da P3 e merge
Como R1, com atenção de segurança: chave e id de serviço fora de resposta, log, evento e auditoria.

### T27: Job de subida automática
**What**: `WorkerAutoscalerJob` (lease `worker-autoscaler`, tick 60 s, `unref`). Ocupação sustentada: amostras `sessions_*` do banco. Aguardando: `countAwaitingCapacity(awaitingAlertSeconds × 1000)` ao vivo (a amostra `sessions_awaiting` não tem idade). Decisão por `shouldScaleUp`; antes de agir chama `checkPreconditions()`; só então `ScaleWorkersUseCase` com `trigger=auto`. Todo `rejected` do mesmo motivo (`no_samples`, intervalo mínimo, `maxReplicas`, adoção desligada, escalador não configurado) grava no máximo um evento por hora, travado por lease `worker-autoscaler:<motivo>` (não por memória). Limpeza de 180 dias dos eventos no tick, travada por lease próprio `worker-autoscaler:cleanup` com `until = now + 24 h`, não solto (como `ops-alert:<reason>`, `OpsMetricsSamplerJob.ts:248-252`). Registro em `processJobs.ts` (`WORKER_JOBS`) e `server.ts`.
**Where**: `sessions/infrastructure/jobs/WorkerAutoscalerJob.ts`, `app/processJobs.ts`, `app/server.ts` (+ `.test.ts`; `.int.test.ts` para a leitura das amostras)
**Depends on**: R3 · **Requirement**: WSCALE-15, WSCALE-16
**Done when**: testes cobrem modo `off`/`manual` (não age), sustentado incompleto, gatilho por aguardando, intervalo mínimo e teto de réplicas sem evento repetido a cada tick, limpeza chamada, troca de dono do lease sem escalada dupla e reinício do processo no meio da janela (contagem preservada pelas amostras)
**Tests**: unit + integration-db · **Gate**: full + integration-db · **Commit**: `feat(sessions): subida automática de workers`

### T28: Painel — modo automático e docs da P4
**What**: indicador do modo e da última decisão automática (do histórico de eventos; sem campo novo na API) na aba Escala; textos de ajuda do modo automático; `docs/arquitetura-escala.md` §3.2 ("Autoescala (diferido)" vira a descrição do que existe) e §3.3 (linha do job); `docs/workers-escala.md`; próxima minor de `api` e `app` acima do topo na hora e changelogs.
**Where**: `app/src/features/workersAdmin/components/ScaleTab.tsx`, `useWorkerScale.ts`, `{strings,types}.ts` (+ teste), docs citados, `package.json` e changelogs
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
| D9 | Entregar P1 e P2 antes de ligar a escala em produção. No modo `all` atual a P2 mede e alerta; a P1 guarda o teto, que só passa a bloquear com a adoção ligada (D12 da spec) | Esperar o checklist §5.1 | Mede MB por sessão e deixa o teto pronto no painel já para a pré-venda |
| D10 | P3 e P4 saem com `WORKER_SCALER_ENABLED=false`; ligar é passo do dono depois do T25 | Ligar no deploy | Nenhuma chamada à Render sem teste real |
| D13 | Antes da P1, trazer o topo de `feature/rebranding-app` para `feature/worker-scaling` (`merge --no-ff` local; o plano saiu de `6e199e7`, a integração já está em `d30c625`, 29 commits à frente) | Executar na base antiga | Versões, migrations e linhas citadas são as do topo |
| D11 | Uma versão minor por fase, sempre a próxima acima do topo de `feature/rebranding-app` na hora do commit de docs da fase (outras frentes consomem versões em paralelo: 0.79 a 0.81 saíram enquanto este plano era revisado) | Uma só no fim | Regra do projeto: versão a cada entrega |

## Riscos

- **Teto errado digitado** (ex.: 400 em vez de 40) estoura a RAM: faixa validada, confirmação com diff e confirmação reforçada quando o valor passa do `suggestedMaxSessions` ou não há amostra.
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
