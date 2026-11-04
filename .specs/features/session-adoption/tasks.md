# Adoção por capacidade (E4) — Tasks

**Spec**: `.specs/features/session-adoption/spec.md` (design inline lá)
**Status**: Draft (pré-requisitos: E2 F3 ✅ e E3 T21 ✅; T1–T13 podem começar antes da E3 acabar, ver Deps)

Regras comuns:

- Caminhos relativos a `api/src/` salvo indicação. Uma task = um subagente = um commit (`tipo(escopo): …` + `Co-Authored-By`).
- **Nunca** usar `api/.env`/`api/.env.dev` (produção) nem rodar `migrate`/`db push`/`start:migrate`; smoke com env sintético fora de `api/`.
- Gate `quick`: `cd api && pnpm vitest run <testes da task> && pnpm tsc --noEmit` (app: `cd app && pnpm vitest run <…> && pnpm tsc --noEmit`).
- Gate `int`: `api/scripts/postgres-descartavel.sh start` → `INTEGRATION_DATABASE_URL=<impresso> pnpm -C api test:int <arquivo>` → `stop`; mais o `quick`.
- **Invariante flag desligada**: com `WORKER_ADOPTION_ENABLED` ausente nada muda (nem escrita nova no banco). Dependência nova entra opcional; T14/T15 ligam.
- Horário só do banco (`now() AT TIME ZONE 'UTC'`), como `PrismaSessionLeaseRepository`.

## Status

| ID | Título | Deps | [P] | Status |
| --- | --- | --- | --- | --- |
| T1 | Envs `WORKER_ADOPTION_ENABLED`/`WORKER_MAX_SESSIONS`/`WORKER_SHARD` | — | P | ✅ 28f33f3 |
| T2 | Política pura da adoção | — | P | ✅ a3d791b |
| T3 | Migration `create-worker-heartbeats` | — | P | ✅ 9aaf3c9 |
| T4 | `JobLease` genérico em `shared/jobs` | — | P | ✅ 1906c67 |
| T5 | Repositório de adoção (SQL `SKIP LOCKED`, backoff, esgotadas) | T2 | P | ✅ 9351867 |
| T6 | Pedido novo zera backoff (`markConnectRequested`) | — | P | ✅ 179d0c4 |
| T7 | Gate do lease com teto (`CapacityLimitedLeaseGate`) | T2 | P | ✅ 12b7569 |
| T8 | Repositório de heartbeat | T3 | P | ✅ fa7207b |
| T9 | `AdoptNextSessionUseCase` + `SessionAdoptionTicker` | T5, E2 F3 | | ⏳ |
| T10 | `SESSION_CONNECTED` zera backoff | T5 | P | ⏳ |
| T11 | Jobs de heartbeat e alerta de capacidade | T2, T4, T5, T8 | | ⏳ |
| T12 | Sessão expõe `awaitingCapacity` | — | P | ✅ 177bf63 |
| T13 | `GET /admin/workers` | T5, T8 | P | ⏳ |
| T14 | Composição `sessionAdoptionContainer` | T1, T7, T9, T10, T11 | | ⏳ |
| T15 | `server.ts` + jobs por papel: ticker, bootstrap, shutdown | T14, E3 T19 | | ⏳ |
| T16 | `session-open` pausa com worker cheio | T14, E3 T18 | P | ⏳ |
| T17 | Painel: "Aguardando capacidade" | T12 | P | ✅ d616afb |
| T18 | Painel: página `/admin/workers` | T13 | P | ⏳ |
| T19 | Smoke | T15, T16, T17, T18 | | ⏳ |
| T20 | Docs, CHANGELOG e versão | T19 | | ⏳ |

## Notas de execução (passagem entre tarefas)

(vazio — cada task registra aqui o que a próxima precisa saber)

## Execution Plan

```
Fase 1 (paralelo):  T1  T2  T3  T4  T6  T12
Fase 2 (paralelo):  T2 → T5   T2 → T7   T3 → T8   T12 → T17
Fase 3 (paralelo):  T5,F3 → T9   T5 → T10   T2,T4,T5,T8 → T11   T5,T8 → T13 → T18
Fase 4:             T1,T7,T9,T10,T11 → T14
Fase 5 (após E3):   T14,E3-T19 → T15     T14,E3-T18 → T16
Fase 6:             T15,T16,T17,T18 → T19 → T20
```

