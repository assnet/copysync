# Lease de sessão (escala E2) — Spec

**Fonte:** [`docs/arquitetura-escala.md`](../../../docs/arquitetura-escala.md) §3.1 (lease, CAS, `connectRequestedAt`),
§4 fase 2; [`docs/plano-lancamento-hub-copysync.md`](../../../docs/plano-lancamento-hub-copysync.md) linha E2 (M2).
**Tamanho:** Large (vários módulos, contrato de engine e de auth state, migration). Design inline aqui; tarefas em `tasks.md`.

## Problema

Todo dono de sessão é implícito (memória do processo). Dois processos (ou o deploy da Render, que sobe a
instância nova antes de matar a antiga) abrem socket da mesma sessão: 440 em cadeia e chaves Signal
corrompidas, porque `PrismaSessionAuthStateRepository.writeKeys` faz `version+1` sem condição. Nenhum
use case grava "esta sessão deve estar conectada", então nada externo sabe o que reconectar.

## Objetivo

Com 1 processo (`PROCESS_ROLE=all` de fato), tornar seguro ter 2 processos vivos ao mesmo tempo
(deploy, `pnpm dev` contra produção por engano, failover): só o dono do lease abre socket, quem perde o
lease derruba o socket sem gravar, e escrita de auth state com versão velha é descartada.

## Requisitos

| ID | Requisito |
| --- | --- |
| LEASE-01 | Migration `add-session-lease` em `sessions`: `ownerWorkerId TEXT`, `leaseUntil`, `connectRequestedAt`, `nextAdoptAt` (`TIMESTAMP(3)` nulos), `adoptFailures INT NOT NULL DEFAULT 0`, `shard TEXT`; índices em `ownerWorkerId` e `connectRequestedAt`. ADD COLUMN + backfill de `connectRequestedAt = NOW()` só nas sessões `CONNECTED` não apagadas (D3, decidido) |
| LEASE-02 | Identidade do processo `WORKER_ID` = env ou `${HOSTNAME ?? os.hostname()}-${pid}-${nonce8}`, única por boot (restart não herda lease) |
| LEASE-03 | Nenhum socket (Baileys `openSocket`, Telegram `openClient`) abre sem lease: `UPDATE … SET ownerWorkerId=$me, leaseUntil=now()+60s WHERE id=$id AND (leaseUntil IS NULL OR leaseUntil < now() OR ownerWorkerId=$me)`. Vale para connect, reconnect, pareamento, login Telegram, bootstrap e reconexão automática. Zero linhas: caminho do usuário recebe `ENGINE_TEMPORARILY_UNAVAILABLE` (503); caminho automático só loga e não abre |
| LEASE-04 | Renovação a cada 20 s só das sessões com socket local e lease no razão local: `WHERE id = ANY($ids) AND ownerWorkerId=$me AND leaseUntil > now()`. Sessão fora do retorno = perdeu: derruba já. Erro/timeout (5 s) = fence: derruba quando `now > lastRenewOkAt + 55 s`. Derrubar = fechar socket sem gravar auth state e sem gravar status |
| LEASE-05 | Lease solto (`ownerWorkerId`/`leaseUntil` = null, condicionado a `ownerWorkerId=$me`) depois do socket fechado em disconnect, logout, delete e suspensão de tenant |
| LEASE-06 | CAS do auth state: `writeKeys` aceita `expectedVersion`; atualiza `session_auth_states.version` com `WHERE version = esperado` **antes** das chaves, na mesma transação; versão diferente = nada gravado, resultado `VERSION_CONFLICT`. Leitura devolve chaves + versão. Handle Baileys em conflito: loga, descarta o pendente, nunca re-tenta, derruba o socket (LEASE-04). Sem `expectedVersion` = comportamento atual (Telegram, migração legada) |
| LEASE-07 | Helper único `markConnectRequested(sessionId, tenantId)` grava `connectRequestedAt = COALESCE(atual, now())` antes de falar com a engine em: `ConnectSessionUseCase`, `ReconnectSessionUseCase`, `RequestSessionPairingCodeUseCase`, `RequestSessionLoginCodeUseCase`, `SubmitSessionLoginCodeUseCase`, `SubmitSessionLoginPasswordUseCase` |
| LEASE-08 | `connectRequestedAt = null` na mesma escrita do status e **antes** da engine em `DisconnectSessionUseCase` (hoje engine → status; inverte), `LogoutSessionUseCase`, `DeleteSessionUseCase`, `TenantSuspendedSessionListener` |
| LEASE-09 | Shutdown: parar keeper de lease → jobs e drain de mídia como hoje → `closeAllSockets()` (novo, awaited) → `flushAllAuthStates()` → um `UPDATE` solta os leases deste worker e marca `DISCONNECTED` as ativas dele (mantém `connectRequestedAt`) → `app.close()` (ver D1) |
| LEASE-10 | Boot: `SessionStatusReconciler` só marca `DISCONNECTED` sessões com lease nulo/vencido; `SessionBootstrapService` pula sem gravar status a sessão cujo lease é de outro worker |
| LEASE-11 | Tudo ligado sem flag nova (lease protege até com 1 processo). Constantes 60 s / 20 s / 55 s / 5 s em uma política de domínio, sem env |

