# Lease de sessão (E2) — Tasks

**Spec**: `.specs/features/session-lease/spec.md` (design inline lá)
**Status**: Draft

Regras comuns a toda task:

- Caminhos relativos a `api/src/` salvo indicação. Uma task = um commit (`tipo(escopo): …` + `Co-Authored-By`).
- **Nunca** rodar nada contra o banco de `api/.env` (produção): nada de `migrate dev`/`deploy`/`db push`/`start:migrate`.
- Gate `quick`: `cd api && pnpm vitest run <arquivos de teste da task> && pnpm tsc --noEmit`.
- Gate `int` (repositório Prisma com SQL cru): `api/scripts/postgres-descartavel.sh start` → `INTEGRATION_DATABASE_URL=<impresso> pnpm -C api test:int <arquivo>` → `api/scripts/postgres-descartavel.sh stop`; mais o `quick`.
- Dependência nova em construtor entra **opcional** (padrão no-op) para a task compilar sozinha; T21/T22 ligam.
- Dublês de `ISessionRepository` só em `sessions/application/use-cases/sessionTestFakes.ts`, atualizado em T14; T15–T18 não editam esse arquivo.

## Status

| ID | Título | Deps | [P] | Status |
| --- | --- | --- | --- | --- |
| T1 | Migration `add-session-lease` + schema | — | P | ✅ fb1a4f2 |
| T2 | Identidade `WORKER_ID` | — | P | ✅ 403acef |
| T3 | Política do lease (constantes + fence pura) | — | P | ✅ 1e35503 |
| T4 | `ISessionLeaseRepository` + Prisma + `SessionLeaseHeldError` | T1, T3 | | ✅ 80e3627 |
| T5 | Razão local + `Acquire`/`ReleaseSessionLeaseUseCase` | T4 | | ✅ 4027648 |
| T6 | `ISessionSocketControl` + implementação Baileys | — | P | ✅ f5a3180 |
| T7 | `ISessionSocketControl` no Telegram | T6 | | ✅ bc90c0d |
| T8 | Router implementa `ISessionSocketControl` | T6, T7 | | ✅ 23f98c1 |
| T9 | `RenewSessionLeaseUseCase` (fence) + `SessionLeaseKeeper` | T5, T6 | P | ✅ d6786ee |
| T10 | Baileys: lease antes de `openSocket` | T4, T6 | P | ✅ 12672a5 |
| T11 | Telegram: lease antes de `openClient` | T4, T7 | P | ✅ faf207b |
| T12 | CAS no repositório do auth state | — | P | ✅ bc525a7 |
| T13 | CAS no `BaileysAuthStatePersistence` + conflito derruba socket | T10, T12 | | ✅ 3f0c86e |
| T14 | Repositório de sessão: marcar/limpar `connectRequestedAt` | T1 | | ✅ b62fa5e |
| T15 | Helper `markConnectRequested` + connect/reconnect | T14 | | ✅ eb42c9b |
| T16 | `markConnectRequested` em pairing-code e login Telegram | T15 | P | ✅ 80d4185 |
| T17 | Disconnect/Logout/Delete: limpa pedido + solta lease | T5, T14 | P | ✅ 9e0a2cc |
| T18 | Suspensão de tenant: limpa pedido + solta lease | T5, T14 | P | ✅ 5c8315b |
| T19 | Consulta de sessões ativas sem lease vivo | T14 | | ✅ 53e295a |
| T20 | Reconciler e bootstrap cientes do lease | T10, T11, T19 | P | ✅ 626881e |
| T21 | Composição: `sessionLeaseContainer` + rotas + factory | T2, T5, T8, T9, T10, T11, T13, T15, T16, T17, T18 | | ✅ f3ecacf |
| T22 | `server.ts`: keeper, boot e ordem do shutdown | T20, T21 | | ⏳ |
| T23 | Docs, CHANGELOG e versão | T22 | | ⏳ |

## Notas de execução (passagem entre tarefas)