Arquivos que forçam ordem: `env.ts` (só T1), `prisma/schema.prisma` (só T3), `server.ts` e `app/processJobs.ts` (só T15),
`sessionLeaseContainer.ts` (só T14), `PrismaSessionRepository.ts` (só T6), `routes.ts` (só T13), `api/package.json` (só T20).

---

## Task Breakdown

### T1: Envs da adoção [P]

**What**: `WORKER_ADOPTION_ENABLED` (preprocess bool como `SESSION_BOOTSTRAP_ON_STARTUP`, default `false`), `WORKER_MAX_SESSIONS`
(`int().positive()`, default 40), `WORKER_SHARD` (string, vazio → `undefined`). `workerAdoptionConfig()` devolve `{ enabled, maxSessions, shard: string|null }`.
**Where**: `shared/config/env.ts`, `shared/config/workerAdoption.ts` (+ `.test.ts`)
**Depends on**: —
**Requirement**: ADOPT-01
**Done when**: teste cobre defaults, `WORKER_SHARD=""` → `null`, teto inválido falha o parse
**Tests**: unit · **Gate**: quick
**Commit**: `feat(sessions): envs da adoção por capacidade`

### T2: Política pura da adoção [P]

**What**: constantes (`ADOPT_TICK_MS=5000`, `MAX_ADOPT_ATTEMPTS=5`, `ADOPT_BACKOFF_CAP_MIN=30`, `HEARTBEAT_MS=20000`,
`WORKER_ALIVE_MS=90000`, `CAPACITY_ALERT_RATIO=0.8`, `AWAITING_ALERT_MS=120000`, `ALERT_TICK_MS=60000`),
`adoptBackoffMinutes(n)` = `min(2^n, 30)`, `hasCapacity(active, max)`, `capacityAlertReason({sessions, maxSessions, awaitingOverMs})` → `'occupancy'|'awaiting'|null`.
**Where**: `modules/sessions/domain/services/sessionAdoptionPolicy.ts` (+ `.test.ts`)
**Depends on**: —
**Requirement**: ADOPT-02
**Done when**: testes de borda (80 % exato não alerta; soma de tetos 0 sem divisão por zero; backoff 1..6)
**Tests**: unit · **Gate**: quick
**Commit**: `feat(sessions): política da adoção por capacidade`

### T3: Migration `create-worker-heartbeats` [P]

**What**: model `WorkerHeartbeat` (`workerId String @id`, `role String`, `sessions Int`, `maxSessions Int`, `rssMb Int`, `seenAt DateTime`,
`@@index([seenAt])`, `@@map("worker_heartbeats")`) + migration nova escrita à mão (sem `migrate dev` contra produção; gerar no Postgres descartável).
Índice parcial de candidatas fica fora (D7).
**Where**: `api/prisma/schema.prisma`, `api/prisma/migrations/2026110xxxxxxx_create_worker_heartbeats/migration.sql`
**Depends on**: —
**Requirement**: ADOPT-10
**Done when**: migration aplica limpa no descartável sobre as anteriores; `prisma generate` + `tsc` ok
**Tests**: int (aplicar) · **Gate**: int
**Commit**: `feat(prisma): tabela worker_heartbeats`

### T4: `JobLease` genérico em `shared/jobs` [P]

**What**: mover contrato/implementação de `job_leases` para `IJobLease` + `PrismaJobLease` em `shared/jobs/`; `ILinkRotationJobLease` vira
`type` alias e `PrismaLinkRotationJobLease` reexporta (sem mudar chamadas do rodízio). Billing (`ReconcileSubscriptionsUseCase`, Prisma direto) fica como está.
**Where**: `shared/jobs/IJobLease.ts`, `shared/jobs/PrismaJobLease.ts`, `modules/link-rotation/infrastructure/repositories/PrismaLinkRotationJobLease.ts` (+ alias em `ILinkRotationJobLease.ts`)
**Depends on**: —
**Requirement**: ADOPT-11
**Done when**: testes do rodízio passam sem edição; `tsc` ok
**Tests**: unit (existentes) · **Gate**: quick + `pnpm vitest run src/modules/link-rotation`
**Commit**: `refactor(api): lease de job compartilhado`