## Fora do escopo (fronteira)

- **E3:** `PROCESS_ROLE`, dono por job de boot (inclui filtrar `FailOrphanPendingMediaUseCase`, que é job do role `http`), BullMQ, RPC síncrono, Redis pub/sub.
- **E4:** `WORKER_ADOPTION_ENABLED`, `WORKER_MAX_SESSIONS`, `WORKER_SHARD`, tick de adoção, uso de `nextAdoptAt`/`adoptFailures`/`shard`, bootstrap pelo caminho de adoção, drain completo (inverter mídia × flush), heartbeat, alerta 80 %, "aguardando capacidade" no painel.
- CAS no auth state do Telegram (uma escrita por login; lease já impede o segundo cliente).

## Design inline

| Peça | Onde | Papel |
| --- | --- | --- |
| `sessionLeasePolicy` | `sessions/domain/services/` | constantes + `isLeaseFenceExpired(lastOkAt, now)` pura |
| `ISessionLeaseRepository` / `PrismaSessionLeaseRepository` | `sessions/domain/contracts/`, `sessions/infrastructure/repositories/` | `tryAcquire`, `renew(ids)`, `release`, `releaseAllOwned` (SQL cru, `$executeRaw`/`$queryRaw`) |
| `SessionLeaseLedger` | `sessions/application/services/` | razão em memória `sessionId → lastRenewOkAt` (espelho do banco, permitido por `arquitetura-escala.md` §6) |
| `Acquire/Renew/ReleaseSessionLeaseUseCase` | `sessions/application/use-cases/` | Acquire implementa a porta `ISessionLeaseGate` que os adapters recebem; Renew aplica o fence |
| `ISessionSocketControl` | `messaging/domain/contracts/` | `abortSession`, `closeAllSockets`, `listLocalSessionIds`; Baileys, Telegram e `MessagingEngineRouter` implementam |
| `markConnectRequested` | `sessions/application/services/` | helper único de LEASE-07 (E3 o chama das rotas antes do RPC) |
| `sessionLeaseContainer` | `sessions/infrastructure/lease/` | composição (workerId, repo, razão, use cases); `server.ts` liga o timer de 20 s |

Dependências novas entram como parâmetro **opcional** do construtor (padrão no-op), para cada tarefa
compilar sozinha; a tarefa de composição liga tudo.

## Critérios de aceite (smoke, depois de T21)

1. Dois `node dist/app/server.js` no Postgres descartável: conectar a mesma sessão no 2º devolve 503 e não abre socket.
2. Matar o banco do 1º por > 55 s (ou forçar `leaseUntil` no passado com outro dono): o 1º derruba o socket sem gravar chave.
3. `SIGTERM` no 1º: log mostra sockets fechados → flush → leases soltos; o 2º conecta em seguida sem 440.
4. Desconectar/excluir/sair: `connectRequestedAt` e lease nulos no banco.

## Decisões (2026-11-04, tomadas pelo orquestrador no padrão mais seguro; o dono pode rever)

| # | Decisão |
| --- | --- |
| D1 | Soltar lease no shutdown entra na E2 (T4/T22): sem isso o deploy deixa a sessão "CONNECTED" sem socket por até 60 s |
| D2 | Bootstrap no deploy pula sessão com lease de outro processo; aceito na E2 (flag hoje `false` em produção); readoção vem na E4 |
| D3 | Migration preenche `connectRequestedAt = NOW()` nas sessões `CONNECTED` com `deletedAt IS NULL`, para a E4 readotá-las |
| D4 | Renovação com zero linhas (lease tomado) derruba o socket na hora, sem gravar; o fence de 55 s cobre a falha de renovar |
| D5 | Lease de outro processo → `ENGINE_TEMPORARILY_UNAVAILABLE` (503), sem i18n novo |
| D6 | Sem `SESSION_LEASE_ENABLED`: rollback = voltar a versão (a migration só adiciona colunas) |
| D7 | `WORKER_ADOPTION_ENABLED`/`WORKER_MAX_SESSIONS` na E4; filtro de lease no `FailOrphanPendingMediaUseCase` na E3; CAS do auth state Telegram fora |