- T2: id do processo só por `currentWorkerId()` (`shared/config/workerIdentity.ts`), nunca recalcular.
- T3: `isLeaseFenceExpired(lastRenewOkAt: Date, now: Date)`; T5/T9 passam `Date`, não ms.
- T6: `abortSession` espera `discardAuthState` (inclusive escrita em voo). Na T13, chamar como `onVersionConflict` **sem `await`** dentro do caminho de escrita, senão trava na própria escrita. Timers de reconexão já são cancelados no abort/closeAll.
- T12: `writeKeys(..., { expectedVersion })` devolve `{ ok, version } | VERSION_CONFLICT`; `findAllKeysVersioned` lê em REPEATABLE READ; sem `expectedVersion` = upsert antigo.
- T4: `ISessionLeaseRepository` (`tryAcquire`/`renew`/`release`/`releaseAllOwned`) + porta `ISessionLeaseGate`; SQL usa `now() AT TIME ZONE 'UTC'`; `SessionLeaseHeldError` (503). Lease sem `tenantId` de propósito (processo, `sessionId` único).
- T7: Telegram implementa `ISessionSocketControl`; `shutdown()` antigo usa `Promise.all`, T22 decide trocar por `closeAllSockets`.
- T14: `markConnectRequested(id, tenantId)` (não sobrescreve pedido anterior, zero linhas não é erro: validar posse antes com `findById`); limpar via `updateStatus({ clearConnectRequest: true })`.
- T5: `SessionLeaseLedger` (`markOk`/`drop`/`ids`/`lastOk`); `AcquireSessionLeaseUseCase` implementa `ISessionLeaseGate` (erro de banco = `false` + warn); `ReleaseSessionLeaseUseCase.execute(id)` nunca lança.
- T8: `MessagingEngineRouter` implementa `ISessionSocketControl` (detecção em runtime; `closeAllSockets` só loga falha).
- T10: Baileys `openSocket(..., origin 'user'|'auto')`; lease negado: user → `SessionLeaseHeldError`, auto → warn + `false`. **Bootstrap chama `connectSession` (origem user) → T20 deve tratar `SessionLeaseHeldError` como caminho automático.** Reabertura pós-limpeza de credenciais (≈L1680) grava `CONNECTING` antes do acquire.
- T11: Telegram `openClient` faz acquire antes de tudo; negado não derruba cliente local (T9/D4 derruba).
- T15: helper em `sessions/application/services/markConnectRequested.ts`; marca antes do `updateStatus`; T16 cobre pairing + 3 do Telegram.
- T19: `findActiveSessionsWithoutLiveLease()` (constante `ACTIVE_STATUSES` compartilhada com bootstrap); T20 liga no reconciler/bootstrap.
- Gate integrado após onda 3: `tsc` ok, vitest sessions+messaging+shared 437/437.
- T9: `RenewSessionLeaseUseCase` + `SessionLeaseKeeper` (setTimeout encadeado 20 s, `unref`, `stop()` espera tick em curso). Não ligado ainda.
- T13: `BaileysAuthStatePersistence` com CAS; adapter passa `onVersionConflict: (id) => this.abortSession(id)`; conflito na migração do blob lança `SessionLeaseHeldError`.
- T17/T18: Disconnect/Logout/Delete e `TenantSuspendedSessionListener` aceitam `leaseRelease?` opcional. **T21 precisa passar `leaseRelease` nos 3 use cases (`session.routes.ts`) e no listener (`server.ts:275`).**
- T20: reconciler usa `findActiveSessionsWithoutLiveLease`; bootstrap pula `SessionLeaseHeldError`. Atenção T21/T22: no boot, `reconnectSession` com origem auto devolve `false` sem lançar e o bootstrap loga "Session bootstrapped" sem socket (só log enganoso; status não muda).
- Gate integrado após onda 4: `tsc` ok, vitest sessions+messaging+shared 499/499.
- T21: `sessionLeaseContainer()` (lazy, 1 por processo: `workerId`, `repo`, `ledger`, `acquire`, `renew`, `release`, `keeper` parado, `bindSocketControl`). Factory recebe `leaseGate`; rotas passam `release` a Disconnect/Logout/Delete. **NÃO fazer deploy entre T21 e T22**: sem `keeper.start()` o lease vence em 60 s.
- Pendências para T22: `keeper.start()` no boot e `stop()` primeiro no shutdown; `registerTenantSuspendedSessionListener` com `release` (`server.ts:275`); bootstrap: não logar "Session bootstrapped" quando a reconexão auto devolver `false` (lease de outro processo).

## Execution Plan

```
Fase 1 (paralelo):  T1   T2   T3   T6   T12
Fase 2:             T1,T3 → T4      T6 → T7      T1 → T14
Fase 3:             T4 → T5         T6,T7 → T8   T4,T6 → T10   T4,T7 → T11
                    T14 → T15       T14 → T19
Fase 4 (paralelo):  T5,T6 → T9      T10,T12 → T13   T15 → T16
                    T5,T14 → T17    T5,T14 → T18    T10,T11,T19 → T20
Fase 5:             T2,T5,T8,T9,T10,T11,T13,T15,T16,T17,T18 → T21
Fase 6:             T20,T21 → T22 → T23
```

Arquivos compartilhados que forçam ordem: `BaileysMessagingEngineAdapter.ts` (T6 → T10 → T13),
`TelegramMessagingEngineAdapter.ts` (T7 → T11), `ISessionRepository.ts`/`PrismaSessionRepository.ts`
(T14 → T19), `session.routes.ts`/`MessagingEngineFactory.ts` (só T21), `server.ts` (só T22).

