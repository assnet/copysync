# Adoção por capacidade (escala E4) — Spec

**Fonte:** [`docs/arquitetura-escala.md`](../../../docs/arquitetura-escala.md) §3.1 (lease feito), §3.2 (adoção, teto,
heartbeat, alerta, drain), §3.3 (papéis), §4 fase 4, §5.1 (réplicas `worker`); E2 em [`../session-lease/`](../session-lease/spec.md)
(D2: bootstrap não readota; D3: backfill de `connectRequestedAt`; F3 pendente); E3 em [`../worker-role/`](../worker-role/spec.md)
(D3: `session-open` compartilhada; D8: worker drena mídia antes dos sockets).
**Tamanho:** Large. Design inline; tarefas em `tasks.md`. **Autoescala: diferida, fora deste plano.**

## Problema

Com E2+E3 só o lease decide quem abre o socket: não há teto por processo, sessão órfã (worker morto, deploy, lease
pulado no boot, D2 da E2) só volta se o usuário clicar em conectar, e ninguém sabe quantos workers vivem nem quando
falta capacidade. `SessionBootstrapService` conecta todas as ativas sem limite.

## Objetivo

Cada processo que roda sessões (`worker` ou `all`) adota sessões órfãs até `WORKER_MAX_SESSIONS`, com backoff para a
quebrada, publica heartbeat e um único processo alerta quando a ocupação passa de 80 %. Com
`WORKER_ADOPTION_ENABLED=false` (default) **nada muda** em relação à E3.

## Requisitos

| ID | Requisito |
| --- | --- |
| ADOPT-01 | Envs em `env.ts`: `WORKER_ADOPTION_ENABLED` (bool, default `false`), `WORKER_MAX_SESSIONS` (int > 0, default `40`), `WORKER_SHARD` (string; vazio = `null`). Só na Render: `api/.env` local aponta para produção |
| ADOPT-02 | Política pura: tick 5 s; backoff `nextAdoptAt = now + min(2^n, 30) min` (n = `adoptFailures` após a tentativa); 5 tentativas sem `CONNECTED` → `FAILED`; heartbeat 20 s; worker vivo = `seenAt` < 90 s; alerta em > 80 % da soma dos tetos ou pedido sem dono há > 2 min |
| ADOPT-03 | SQL de adoção (uma linha por tick) como §3.2, com relógio `now() AT TIME ZONE 'UTC'`: tenant `ACTIVE`, `deletedAt IS NULL`, `connectRequestedAt IS NOT NULL`, status `CONNECTED/CONNECTING/DISCONNECTED/AWAITING_* (T19b)`, lease nulo ou vencido, `nextAdoptAt` nulo ou passado, `adoptFailures < 5`, `shard IS NOT DISTINCT FROM $shard`, `ORDER BY connectRequestedAt LIMIT 1 FOR UPDATE SKIP LOCKED`. Na mesma escrita: `adoptFailures+1` e `nextAdoptAt` do backoff (D1) |
| ADOPT-04 | `adoptFailures` volta a 0 e `nextAdoptAt` a `null` no `SESSION_CONNECTED` e quando `markConnectRequested` grava um pedido novo (pedido nulo → não nulo) |
| ADOPT-05 | Esgotadas (`adoptFailures >= 5`, lease vencido, pedido vivo) viram `FAILED` + `connectRequestedAt = null`, com auditoria |
| ADOPT-06 | Teto único no gate do lease: com a flag ligada, `acquire` de sessão que não é deste processo é negado quando `ativas >= WORKER_MAX_SESSIONS` (`ativas` = `listLocalSessionIds()`, inclui sockets abrindo, F3 da E2). Vale para rota, `session-open`, bootstrap e adoção. Rota recebe 503 `ENGINE_TEMPORARILY_UNAVAILABLE` (D3) |
| ADOPT-07 | Ticker de adoção (`worker`/`all`, flag ligada): enquanto `ativas < teto`, adota e chama `reconnectSession` pela origem `auto`; falha só loga (o backoff já foi gravado). `stop()` espera o tick em curso |
| ADOPT-08 | Com a flag ligada, `SESSION_BOOTSTRAP_ON_STARTUP=true` não roda `SessionBootstrapService` (sem teto); o ticker readota inclusive as puladas por lease de outro processo (fecha D2 da E2). Reconciler do boot segue como hoje |
| ADOPT-09 | E3: worker com `ativas >= teto` pausa o consumo local de `session-open` e retoma abaixo do teto (a fila fica para outro worker) |
| ADOPT-10 | Heartbeat: tabela `worker_heartbeats` (`workerId` PK, `role`, `sessions`, `maxSessions`, `rssMb`, `seenAt`) com upsert a cada 20 s em `worker`/`all` com a flag; linha apagada no shutdown |
| ADOPT-11 | Alerta de capacidade sob `JobLease` `worker-capacity-alert` (1 processo por vez): log `warn` estruturado quando ADOPT-02 dispara; e-mail ao super-admin conforme D5 |
| ADOPT-12 | `GET /admin/workers` (super-admin): workers vivos com ocupação + total de sessões aguardando capacidade. Painel `/admin/workers` lista (Plataforma) |
| ADOPT-13 | Sessão com pedido vivo e sem lease vivo, flag ligada: `awaitingCapacity: true` no item da API; painel mostra "Aguardando capacidade" (i18n, claro/escuro) |
| ADOPT-14 | Shutdown (`all`/`worker`) conforme D4: parar ticker/heartbeat junto com o keeper → jobs → drain de mídia com teto que reserva o fim (flush tem prioridade) → `closeAllSockets` → flush → `releaseAllOwned` → apaga heartbeat → `app.close()`; tudo em 30 s − 3 s |