### T5: Repositório de adoção [P]

**What**: `ISessionAdoptionRepository` + `PrismaSessionAdoptionRepository` (SQL cru):
- `adoptNext(workerId, shard, ttlMs): {id, tenantId} | null` — SQL de ADOPT-03; no mesmo `UPDATE`: `ownerWorkerId`, `leaseUntil`,
  `adoptFailures = adoptFailures+1`, `nextAdoptAt = now + LEAST(power(2, adoptFailures+1), 30) min`; sem tocar `updatedAt`.
- `failExhausted(): {id, tenantId}[]` — `adoptFailures >= 5`, lease nulo/vencido, pedido vivo → `FAILED`, `connectRequestedAt=null`, `updatedAt`.
- `resetFailures(id)` — só `WHERE adoptFailures > 0 OR nextAdoptAt IS NOT NULL` (sem escrita à toa).
- `countAwaitingCapacity(olderThanMs?)` — pedido vivo, status da lista, tenant `ACTIVE`, lease nulo/vencido.
**Where**: `modules/sessions/domain/contracts/ISessionAdoptionRepository.ts`, `modules/sessions/infrastructure/repositories/PrismaSessionAdoptionRepository.ts` (+ `.int.test.ts`)
**Depends on**: T2 (constantes)
**Requirement**: ADOPT-03, ADOPT-04, ADOPT-05
**Done when**: int: dois `adoptNext` concorrentes pegam linhas diferentes; tenant `SUSPENDED`, apagada, `AWAITING_QR`, lease vivo, `nextAdoptAt` futuro, shard diferente e `adoptFailures=5` ficam fora; `shard NULL` ↔ `$shard NULL`; backoff 2/4/8/16 min; `TimeZone ≠ UTC` no descartável
**Tests**: int · **Gate**: int
**Commit**: `feat(sessions): repositório de adoção por capacidade`

### T6: Pedido novo zera backoff [P]

**What**: `PrismaSessionRepository.markConnectRequested`: quando `connectRequestedAt` era `null`, gravar também `adoptFailures=0`, `nextAdoptAt=null`
(pedido que já existia não mexe). Sem isso sessão `FAILED` por esgotamento nunca mais é adotada depois de reconectar à mão.
**Where**: `modules/sessions/infrastructure/repositories/PrismaSessionRepository.ts` (+ `.int.test.ts`)
**Depends on**: —
**Requirement**: ADOPT-04
**Done when**: int: pedido nulo → contador zerado; pedido vivo → contador intacto
**Tests**: int · **Gate**: int
**Commit**: `fix(sessions): pedido de conexão novo zera o backoff de adoção`

### T7: Gate do lease com teto [P]

**What**: `CapacityLimitedLeaseGate implements ISessionLeaseGate` sobre o `AcquireSessionLeaseUseCase`: se a sessão já está em
`listLocalSessionIds()` → repassa; se `ativas >= max` → `false` (warn com `sessionId`, `active`, `max`); senão repassa.
Recebe `listLocal: () => string[]` e `max` (sem env). Rota cai no 503 existente (`SessionLeaseHeldError`), sem código novo (D3).
**Where**: `modules/sessions/application/services/CapacityLimitedLeaseGate.ts` (+ `.test.ts`)
**Depends on**: T2
**Requirement**: ADOPT-06
**Done when**: testes: cheio nega sessão nova e aceita a já local; abaixo do teto chama o acquire; erro do acquire = `false` como hoje
**Tests**: unit · **Gate**: quick
**Commit**: `feat(sessions): teto de sessões no gate do lease`

### T8: Repositório de heartbeat [P]