---

## Task Breakdown

### T1: Migration `add-session-lease` + schema [P]

**What**: colunas de lease em `Session` e migration SQL escrita à mão.
**Where**: `api/prisma/schema.prisma` (model `Session`), `api/prisma/migrations/<timestamp > 20261104140000>_add_session_lease/migration.sql`
**Depends on**: —
**Requirement**: LEASE-01
**SQL**:
```sql
-- AlterTable: dono da sessão (lease) e pedido de conexão (docs/arquitetura-escala.md §3.1)
ALTER TABLE "sessions"
  ADD COLUMN "ownerWorkerId" TEXT,
  ADD COLUMN "leaseUntil" TIMESTAMP(3),
  ADD COLUMN "connectRequestedAt" TIMESTAMP(3),
  ADD COLUMN "nextAdoptAt" TIMESTAMP(3),
  ADD COLUMN "adoptFailures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "shard" TEXT;

-- CreateIndex
CREATE INDEX "sessions_ownerWorkerId_idx" ON "sessions"("ownerWorkerId");
CREATE INDEX "sessions_connectRequestedAt_idx" ON "sessions"("connectRequestedAt");

-- Backfill (D3): sessões já conectadas contam como pedido de conexão, para a E4 readotá-las
UPDATE "sessions" SET "connectRequestedAt" = NOW() WHERE "status" = 'CONNECTED' AND "deletedAt" IS NULL;
```
(confirmar nomes reais de `status`/`deletedAt` e o valor do enum no schema)
**Done when**:
- [ ] Model com os 6 campos (comentário curto em cada) e `@@index([ownerWorkerId])`, `@@index([connectRequestedAt])`
- [ ] `pnpm prisma migrate diff --from-schema-datamodel <schema antes> --to-schema-datamodel prisma/schema.prisma --script` (offline) bate com o SQL
- [ ] `pnpm prisma generate` + `pnpm tsc --noEmit` ok; `postgres-descartavel.sh start` aplica todas as migrations sem erro
**Tests**: int (aplicação da migration no Postgres descartável)
**Gate**: `int` (só o `start`/`stop`) + `pnpm tsc --noEmit`
**Commit**: `feat(prisma): adiciona colunas de lease em sessions`

### T2: Identidade `WORKER_ID` [P]

**What**: `WORKER_ID` opcional em `env.ts` e `resolveWorkerId(env, host, pid, random)` pura: env ou `${HOSTNAME ?? os.hostname()}-${pid}-${nonce8}`, calculado uma vez por boot.
**Where**: `shared/config/env.ts`, `shared/config/workerIdentity.ts` (+ `.test.ts`)
**Depends on**: —
**Requirement**: LEASE-02
**Done when**:
- [ ] Env vazia gera id com host, pid e nonce de 8 caracteres; dois boots simulados geram ids diferentes
- [ ] `WORKER_ID` definido é usado como veio (trim; vazio = gera)
- [ ] Nada de `WORKER_ADOPTION_ENABLED`/`WORKER_MAX_SESSIONS` aqui (E4)
**Tests**: unit (`workerIdentity.test.ts`, ≥ 3 casos)
**Gate**: `quick`
**Commit**: `feat(sessions): identidade do worker por boot`

### T3: Política do lease [P]

**What**: constantes `LEASE_TTL_MS=60_000`, `LEASE_RENEW_INTERVAL_MS=20_000`, `LEASE_FENCE_MARGIN_MS=5_000`, `LEASE_RENEW_TIMEOUT_MS=5_000` e `isLeaseFenceExpired(lastRenewOkAt, now)` (`now > last + TTL − margem`).
**Where**: `modules/sessions/domain/services/sessionLeasePolicy.ts` (+ `.test.ts`)
**Depends on**: —
**Requirement**: LEASE-04, LEASE-11
**Done when**:
- [ ] Função pura, sem dependência; 54,9 s = válido, 55,1 s = vencido
**Tests**: unit (≥ 3 casos)
**Gate**: `quick`
**Commit**: `feat(sessions): política de lease de sessão`

### T4: `ISessionLeaseRepository` + Prisma + erro