## Fora do escopo

- Autoescala (controlador chamando a API da infra): diferida até o 1º worker extra em produção (§3.2).
- Shard por hash; tenant dedicado (só o filtro `WORKER_SHARD` entra; ninguém grava `Session.shard` ainda).
- N réplicas `http` (E3 D5). Filas de produto (E5).

## Design inline

| Peça | Onde (`api/src/`) | Papel |
| --- | --- | --- |
| `workerAdoptionConfig` | `shared/config/workerAdoption.ts` | lê as 3 envs (sem regra) |
| `sessionAdoptionPolicy` | `sessions/domain/services/` | constantes + `capacityAlertReason(...)` pura |
| `ISessionAdoptionRepository` / `PrismaSessionAdoptionRepository` | `sessions/domain/contracts/`, `sessions/infrastructure/repositories/` | `adoptNext`, `failExhausted`, `resetFailures`, `countAwaitingCapacity` (SQL cru) |
| `CapacityLimitedLeaseGate` | `sessions/application/services/` | decorador de `ISessionLeaseGate` (ADOPT-06) |
| `AdoptNextSessionUseCase` + `SessionAdoptionTicker` | `sessions/application/` | um tick; timer encadeado `unref` |
| `IWorkerHeartbeatRepository` / Prisma | `sessions/domain/contracts/`, `sessions/infrastructure/repositories/` | `beat`, `listAlive`, `remove` |
| `WorkerHeartbeatJob`, `WorkerCapacityAlertJob` | `sessions/infrastructure/jobs/` | timers 20 s / 60 s |
| `IJobLease` / `PrismaJobLease` | `shared/jobs/` | lease de job genérico (extraído do rodízio) |
| `sessionAdoptionContainer` | `sessions/infrastructure/lease/` | composição lazy |

## Critérios de aceite (smoke, depois de T17)

1. Flag desligada: boot/shutdown com o mesmo log da E3 (`all` e `http`+`worker`); nenhuma escrita em `worker_heartbeats`.
2. 2 workers, teto 1, 3 sessões com pedido: 2 conectam (uma por worker), a 3ª fica `awaitingCapacity`; alerta dispara uma vez.
3. Matar um worker: depois do TTL o outro só adota se tiver vaga; com vaga, conecta sem 440.
4. Sessão que nunca conecta: 5 adoções espaçadas pelo backoff → `FAILED` e pedido nulo; reconectar à mão zera o contador.
5. `SIGTERM`: flush antes de soltar lease, dentro de 27 s, heartbeat apagado.

## Decisões

Ver `tasks.md`, "Decisões para o dono".