**What**: `IWorkerHeartbeatRepository` (`beat(row)` upsert com `seenAt = now UTC`, `listAlive(maxAgeMs)`, `remove(workerId)`) + Prisma.
Linhas mortas há > 1 dia apagadas no próprio `beat` (best-effort, 1 `DELETE` com limite) para a tabela não crescer.
**Where**: `modules/sessions/domain/contracts/IWorkerHeartbeatRepository.ts`, `modules/sessions/infrastructure/repositories/PrismaWorkerHeartbeatRepository.ts` (+ `.int.test.ts`)
**Depends on**: T3
**Requirement**: ADOPT-10, ADOPT-12
**Done when**: int: upsert idempotente; `listAlive(90 s)` exclui velho; `remove` só do id
**Tests**: int · **Gate**: int
**Commit**: `feat(sessions): repositório de heartbeat dos workers`

### T9: `AdoptNextSessionUseCase` + `SessionAdoptionTicker`

**What**: use case de um tick: `failExhausted()` (audita cada `FAILED` via `IAuditLogRepository`) → se `!hasCapacity(listLocal().length, max)` sai →
`adoptNext(workerId, shard, LEASE_TTL_MS)` → `null` sai → `engine.reconnectSession({sessionId, tenantId})` (origem auto, como bootstrap);
`SessionLeaseHeldError`/erro = log, sem gravar (backoff já gravado). Ticker: `setTimeout` encadeado `ADOPT_TICK_MS`, `unref`, `start/stop` (stop espera o tick),
tick sem erro não tratado. Uma adoção por tick (D2).
**Where**: `modules/sessions/application/use-cases/AdoptNextSessionUseCase.ts`, `modules/sessions/application/services/SessionAdoptionTicker.ts` (+ testes)
**Depends on**: T5; **E2 F3** (socket abrindo conta como local — sem isso o teto conta errado e o lease adotado não é renovado)
**Requirement**: ADOPT-05, ADOPT-07
**Done when**: testes com dublês: cheio não chama `adoptNext`; adotada chama reconnect; reconnect lança → nada gravado; `stop` durante tick espera
**Tests**: unit · **Gate**: quick
**Commit**: `feat(sessions): tick de adoção de sessões órfãs`

### T10: `SESSION_CONNECTED` zera backoff [P]

**What**: listener no barramento interno: `SESSION_CONNECTED` → `resetFailures(sessionId)` best-effort (erro só loga). Registrado só com a flag (T14).
**Where**: `modules/sessions/infrastructure/listeners/SessionAdoptionResetListener.ts` (+ `.test.ts`)
**Depends on**: T5 (contrato)
**Requirement**: ADOPT-04
**Done when**: teste: evento chama reset uma vez; erro não propaga
**Tests**: unit · **Gate**: quick
**Commit**: `feat(sessions): conexão bem-sucedida zera o backoff de adoção`

### T11: Jobs de heartbeat e alerta de capacidade

**What**: `WorkerHeartbeatJob` (20 s: `beat({workerId, role, sessions: listLocal().length, maxSessions, rssMb})`; `stop()` chama `remove`).
`WorkerCapacityAlertJob` (60 s): `tryAcquire('worker-capacity-alert', 60 s)` → `listAlive(90 s)` + `countAwaitingCapacity(2 min)` →
`capacityAlertReason` → log `warn` estruturado (`reason`, soma, tetos, aguardando); e-mail conforme D5 com cooldown por lease
`worker-capacity-alert-email` (30 min, não solto). Sem alerta = nada escrito além do lease.
**Where**: `modules/sessions/infrastructure/jobs/WorkerHeartbeatJob.ts`, `modules/sessions/infrastructure/jobs/WorkerCapacityAlertJob.ts` (+ testes)
**Depends on**: T2, T4, T5, T8
**Requirement**: ADOPT-10, ADOPT-11
**Done when**: testes com relógio falso: 81 % alerta, 80 % não; lease negado não consulta; 2 ticks no cooldown = 1 e-mail; `stop` remove heartbeat
**Tests**: unit · **Gate**: quick
**Commit**: `feat(sessions): heartbeat e alerta de capacidade dos workers`

### T12: Sessão expõe `awaitingCapacity` [P]