**What**: contrato e implementação com SQL cru:
`tryAcquire(sessionId, workerId, ttlMs): boolean` (cláusula de LEASE-03, inclui `ownerWorkerId=$me`, ignora `deletedAt` não nulo);
`renew(ids, workerId, ttlMs): string[]` (`UPDATE … WHERE id = ANY($ids) AND "ownerWorkerId"=$me AND "leaseUntil" > now() RETURNING id`);
`release(sessionId, workerId)` (condicionado ao dono);
`releaseAllOwned(workerId): number` (solta leases e marca `DISCONNECTED` + `lastDisconnectedAt` as ativas do worker; mantém `connectRequestedAt`; ver D1).
No mesmo contrato, a porta estreita `ISessionLeaseGate { acquire(sessionId): Promise<boolean> }` usada pelos adapters.
`SessionLeaseHeldError` (código `ENGINE_TEMPORARILY_UNAVAILABLE`, 503, subclasse distinguível por `instanceof`).
**Where**: `modules/sessions/domain/contracts/ISessionLeaseRepository.ts`, `modules/sessions/infrastructure/repositories/PrismaSessionLeaseRepository.ts` (+ `.int.test.ts`), `shared/errors/internal/SessionErrors.ts`
**Depends on**: T1, T3
**Reuses**: padrão de `PrismaLinkRotationRepository.int.test.ts`; `now()` do banco, nunca relógio do Node
**Requirement**: LEASE-03, LEASE-04, LEASE-05, LEASE-09
**Done when**:
- [ ] Lease livre/vencido/próprio → adquire; de outro e vivo → `false`
- [ ] `renew` devolve só os ids ainda do worker; lease vencido não renova
- [ ] `release` de outro dono não altera nada; `releaseAllOwned` só toca as do worker
**Tests**: int (≥ 7 casos)
**Gate**: `int`
**Commit**: `feat(sessions): repositório de lease de sessão`

### T5: Razão local + Acquire/Release

**What**: `SessionLeaseLedger` (`sessionId → lastRenewOkAt`; `markOk`, `drop`, `ids`, `lastOk`); `AcquireSessionLeaseUseCase` (implementa `ISessionLeaseGate`: `tryAcquire` → `markOk`; falso → `false`; erro de banco → `false` + log); `ReleaseSessionLeaseUseCase` (`drop` + `release`, nunca lança).
**Where**: `modules/sessions/application/services/SessionLeaseLedger.ts`, `modules/sessions/application/use-cases/AcquireSessionLeaseUseCase.ts`, `.../ReleaseSessionLeaseUseCase.ts` (+ testes)
**Depends on**: T4
**Requirement**: LEASE-03, LEASE-05
**Done when**:
- [ ] Workerid e relógio injetados; sem Prisma
- [ ] Acquire ok grava no razão; Release tira do razão mesmo com erro de banco
**Tests**: unit (≥ 6 casos)
**Gate**: `quick`
**Commit**: `feat(sessions): adquirir e soltar lease de sessão`

### T6: `ISessionSocketControl` + Baileys [P]

**What**: contrato `abortSession(sessionId)` (detach + `end` + tira do registry + `discardAuthState`, **sem** gravar status nem chave, sem reconexão automática), `closeAllSockets()` (detach + `end` de todos; handles de auth ficam para o flush), `listLocalSessionIds()` (`registry.getAll`). Implementação no adapter Baileys.
**Where**: `modules/messaging/domain/contracts/ISessionSocketControl.ts`, `modules/messaging/infrastructure/engines/baileys/BaileysMessagingEngineAdapter.ts` (+ `BaileysMessagingEngineAdapter.socketControl.test.ts`)
**Depends on**: —
**Reuses**: `detachSocket`, `BaileysSessionRegistry`, `discardAuthState`; mock de socket de `BaileysMessagingEngineAdapter.pairing.test.ts`
**Requirement**: LEASE-04, LEASE-09
**Done when**:
- [ ] Abort não chama `updateStatus` nem `releaseAuthState`; timer de reconexão pendente não reabre (registry vazio + lease em T10)
- [ ] `closeAllSockets` não descarta handles (o `flushAllAuthStates` seguinte ainda grava)
**Tests**: unit (≥ 4 casos)
**Gate**: `quick`
**Commit**: `feat(messaging): controle de socket para lease no Baileys`

### T7: `ISessionSocketControl` no Telegram

**What**: mesmos 3 métodos no adapter Telegram (`teardown` sem `updateStatus`; `closeAllSockets` em paralelo com `Promise.allSettled`).
**Where**: `modules/messaging/infrastructure/engines/telegram/TelegramMessagingEngineAdapter.ts` (+ `TelegramMessagingEngineAdapter.socketControl.test.ts`)
**Depends on**: T6
**Requirement**: LEASE-04, LEASE-09
**Done when**:
- [ ] Abort destrói o cliente, rejeita login pendente e não grava status nem StringSession
**Tests**: unit (≥ 3 casos)
**Gate**: `quick`
**Commit**: `feat(messaging): controle de socket para lease no Telegram`

### T8: Router implementa `ISessionSocketControl`

**What**: `MessagingEngineRouter` implementa o contrato: `abortSession` resolve a engine da sessão; `closeAllSockets`/`listLocalSessionIds` agregam todas as engines.
**Where**: `modules/messaging/infrastructure/MessagingEngineRouter.ts` (+ `MessagingEngineRouter.test.ts`)
**Depends on**: T6, T7
**Requirement**: LEASE-04, LEASE-09
**Done when**:
- [ ] `closeAllSockets` espera todas mesmo se uma falhar; ids das duas engines aparecem
**Tests**: unit (≥ 3 casos novos)
**Gate**: `quick`
**Commit**: `feat(messaging): roteador expõe controle de socket`

### T9: `RenewSessionLeaseUseCase` + `SessionLeaseKeeper` [P]

**What**: Renew: ids = razão ∩ `listLocalSessionIds()`; fora do socket local → `drop` (sem renovar); `renew` com timeout `LEASE_RENEW_TIMEOUT_MS`; ids não devolvidos → `abortSession` + `drop` já; erro/timeout → para cada id com `isLeaseFenceExpired` → `abortSession` + `drop`. O fence é checado **antes** da chamada ao banco. Keeper: `setTimeout` encadeado de 20 s, sem sobreposição, `start`/`stop` (stop espera o tick em curso).
**Where**: `modules/sessions/application/use-cases/RenewSessionLeaseUseCase.ts`, `modules/sessions/application/services/SessionLeaseKeeper.ts` (+ testes)
**Depends on**: T5, T6 (contrato)
**Requirement**: LEASE-04
**Done when**:
- [ ] Perdeu (zero linhas) → abort imediato; banco fora 54 s → mantém; 56 s → abort
- [ ] Keeper com relógio falso não sobrepõe ticks; `stop` impede novo tick
**Tests**: unit (≥ 6 casos, `vi.useFakeTimers`)
**Gate**: `quick`
**Commit**: `feat(sessions): renovação de lease com fence local`

### T10: Baileys — lease antes de `openSocket` [P]

**What**: construtor ganha `leaseGate?: ISessionLeaseGate` (padrão: sempre `true`). `openSocket` chama `acquire` antes de `buildBaileysAuthState`; `false` → `SessionLeaseHeldError` nos caminhos do usuário (`connectSession`, `reconnectSession`, `requestPairingCode`) e só log na reconexão automática (sem `updateStatus`).
**Where**: `modules/messaging/infrastructure/engines/baileys/BaileysMessagingEngineAdapter.ts` (+ `BaileysMessagingEngineAdapter.lease.test.ts`)
**Depends on**: T4, T6
**Requirement**: LEASE-03
**Done when**:
- [ ] Lease negado: `makeWASocket` não é chamado, auth state não é carregado, status não muda
- [ ] Reconexão automática negada não lança nem grava `FAILED`
**Tests**: unit (≥ 3 casos)
**Gate**: `quick`
**Commit**: `feat(messaging): Baileys só abre socket com lease`

### T11: Telegram — lease antes de `openClient` [P]

**What**: mesmo de T10 no Telegram: `openClient` adquire antes de criar o `TelegramClient` (antes do `updateStatus('CONNECTING')`); vale para connect, reconnect e `requestLoginCode`. Sem lease não há segundo cliente (evita `AUTH_KEY_DUPLICATED`).
**Where**: `modules/messaging/infrastructure/engines/telegram/TelegramMessagingEngineAdapter.ts` (+ `TelegramMessagingEngineAdapter.lease.test.ts`)
**Depends on**: T4, T7
**Requirement**: LEASE-03
**Done when**:
- [ ] Lease negado: nenhum cliente criado, status intacto, `SessionLeaseHeldError`
**Tests**: unit (≥ 2 casos)
**Gate**: `quick`
**Commit**: `feat(messaging): Telegram só abre cliente com lease`

### T12: CAS no repositório do auth state [P]

**What**: `findAllKeysVersioned(sessionId): { keys, version: number | null }` (uma transação de leitura); `SessionAuthKeyBatch.expectedVersion?: number | null`; `writeKeys` devolve `WriteKeysResult = { ok: true; version } | { ok: false; reason: 'VERSION_CONFLICT' }`. Com `expectedVersion` definido: `UPDATE session_auth_states SET version = version + 1 WHERE "sessionId"=$1 AND version=$esperado RETURNING version` **antes** das chaves; `null` = linha não pode existir (`INSERT … ON CONFLICT DO NOTHING RETURNING`); zero linhas = conflito sem tocar chaves. Sem `expectedVersion` = comportamento atual. `findAllKeys` continua (Telegram).
**Where**: `modules/sessions/domain/contracts/ISessionAuthStateRepository.ts`, `modules/sessions/infrastructure/repositories/PrismaSessionAuthStateRepository.ts` (+ `PrismaSessionAuthStateRepository.int.test.ts`)
**Depends on**: —
**Requirement**: LEASE-06
**Done when**:
- [ ] Versão certa grava e devolve `version+1`; errada não grava nenhuma chave; `clearCredentials` faz o handle antigo conflitar
- [ ] Telegram e migração legada compilam sem mudança de comportamento
**Tests**: int (≥ 5 casos)
**Gate**: `int`
**Commit**: `feat(sessions): CAS por versão no auth state`