**What**: entidade `Session` ganha `connectRequestedAt` e `leaseUntil` (opcionais) + `isAwaitingCapacity(now)` = pedido vivo, lease nulo/vencido,
status `PENDING|DISCONNECTED|CONNECTING`; mapper preenche; `SessionPresenter.toSessionItem(..., { adoptionEnabled })` devolve `awaitingCapacity`
(sempre `false` com a flag desligada; campo aditivo). Não expor `ownerWorkerId`.
**Where**: `modules/sessions/domain/entities/Session.ts`, `modules/sessions/infrastructure/mappers/PrismaSessionMapper.ts`, `modules/sessions/presentation/presenters/SessionPresenter.ts` (+ testes)
**Depends on**: —
**Requirement**: ADOPT-13
**Done when**: testes da regra (bordas de status e lease) e do presenter com flag on/off; schema de resposta da rota aceita o campo
**Tests**: unit · **Gate**: quick
**Commit**: `feat(sessions): item de sessão indica aguardando capacidade`

### T13: `GET /admin/workers` [P]

**What**: `ListWorkersUseCase` (`listAlive(90 s)` + `countAwaitingCapacity()` → `{workers: [{workerId, role, sessions, maxSessions, rssMb, seenAt}], totals, awaiting}`)
e rota `authHook + superAdminHook` com schema de resposta, registrada em `routes.ts` sob `admin/workers`.
**Where**: `modules/sessions/application/use-cases/ListWorkersUseCase.ts`, `modules/sessions/presentation/routes/workerAdmin.routes.ts`, `app/routes.ts` (+ teste `inject`)
**Depends on**: T5, T8
**Requirement**: ADOPT-12
**Done when**: `inject`: 403 sem super-admin; 200 com totais; lista vazia ok
**Tests**: unit · **Gate**: quick
**Commit**: `feat(sessions): rota de ocupação dos workers para o super-admin`

### T14: Composição `sessionAdoptionContainer`

**What**: container lazy (1 por processo): config (T1), repos, `CapacityLimitedLeaseGate` envolvendo `lease.acquire` **só com a flag**
(sem flag, o gate passado à factory é o de hoje), ticker, jobs, listener de reset. `sessionLeaseContainer` expõe o gate efetivo para a factory.
**Where**: `modules/sessions/infrastructure/lease/sessionAdoptionContainer.ts`, `modules/sessions/infrastructure/lease/sessionLeaseContainer.ts` (+ teste)
**Depends on**: T1, T7, T9, T10, T11
**Requirement**: ADOPT-01, ADOPT-06
**Done when**: teste: flag off → gate é o mesmo objeto de antes e nenhum timer criado; flag on → gate com teto
**Tests**: unit · **Gate**: quick
**Commit**: `feat(sessions): composição da adoção por capacidade`

### T15: `server.ts` + jobs por papel: ticker, bootstrap, shutdown

**What**: `processJobs` ganha `sessionAdoption`, `workerHeartbeat`, `capacityAlert` em `worker`/`all` (só com flag). Boot: flag on +
`SESSION_BOOTSTRAP_ON_STARTUP=true` → não instancia `SessionBootstrapService` nem a 2ª passada F1; ticker readota (ADOPT-08). Reconciler igual.
Shutdown (D4): `keeper.stop` + `ticker.stop` + heartbeat/alerta → jobs → drain de mídia com teto `max(0, 27 s − decorrido − 10 s de reserva)`
→ `closeAllSockets` → flush → `releaseAllOwned` → `heartbeat.remove` → `app.close()`. Flag off: ordem e log iguais à E3.
**Where**: `app/server.ts`, `app/processJobs.ts` (+ `.test.ts`), `app/shutdownBudget.ts` (função pura do teto, + `.test.ts`)
**Depends on**: T14, E3 T19
**Requirement**: ADOPT-07, ADOPT-08, ADOPT-14
**Done when**: testes de `processJobs` e `shutdownBudget`; smoke T19 compara log de flag off com a E3
**Tests**: unit + smoke · **Gate**: quick
**Commit**: `feat(api): adoção, heartbeat e drain com teto no ciclo do processo`