### T13: CAS no `BaileysAuthStatePersistence`

**What**: `buildHandle` carrega com `findAllKeysVersioned` e guarda a versão; toda `writeKeys` (inclui migração do blob) passa `expectedVersion` e atualiza a versão no sucesso. Conflito: log `warn`, `dispose` sem órfão (pendente vai fora), **sem** retry, chama `deps.onVersionConflict(sessionId)`. Adapter passa `onVersionConflict = abortSession`.
**Where**: `modules/messaging/infrastructure/engines/baileys/BaileysAuthStatePersistence.ts` (+ `.test.ts` existente), `BaileysMessagingEngineAdapter.ts` (uma linha em `openSocket`)
**Depends on**: T10, T12
**Requirement**: LEASE-06
**Done when**:
- [ ] Conflito não re-tenta, não guarda em `orphanDirty`, chama o callback uma vez
- [ ] Testes antigos de flush/retry/órfão seguem verdes (nenhum apagado)
**Tests**: unit (≥ 3 casos novos)
**Gate**: `quick`
**Commit**: `feat(messaging): auth state do Baileys descarta escrita com versão velha`

### T14: Repositório de sessão — `connectRequestedAt`

**What**: `ISessionRepository.markConnectRequested(id, tenantId)` (`COALESCE("connectRequestedAt", now())`, com `tenantId`); `SessionStatusUpdate.clearConnectRequest?: boolean` grava `connectRequestedAt = null` na mesma escrita do status. Dublês novos em `sessionTestFakes.ts`.
**Where**: `modules/sessions/domain/contracts/ISessionRepository.ts`, `modules/sessions/infrastructure/repositories/PrismaSessionRepository.ts` (+ `PrismaSessionRepository.test.ts`), `modules/sessions/application/use-cases/sessionTestFakes.ts`
**Depends on**: T1
**Requirement**: LEASE-07, LEASE-08
**Done when**:
- [ ] `updateMany` filtra `id` + `tenantId`; sem `clearConnectRequest` nada muda no campo
**Tests**: unit (prisma mockado, padrão do teste existente; ≥ 3 casos)
**Gate**: `quick`
**Commit**: `feat(sessions): marcar e limpar pedido de conexão`

### T15: Helper `markConnectRequested` + connect/reconnect

**What**: `markConnectRequested(sessionRepo, sessionId, tenantId)` (ponto único; E3 o chama das rotas). Connect e Reconnect chamam depois da validação e antes da engine.
**Where**: `modules/sessions/application/services/markConnectRequested.ts`, `.../use-cases/ConnectSessionUseCase.ts`, `.../use-cases/ReconnectSessionUseCase.ts` (+ `ConnectSessionUseCase.test.ts`, `ReconnectSessionUseCase.test.ts`)
**Depends on**: T14
**Requirement**: LEASE-07
**Done when**:
- [ ] Ordem verificada: validação → marca → engine; estado inválido não marca
**Tests**: unit (≥ 4 casos)
**Gate**: `quick`
**Commit**: `feat(sessions): connect e reconnect registram pedido de conexão`

### T16: Pairing-code e login Telegram [P]

**What**: `markConnectRequested` em `RequestSessionPairingCodeUseCase` e nos 3 de `SessionLoginByCodeUseCases` (send-code, sign-in, password), antes da engine.
**Where**: `.../use-cases/RequestSessionPairingCodeUseCase.ts` (+ `.test.ts` existente), `.../use-cases/SessionLoginByCodeUseCases.ts` (+ `SessionLoginByCodeUseCases.test.ts`)
**Depends on**: T15
**Requirement**: LEASE-07
**Done when**:
- [ ] Telefone inválido/sessão conectada não marca; falha da engine mantém a marca
**Tests**: unit (≥ 5 casos)
**Gate**: `quick`
**Commit**: `feat(sessions): pareamento e login Telegram registram pedido de conexão`

### T17: Disconnect/Logout/Delete [P]