### T16: `session-open` pausa com worker cheio [P]

**What**: consumidor da `session-open` (E3 T9) ganha `pause()/resume()` local (`Worker.pause(true)`); o ticker (ou um vigia de 5 s no
container) pausa quando `!hasCapacity` e retoma abaixo. Job aceito com vaga e negado no gate (corrida) volta 503 como hoje.
**Where**: `modules/messaging/infrastructure/remote/transport/BullEngineCommandQueues.ts` (E3), `app/roleComposition.ts` (E3) (+ `.int.test.ts`)
**Depends on**: T14, E3 T18
**Requirement**: ADOPT-09
**Done when**: int (Redis descartável): 2 consumidores, um cheio → todos os jobs vão ao outro; retoma ao liberar vaga
**Tests**: int · **Gate**: int
**Commit**: `feat(messaging): worker cheio não consome session-open`

### T17: Painel: "Aguardando capacidade" [P]

**What**: `awaitingCapacity?: boolean` em `SessionItem`; `SessionStatusChip` recebe o flag e mostra rótulo "Aguardando capacidade"
(cor `warning` outlined, Tooltip "Sem vaga nos servidores; conecta sozinha assim que houver") no lugar do status; textos em `strings.ts`. Sem dado sensível novo.
**Where**: `app/src/types/api.types.ts`, `app/src/features/sessions/components/SessionStatusChip.tsx`, `app/src/features/sessions/strings.ts` (+ teste)
**Depends on**: T12 (contrato)
**Requirement**: ADOPT-13
**Done when**: teste do chip com flag on/off; claro/escuro conferidos com agent-browser
**Tests**: unit · **Gate**: quick (app)
**Commit**: `feat(app): sessão aguardando capacidade no painel`

### T18: Painel: página `/admin/workers` [P]

**What**: serviço + hook (`adminWorkers.service.ts`, `useAdminWorkers`, atualização a cada 20 s) e página com `PageHeader`, tabela (worker, papel,
sessões/teto com barra, RAM, visto há) e cartão "aguardando capacidade"; item na seção Plataforma de `buildNavigation` + rota; textos em `strings.ts`.
`workerId` não é dado de cliente (sem flag de privacidade). Pode dividir em T18a (serviço/hook/tipos) e T18b (página/rota/menu) se passar de 3 arquivos de produção.
**Where**: `app/src/services/adminWorkers.service.ts`, `app/src/features/workersAdmin/` (hook, `strings.ts`), `app/src/pages/admin/AdminWorkersPage.tsx`, `app/src/routes/AppRoutes.tsx`, `app/src/features/navigation/model.ts`
**Depends on**: T13 (contrato)
**Requirement**: ADOPT-12
**Done when**: teste do modelo de navegação (super-admin vê `/admin/workers`); página vazia e cheia conferidas com agent-browser
**Tests**: unit · **Gate**: quick (app)
**Commit**: `feat(app): ocupação dos workers para o super-admin`

### T19: Smoke

**What**: critérios 1–5 da spec com Postgres e Redis descartáveis, env sintético fora de `api/`, teto 1. Sessão real só com autorização do dono;
senão registrar como pendência.
**Where**: notas de execução deste arquivo
**Depends on**: T15, T16, T17, T18
**Done when**: 5 critérios registrados; log de flag off idêntico à E3
**Tests**: smoke · **Gate**: `pnpm vitest run` + `pnpm tsc --noEmit` completos (api e app)
**Commit**: `docs(sessions): smoke da adoção por capacidade`

### T20: Docs, CHANGELOG e versão

**What**: `docs/arquitetura-escala.md` (§3.1 "readoção feita", §3.2 feito + backoff contado na adoção + teto no gate + shutdown com teto de mídia,
§4 fase 4 ✅, §5.1 envs por serviço), `docs/sessoes-conexao.md` (aguardando capacidade, 503 com worker cheio), `docs/plano-lancamento-hub-copysync.md` (E4 ✅),
`CHANGELOG.md`, `api/package.json` minor sobre a E3 (0.61.0 se a E3 sair 0.60.0), `app/package.json` minor; AGENTS.md: uma linha
"adoção só com `WORKER_ADOPTION_ENABLED` na Render; teto no gate do lease".
**Where**: arquivos acima
**Depends on**: T19
**Done when**: doc diz o que não fazer: ligar a flag local, subir teto sem medir RAM (Fase 0), gravar `Session.shard` sem tenant dedicado
**Tests**: none · **Gate**: `pnpm tsc --noEmit`
**Commit**: `docs(sessions): adoção por capacidade (E4) e versão`

---

## Decisões para o dono

| # | Decisão (proposta) | Alternativa | Por quê |
| --- | --- | --- | --- |
| D1 | Tentativa conta **na adoção** (`adoptFailures+1` no mesmo `UPDATE`) e zera no `SESSION_CONNECTED` | contar só falha detectada (doc §3.2) | Baileys falha por evento assíncrono (close), sem retorno confiável; contar na adoção é atômico e cobre worker que morre no meio |
| D2 | Uma adoção por tick de 5 s | lote | doc §3.2; evita rajada de 440/ban ao subir worker; 40 sessões readotadas em ~3,5 min |
| D3 | Worker cheio → 503 `ENGINE_TEMPORARILY_UNAVAILABLE` (subclasse de `SessionLeaseHeldError`) + `awaitingCapacity` no item | código novo `WORKER_AT_CAPACITY` | sem contrato novo nem i18n de erro; o painel explica pelo chip após o refresh |
| D4 | Shutdown: drain de mídia **antes** dos sockets com teto que reserva 10 s para close+flush+release | inverter literal (doc §3.2: mídia depois do flush) | envio de mídia precisa de socket aberto: depois do `closeAllSockets` o drain só falha os envios; o teto dá a prioridade ao flush sem matar o envio em voo. Compatível com E3 D8 |
| D5 | Alerta = log `warn` sempre; e-mail ao super-admin só se `IEmailSender` tiver template `WORKER_CAPACITY_ALERT` (hoje só `SET_PASSWORD`) — senão adiar | e-mail já | e-mail de produto passa pela central (`arquitetura-central-billing.md`); template novo depende dela. Se adiar, T11 só loga e não precisa de lista de super-admins |
| D6 | Extrair `JobLease` para `shared/jobs` (T4) | sessões importarem o do rodízio | evita acoplar `sessions` a `link-rotation`; billing segue com Prisma direto (fora do escopo) |
| D7 | Sem índice parcial de candidatas agora | índice em `(shard, connectRequestedAt) WHERE connectRequestedAt IS NOT NULL` | < 1.000 sessões e índice em `connectRequestedAt` já existe; medir no smoke |
| D8 | Bootstrap com flag on = ticker (sem teto paralelo) | manter `SessionBootstrapService` limitado ao teto | dois caminhos de reconexão no boot disputariam vagas; o ticker já cobre D2 da E2 |
| D9 | Sessão `AWAITING_*` no shutdown vira `DISCONNECTED` (E2) e é readotada; sem credenciais vai a QR e prende vaga | marcar `FAILED` ao cair em QR por adoção | mesmo comportamento do bootstrap de hoje; tratar depois se aparecer (Risco) |

## Riscos

| Risco | Mitigação |
| --- | --- |
| Flag ligada em `pnpm dev` local (`api/.env` = produção) rouba lease e reconecta sessões reais | default `false`; doc e AGENTS.md; T1 sem leitura implícita de `.env.dev` |
| Teto errado (sem Fase 0) estoura RAM/heap | default 40; `NODE_OPTIONS=--max-old-space-size` por serviço (§5.1); heartbeat mostra `rssMb` |
| F3 da E2 pendente: socket abrindo não conta → teto furado e lease adotado sem renovação | T9 depende de F3 |
| Readoção em massa após deploy (todas as sessões órfãs ao mesmo tempo) | 1 por tick por worker; lease de 60 s do processo antigo ainda segura o socket até o fim |
| Sessão adotada cai em QR (credenciais perdidas) e ocupa vaga indefinidamente | D9; alerta de ocupação mostra; revisar após o smoke |
| `failExhausted` marca `FAILED` sessão de tenant que só estava instável | 5 tentativas espaçadas (2+4+8+16 min ≈ 30 min); reconectar à mão zera (T6) |
| T15 mexe no `server.ts` e muda o shutdown de produção (`all`) | só com a flag; flag off = ordem da E3 comparada no smoke |
| Heartbeat a cada 20 s no Postgres compartilhado | 1 upsert por worker; tabela pequena; limpeza no `beat` |