**What**: os 3 gravam status com `clearConnectRequest: true` **antes** da engine (Disconnect inverte a ordem atual; Delete limpa antes de desconectar); depois do socket fechado chamam `leaseRelease?.execute(sessionId)` (parâmetro opcional novo no construtor).
**Where**: `.../use-cases/DisconnectSessionUseCase.ts`, `.../use-cases/LogoutSessionUseCase.ts`, `.../use-cases/DeleteSessionUseCase.ts` (+ `DisconnectSessionUseCase.test.ts`, `LogoutSessionUseCase.test.ts`, `DeleteSessionUseCase.test.ts` existente)
**Depends on**: T5, T14
**Requirement**: LEASE-05, LEASE-08
**Done when**:
- [ ] Ordem verificada: status+limpeza → engine → release; falha da engine no Delete ainda solta lease
**Tests**: unit (≥ 6 casos)
**Gate**: `quick`
**Commit**: `feat(sessions): desconectar, sair e excluir limpam pedido e lease`

### T18: Suspensão de tenant [P]

**What**: `registerTenantSuspendedSessionListener` grava `DISCONNECTED` + `clearConnectRequest` antes de `engine.disconnectSession`, depois solta o lease (`leaseRelease?` opcional). Mantém o filtro atual (`canDisconnect`).
**Where**: `modules/sessions/infrastructure/listeners/TenantSuspendedSessionListener.ts` (+ `.test.ts`)
**Depends on**: T5, T14
**Requirement**: LEASE-05, LEASE-08
**Done when**:
- [ ] Falha numa sessão não impede as outras; ordem status → engine → release
**Tests**: unit (≥ 3 casos, `internalEventBus` real)
**Gate**: `quick`
**Commit**: `feat(sessions): suspensão de tenant limpa pedido e lease`

### T19: Sessões ativas sem lease vivo

**What**: `ISessionRepository.findActiveSessionsWithoutLiveLease()` = filtro de `findActiveSessionsForBootstrap` + `("leaseUntil" IS NULL OR "leaseUntil" < now())` (relógio do banco).
**Where**: `ISessionRepository.ts`, `PrismaSessionRepository.ts` (+ `PrismaSessionRepository.int.test.ts`)
**Depends on**: T14
**Requirement**: LEASE-10
**Done when**:
- [ ] Lease vivo de outro worker fica fora; nulo e vencido entram; excluída fica fora
**Tests**: int (≥ 3 casos)
**Gate**: `int`
**Commit**: `feat(sessions): consulta sessões ativas sem lease vivo`

### T20: Reconciler e bootstrap cientes do lease [P]

**What**: `SessionStatusReconciler` usa `findActiveSessionsWithoutLiveLease`. `SessionBootstrapService`: `SessionLeaseHeldError` → log `info` e pula **sem** gravar `DISCONNECTED`; demais erros como hoje.
**Where**: `modules/sessions/application/services/SessionStatusReconciler.ts`, `.../services/SessionBootstrapService.ts` (+ testes de ambos)
**Depends on**: T10, T11, T19
**Requirement**: LEASE-10
**Done when**:
- [ ] Sessão com lease de outro worker não é tocada nem pelo reconciler nem pelo bootstrap
**Tests**: unit (≥ 4 casos)
**Gate**: `quick`
**Commit**: `feat(sessions): boot respeita lease de outro worker`

### T21: Composição

**What**: `sessionLeaseContainer` (singleton preguiçoso: `workerId` de T2, repo, razão, Acquire/Renew/Release, keeper sem iniciar). `MessagingEngineFactory` recebe `leaseGate` em `MessagingEngineDeps` e repassa aos dois adapters (com `onVersionConflict` já interno). `session.routes.ts` passa `leaseRelease` a Disconnect/Logout/Delete e o gate à factory; keeper recebe o router como `ISessionSocketControl`.
**Where**: `modules/sessions/infrastructure/lease/sessionLeaseContainer.ts`, `modules/messaging/infrastructure/MessagingEngineFactory.ts`, `modules/sessions/presentation/routes/session.routes.ts`
**Depends on**: T2, T5, T8, T9, T10, T11, T13, T15, T16, T17, T18
**Requirement**: LEASE-03, LEASE-05, LEASE-11
**Done when**:
- [ ] Nenhum `new PrismaSessionLeaseRepository` fora do container; nenhum handler acessa Prisma
- [ ] `session.routes.ts:60` é o único `createRouter` (conferido); se surgir outro, recebe o mesmo gate
**Tests**: unit (container devolve as mesmas instâncias; ≥ 2 casos)
**Gate**: `quick` + `pnpm vitest run` completo
**Commit**: `feat(sessions): liga lease de sessão na composição`

### T22: `server.ts` — keeper, boot e shutdown