---

## Diagram-Definition Cross-Check

| Task | Depends on (corpo) | Diagrama | Status |
| --- | --- | --- | --- |
| T1, T2, T3, T4, T6, T12 | — | Fase 1 | ✅ |
| T5, T7 | T2 | T2 → T5/T7 | ✅ |
| T8 | T3 | T3 → T8 | ✅ |
| T17 | T12 | T12 → T17 | ✅ |
| T9 | T5, F3 | T5,F3 → T9 | ✅ |
| T10 | T5 | T5 → T10 | ✅ |
| T11 | T2, T4, T5, T8 | Fase 3 | ✅ |
| T13 | T5, T8 | T5,T8 → T13 | ✅ |
| T18 | T13 | T13 → T18 | ✅ |
| T14 | T1, T7, T9, T10, T11 | Fase 4 | ✅ |
| T15 | T14, E3 T19 | Fase 5 | ✅ |
| T16 | T14, E3 T18 | Fase 5 | ✅ |
| T19, T20 | T15–T18, T19 | Fase 6 | ✅ |

[P] sem arquivo em comum na mesma fase: Fase 1 (T6 só `PrismaSessionRepository`; T12 só entidade/mapper/presenter), Fase 2 e 3 em arquivos novos distintos;
T13 é a única que toca `routes.ts`; T17/T18 no app sem arquivo comum.

## Test Co-location Validation

| Task | Camada | Matriz | Task | Status |
| --- | --- | --- | --- | --- |
| T1, T2, T7, T9, T10, T11, T12 | config / domínio / application | unit | unit | ✅ |
| T3 | migration | — | int (aplicar) | ✅ |
| T5, T6, T8 | repositório Prisma (SQL cru) | nenhum | int | ✅ acima do mínimo |
| T4, T13, T14 | infra / rota / composição | nenhum | unit | ✅ |
| T15 | `server.ts` | nenhum | unit (partes puras) + smoke | ✅ |
| T16 | transporte Redis | nenhum | int | ✅ |
| T17, T18 | app | unit | unit + agent-browser | ✅ |
| T19, T20 | smoke / docs | nenhum | smoke / none | ✅ |

## Notas de execução

- T1: `workerAdoptionConfig()` em `shared/config/workerAdoption.ts`; só `'true'` liga.
- T2: `sessionAdoptionPolicy.ts`; `awaitingOverMs: number | null` (T11/T13 fornecem); ocupação vence espera quando ambos.
- T3: migration `20261104160000_create_worker_heartbeats` (sem tenantId: dado de plataforma).
- T4: `shared/jobs/IJobLease` + `PrismaJobLease`; rodízio reexporta.
- T6: `markConnectRequested` zera `adoptFailures`/`nextAdoptAt` só quando não havia pedido.
- T12: `awaitingCapacity` no item de sessão (false com flag desligada); schemas `SessionStatus`/`SessionItem` movidos para `sessions/presentation/schemas/sessionItem.schema.ts`.
- T5: `ISessionAdoptionRepository` (`adoptNext` com `FOR UPDATE OF s2 SKIP LOCKED`, `failExhausted`, `resetFailures`, `countAwaitingCapacity(olderThanMs)`), relógio UTC.
- T7: `CapacityLimitedLeaseGate(inner, listLocal, max, log?)` não ligado ainda (T14).
- T8: `IWorkerHeartbeatRepository` (`beat`, `listAlive`, `remove`), limpeza best-effort > 1 dia.
- T17: chip "Aguardando capacidade" (`SessionStatusChip`, `strings.ts`), também em `SessionCard`/`DashboardPage`; dialogs de conexão/rodízio ainda sem o flag.