**What**: inicia o keeper depois do boot das sessões; `registerTenantSuspendedSessionListener` recebe o release; shutdown nesta ordem: `keeper.stop()` → jobs → drain de mídia (como hoje) → `closeAllSockets()` (awaited, try/catch) → `flushAllAuthStates()` → `releaseAllOwned(workerId)` → `app.close()`. Log com contagem em cada passo. Não reordenar mídia × flush (E4).
**Where**: `app/server.ts`
**Depends on**: T20, T21
**Requirement**: LEASE-04, LEASE-09, LEASE-10
**Done when**:
- [ ] Ordem acima no código; falha de um passo não pula os seguintes
- [ ] Smoke 1–4 da spec no Postgres descartável com 2 processos (`node --env-file=.env.dev dist/app/server.js`, nunca `api/.env`)
**Tests**: none (matriz: bootstrap não tem teste; validado pelo smoke)
**Gate**: `pnpm tsc --noEmit` + `pnpm vitest run` + smoke
**Commit**: `feat(sessions): shutdown fecha sockets antes do flush e solta leases`

### T23: Docs, CHANGELOG e versão

**What**: `docs/arquitetura-escala.md` (§1 tabela, §3.1 "feito em E2", §4 fase 2 entregue, limites: bootstrap de deploy não readota até E4), `docs/sessoes-auth-state.md` (CAS), `docs/sessoes-conexao.md` e `docs/sessoes-telegram.md` (503 com lease de outro worker), `docs/plano-lancamento-hub-copysync.md` (E2 ✅), `CHANGELOG.md` (Added/Changed por arquivo), `api/package.json` 0.58.0 → 0.59.0; AGENTS.md: uma linha "socket só com lease; CAS em `writeKeys`".
**Where**: arquivos acima
**Depends on**: T22
**Requirement**: todos
**Done when**:
- [ ] Doc diz o que não fazer: abrir socket sem `ISessionLeaseGate`, gravar status ao abortar, `writeKeys` sem versão no Baileys
**Tests**: none
**Gate**: `pnpm tsc --noEmit`
**Commit**: `docs(sessions): lease de sessão (E2) e versão 0.59.0`

---

## Diagram-Definition Cross-Check

| Task | Depends on (corpo) | Diagrama | Status |
| --- | --- | --- | --- |
| T1–T3, T6, T12 | — | Fase 1 | ✅ |
| T4 | T1, T3 | T1,T3 → T4 | ✅ |
| T5 | T4 | T4 → T5 | ✅ |
| T7 | T6 | T6 → T7 | ✅ |
| T8 | T6, T7 | T6,T7 → T8 | ✅ |
| T9 | T5, T6 | T5,T6 → T9 | ✅ |
| T10 | T4, T6 | T4,T6 → T10 | ✅ |
| T11 | T4, T7 | T4,T7 → T11 | ✅ |
| T13 | T10, T12 | T10,T12 → T13 | ✅ |
| T14 | T1 | T1 → T14 | ✅ |
| T15 | T14 | T14 → T15 | ✅ |
| T16 | T15 | T15 → T16 | ✅ |
| T17, T18 | T5, T14 | T5,T14 → T17/T18 | ✅ |
| T19 | T14 | T14 → T19 | ✅ |
| T20 | T10, T11, T19 | T10,T11,T19 → T20 | ✅ |
| T21 | T2, T5, T8, T9, T10, T11, T13, T15–T18 | Fase 5 | ✅ |
| T22 | T20, T21 | T20,T21 → T22 | ✅ |
| T23 | T22 | T22 → T23 | ✅ |

[P] na mesma fase sem arquivo em comum: T9/T13/T16/T17/T18/T20 (Fase 4); T10/T11 (Fase 3).

## Test Co-location Validation

| Task | Camada | Matriz (`.specs/codebase/TESTING.md`) | Task | Status |
| --- | --- | --- | --- | --- |
| T1 | schema/migration | — | int (aplicar migration) | ✅ |
| T2, T3 | função pura | unit | unit | ✅ |
| T4, T12, T19 | repositório Prisma (SQL cru) | nenhum (por ora) | int (`*.int.test.ts`, padrão já usado em link-rotation/storefront) | ✅ acima do mínimo |
| T14 | repositório Prisma | nenhum | unit com prisma mockado (padrão do teste existente) | ✅ |
| T5, T9, T15–T18, T20 | application | unit | unit | ✅ |
| T6, T7, T10, T11, T13 | engine (adapter) | unit na parte pura | unit com socket/cliente mockado | ✅ |
| T8 | infra (router) | unit (teste existente) | unit | ✅ |
| T21 | composição | nenhum | unit leve | ✅ |
| T22 | `server.ts` | nenhum | smoke | ✅ |
| T23 | docs | nenhum | none | ✅ |
