# Separação HTTP × worker (E3) — Tasks

**Spec**: `.specs/features/worker-role/spec.md` (design inline lá)
**Status**: Draft (depende de E2 fechada: `session-lease` T23)

Regras comuns a toda task:

- Caminhos relativos a `api/src/` salvo indicação. Uma task = um subagente = um commit (`tipo(escopo): …` + `Co-Authored-By`).
- **Nunca** rodar nada contra o banco de `api/.env`/`api/.env.dev` (produção): nada de `migrate`/`db push`/`start:migrate`; smoke só com env sintético fora de `api/`.
- Gate `quick`: `cd api && pnpm vitest run <testes da task> && pnpm tsc --noEmit`.
- Gate `int` (SQL cru ou Redis real): `api/scripts/postgres-descartavel.sh start` e/ou `api/scripts/redis-descartavel.sh start` (T3) → `INTEGRATION_DATABASE_URL=… INTEGRATION_REDIS_URL=… pnpm -C api test:int <arquivo>` → `stop`; mais o `quick`.
- **Invariante `all`**: nenhuma task muda comportamento com `PROCESS_ROLE` ausente. Dependência nova entra opcional (padrão = hoje); T18/T19 ligam.
- Nenhuma migration nesta feature (colunas de lease já existem desde E2).

## Status

| ID | Título | Deps | [P] | Status |
| --- | --- | --- | --- | --- |
| T1 | `PROCESS_ROLE` + `REDIS_URL` + `processRole` | — | P | ✅ 869c3af |
| T2 | Engine local fora de `session.routes.ts` | — | P | ✅ 79c61cd |
| T3 | Redis: dependências, conexões lazy, script descartável | — | P | ✅ 89b1364 |
| T4 | Erro interno ↔ formato de fio | — | P | ✅ 52092c0 |
| T5 | `findLiveOwner` no repositório de lease | — | P | ✅ 09accd1 |
| T6 | `createOutboundMessageId` assíncrono | — | P | ✅ 133391b |
| T7 | Plano de chamadas da engine + codec + portas | T6 | | ✅ 20b57d0 |
| T8 | Transporte RPC no Redis | T3, T7 | P | ✅ 0a1135b |
| T9 | Filas BullMQ de comando (`engine-cmd-{id}`, `session-open`) | T3, T7 | P | ✅ ce3450a |
| T10 | `EngineCommandServer` (worker) | T4, T7 | P | ✅ 95e5f01 |
| T11 | `RemoteMessagingEngineAdapter` (http) | T4, T5, T7 | P | ✅ 2c5ca91 |
| T12 | Mídia de envio entre processos | T10, T11 | | ✅ 5ad61e3 |
| T13 | Fan-out de WS pelo Redis | T3 | P | ✅ 9c7ac87 |
| T14 | `FailOrphanPendingMedia` poupa lease vivo de outro processo | — | P | ✅ 78be0ed |
| T15 | Remover SSE `GET /chat/events` + `useChatSSE` | — | P | ✅ 3373d2e |
| T16 | Tabela de jobs por papel + gate no `server.ts` | T1 | | ✅ 43e7614 |
| T17 | Fastify mínimo do worker + `/health` com papel | T1, T3 | P | ✅ c0c31f2 |
| T18 | Composição por papel (engine, servidor de comandos, relay) | T2, T8, T9, T10, T11, T12, T13 | | ✅ e01910e |
| T18b | Rotas usam a engine ativa; concorrência das filas por env | T18 | | ✅ 2182861 |
| T19 | `server.ts`: boot e shutdown por papel | T14, T16, T17, T18 | | ✅ 8330cbf |
| T20 | Smoke `all` e `http`+`worker` | T19 | | ⏳ |
| T21 | Docs, CHANGELOG e versão | T20 | | ⏳ |

### T18b: Rotas usam a engine ativa; concorrência das filas por env

**What**: (1) `session.routes.ts` chama `localEngine()` no nível do módulo: no papel `http` isso carrega Baileys/GramJS e troca a engine ativa pela local (viola WROLE-02/05). Trocar por leitura de `getActiveEngine()` no registro das rotas (lazy, dentro do plugin) e garantir que o boot chame `composeForRole(role)` **antes** de `buildApp` (ordem documentada para a T19; em `all` o resultado tem de ser idêntico: `composeForRole('all')` = `localEngine()`). Conferir os outros consumidores que leem a engine no registro (`chat.routes`, containers) e que nenhum chame `localEngine()` direto fora de `roleComposition`/`localEngineContainer`. (2) env `ENGINE_COMMAND_CONCURRENCY` (int positivo, default 2) em `env.ts`, repassada pela `roleComposition` às filas.
**Where**: `sessions/presentation/routes/session.routes.ts`, `app/roleComposition.ts`, `shared/config/env.ts` (+ testes; ajustar testes de rota que dependiam do efeito do import)
**Depends on**: T18
**Done when**: teste: importar `session.routes` não monta engine; em `all` a engine ativa é a local; grep sem `localEngine()` fora dos 2 arquivos; env com default 2
**Tests**: unit
**Gate**: `pnpm vitest run src` + `pnpm tsc --noEmit`
**Commit**: `refactor(sessions): rotas leem a engine ativa do papel`

## Notas de execução (passagem entre tarefas)

(vazio — cada task registra aqui o que a próxima precisa saber)

## Execution Plan

```
Fase 1 (paralelo):  T1   T2   T3   T4   T5   T6   T14   T15
Fase 2:             T6 → T7        T1 → T16       T1,T3 → T17     T3 → T13
Fase 3 (paralelo):  T3,T7 → T8     T3,T7 → T9     T4,T7 → T10     T4,T5,T7 → T11
Fase 4:             T10,T11 → T12
Fase 5:             T2,T8,T9,T10,T11,T12,T13 → T18
Fase 6:             T14,T16,T17,T18 → T19 → T20 → T21
```

Arquivos compartilhados que forçam ordem: `server.ts` (T16 → T19), `RemoteMessagingEngineAdapter.ts` e
`EngineCommandServer.ts` (T10/T11 → T12), `env.ts` (só T1), `session.routes.ts` (só T2), `chat.routes.ts` (só T15),
`api/package.json` (T3 deps → T21 versão).

---

## Task Breakdown

### T1: `PROCESS_ROLE` + `REDIS_URL` + `processRole` [P]

**What**: envs novas e funções puras de papel. `PROCESS_ROLE` enum `http|worker|all` default `all`; `REDIS_URL` opcional.
`superRefine`: `http`/`worker` sem `REDIS_URL` ou com `MEDIA_STORAGE_DRIVER≠s3` → erro de validação claro.
`processRole.ts`: `currentRole()`, `runsSessions(role)` (`worker|all`), `runsHttp(role)` (`http|all`), `usesRedis(role)` (`≠ all`).
**Where**: `shared/config/env.ts`, `shared/config/processRole.ts`, `shared/config/env.processRole.test.ts`
**Depends on**: —
**Requirement**: WROLE-01
**Done when**:
- [ ] Sem env: `all`, `usesRedis` false; `all` + `REDIS_URL` continua `usesRedis` false
- [ ] `worker` sem `REDIS_URL` e `http` com driver `local` falham na validação
**Tests**: unit
**Gate**: quick
**Commit**: `feat(api): PROCESS_ROLE e REDIS_URL com validação por papel`

### T2: Engine local fora de `session.routes.ts` [P]

**What**: mover a composição de módulo (`MessagingEngineFactory.createRouter` + `lease.bindSocketControl` +
`setActiveEngine`, `session.routes.ts:61-76`) para `localEngine()` lazy e idempotente. `session.routes.ts` chama
`localEngine()` no mesmo ponto de hoje (registro das rotas), mantendo a ordem: engine pronta antes de `server.ts:285`.
Repositórios usados pela factory (`sessionRepo`, `authStateRepo`, chat repos, `ingestHistorySyncUseCase`) vão juntos.
**Where**: `messaging/infrastructure/localEngineContainer.ts`, `sessions/presentation/routes/session.routes.ts`, `messaging/infrastructure/localEngineContainer.test.ts`
**Depends on**: —
**Requirement**: WROLE-02
**Done when**:
- [ ] Duas chamadas devolvem a mesma instância; `getActiveEngine()` é ela; `bindSocketControl` chamado uma vez
- [ ] `session.routes.ts` sem `createRouter` próprio; testes de sessions verdes
**Tests**: unit (factory mockada)
**Gate**: quick
**Commit**: `refactor(messaging): composição da engine local em container lazy`

### T3: Redis: dependências, conexões lazy, script descartável [P]

**What**: `bullmq` e `ioredis` (versões estáveis ≥ 2 semanas) em `api/package.json`. `redisConnections.ts`: `redisCommand()`,
`redisSubscriber()`, `bullConnection()` criados só na 1ª chamada (`maxRetriesPerRequest: null` no BullMQ), `closeAllRedis()`
idempotente; lança se `!usesRedis(currentRole())`. Script `redis-descartavel.sh` (docker `redis:7`, porta livre, imprime URL), no padrão do de Postgres.
**Where**: `api/package.json` (+ lockfile), `shared/redis/redisConnections.ts` (+ `.test.ts`), `api/scripts/redis-descartavel.sh`
**Depends on**: —
**Requirement**: WROLE-01
**Done when**:
- [ ] Importar o módulo não abre conexão (teste com ioredis mockado)
- [ ] Em `all` qualquer getter lança; `closeAllRedis()` sem conexão é no-op
**Tests**: unit
**Gate**: quick
**Commit**: `build(api): bullmq e ioredis com conexões lazy por papel`

### T4: Erro interno ↔ formato de fio [P]

**What**: `toWireError(err)` → `{ code, message, meta? }` (só `AppError`; outro erro vira `ENGINE_TEMPORARILY_UNAVAILABLE`
sem mensagem crua) e `fromWireError(w)` → mesma classe por `code` (registro das classes de `shared/errors/internal/SessionErrors.ts`,
`MessagingErrors.ts`, `MediaErrors.ts`, `TelegramErrors.ts`, `GroupErrors.ts`), desconhecido → `ENGINE_TEMPORARILY_UNAVAILABLE`.
Inclui `SessionNotOwnedError` (interno, nunca sai em HTTP: o adapter remoto o consome).
**Where**: `messaging/infrastructure/remote/engineErrorWire.ts` (+ `.test.ts`), `shared/errors/internal/SessionErrors.ts`
**Depends on**: —
**Requirement**: WROLE-10
**Done when**:
- [ ] Ida e volta preserva classe, `code`, `statusCode` e `meta` de cada erro registrado
- [ ] `Error` cru não vaza `message` nem stack
**Tests**: unit
**Gate**: quick
**Commit**: `feat(messaging): erro da engine atravessa processo sem vazar erro cru`

### T5: `findLiveOwner` no repositório de lease [P]

**What**: `findLiveOwner(sessionId): Promise<string | null>` = `ownerWorkerId` se `leaseUntil > now() AT TIME ZONE 'UTC'`, senão null.
**Where**: `sessions/domain/contracts/ISessionLeaseRepository.ts`, `sessions/infrastructure/repositories/PrismaSessionLeaseRepository.ts` (+ `.int.test.ts`)
**Depends on**: —
**Requirement**: WROLE-05
**Done when**:
- [ ] Lease vivo → id; vencido ou nulo → null; sessão inexistente → null
- [ ] Dublês existentes do contrato atualizados (no-op devolve null)
**Tests**: int
**Gate**: int
**Commit**: `feat(sessions): consulta do dono vivo da sessão`

### T6: `createOutboundMessageId` assíncrono [P]

**What**: contrato passa a `Promise<string>` (no `http` precisa do socket do dono, RPC). Baileys/Telegram/router viram `async`;
os 4 chamadores fazem `await`. Mecânica, sem regra nova (exceção ao limite de 3 arquivos, D4).
**Where**: `messaging/domain/contracts/IMessagingEngine.ts`, `messaging/infrastructure/MessagingEngineRouter.ts`, `engines/baileys/BaileysMessagingEngineAdapter.ts:376`, `engines/telegram/TelegramMessagingEngineAdapter.ts:645`, `chat/application/use-cases/{SendMediaMessage,SendStoredMediaMessage,RetryOutboundMedia}UseCase.ts`, `campaigns/application/use-cases/ProcessDueOfferDispatchesUseCase.ts` + dublês nos testes
**Depends on**: —
**Requirement**: WROLE-07
**Done when**:
- [ ] Id ainda é gerado antes de gravar `PENDING` (ordem de `docs/chat-midias-anexos.md` mantida)
- [ ] Testes de chat, campaigns e messaging verdes
**Tests**: unit (existentes)
**Gate**: quick
**Commit**: `refactor(messaging): id de mensagem de saída assíncrono`

### T7: Plano de chamadas da engine + codec + portas

**What**: `engineCallPlan.ts` (puro): todo método de `IMessagingEngine` → `local` (`createSession`: só emite `SESSION_CREATED` local),
`rpc` (QR, pairing, status, grupos, convite, resumo, foto, `checkNumberExists`, reação, leitura, presença, `updateChatState`,
`submitLoginCode/Password`, `createOutboundMessageId`), `command` (`disconnect`, `logout`, `sendText`, `sendMedia`), `open`
(`connect`, `reconnect`, `requestPairingCode`, `requestLoginCode`); teste falha se método novo do contrato não estiver no mapa.
`engineCallCodec.ts`: JSON com `Buffer` (base64) e `Date`. Portas `IEngineRpcClient.call(workerId, call)`,
`IEngineCommandProducer.send(target: workerId | 'open', call, timeoutMs)`, `IEngineCallHandler`.
**Where**: `messaging/infrastructure/remote/engineCallPlan.ts`, `messaging/infrastructure/remote/engineCallCodec.ts`, `messaging/infrastructure/remote/ports.ts` (+ testes)
**Depends on**: T6
**Requirement**: WROLE-06, WROLE-07, WROLE-08, WROLE-11
**Done when**:
- [ ] Cobertura total dos métodos verificada em teste; ida e volta do codec com `OutboundLinkPreview`
**Tests**: unit
**Gate**: quick
**Commit**: `feat(messaging): plano de roteamento das chamadas da engine entre processos`

### T8: Transporte RPC no Redis [P]

**What**: `RedisEngineRpcClient` (implementa `IEngineRpcClient`): `PUBLISH engine-rpc:{workerId}` com `{id, replyTo, call}`,
canal de resposta único por processo, mapa de pendentes, timeout 10 s → `EngineNotReadyError`, ninguém assinando
(`PUBLISH` = 0) → `EngineNotReadyError` na hora. `RedisEngineRpcServer`: assina o próprio canal, chama `IEngineCallHandler`,
responde com resultado ou `toWireError`.
**Where**: `messaging/infrastructure/remote/transport/RedisEngineRpc.ts` (+ `.int.test.ts`)
**Depends on**: T3, T7
**Requirement**: WROLE-07, WROLE-10
**Done when**:
- [ ] Redis real: ida e volta, erro tipado, timeout, servidor ausente; `close()` rejeita pendentes
**Tests**: int
**Gate**: int
**Commit**: `feat(messaging): RPC request/reply da engine sobre Redis`

### T9: Filas BullMQ de comando [P]

**What**: `BullEngineCommandQueues`: produtor (implementa `IEngineCommandProducer`) com filas `engine-cmd-{workerId}` e `session-open`,
`add` + `waitUntilFinished(queueEvents, timeoutMs)`; timeout com job ainda `waiting` → `job.remove()` + `EngineNotReadyError`
(envio não sai depois); `attempts: 1` (sem retry automático de envio). Consumidor `startConsumers(workerId, handler)` nas duas filas,
`concurrency` por env com default conservador, `close()` espera jobs ativos.
**Where**: `messaging/infrastructure/remote/transport/BullEngineCommandQueues.ts` (+ `.int.test.ts`)
**Depends on**: T3, T7
**Requirement**: WROLE-06, WROLE-08
**Done when**:
- [ ] Redis real: resultado volta; erro tipado volta; timeout remove job em espera; `session-open` consumido por 1 de 2 consumidores
**Tests**: int
**Gate**: int
**Commit**: `feat(messaging): filas de comando da engine em BullMQ`

### T10: `EngineCommandServer` (worker) [P]

**What**: implementa `IEngineCallHandler` sobre a engine local: chamadas `rpc`/`command` exigem sessão em
`listLocalSessionIds()` (senão `SessionNotOwnedError`); `open` executa direto (lease da E2 decide, `SessionLeaseHeldError` volta como erro);
depois de `disconnectSession`/`logoutSession` chama `ReleaseSessionLeaseUseCase` (WROLE-09). Sem regra de produto.
**Where**: `messaging/infrastructure/remote/EngineCommandServer.ts` (+ `.test.ts`)
**Depends on**: T4, T7
**Requirement**: WROLE-08, WROLE-09, WROLE-13
**Done when**:
- [ ] Sessão alheia → `SESSION_NOT_OWNED`; disconnect/logout soltam o lease mesmo se a engine lançar; `open` não checa posse
**Tests**: unit (engine e release dublês)
**Gate**: quick
**Commit**: `feat(messaging): servidor de comandos da engine no worker`

### T11: `RemoteMessagingEngineAdapter` (http) [P]

**What**: implementa `IMessagingEngine` + `enabledEngines` (da env, sem carregar engine). Por método segue `engineCallPlan`:
`rpc`/`command` → `findLiveOwner`; sem dono → `SessionNotConnectedError` (`getSessionStatus` sem dono → `DISCONNECTED`;
`submitLogin*` sem dono → `InvalidSessionStateError`); `open` → dono ou `'open'`. `SessionNotOwnedError` → re-resolve o dono 1 vez.
Não implementa `ISessionSocketControl`.
**Where**: `messaging/infrastructure/remote/RemoteMessagingEngineAdapter.ts` (+ `.test.ts`)
**Depends on**: T4, T5, T7
**Requirement**: WROLE-05, WROLE-06, WROLE-07, WROLE-08, WROLE-09
**Done when**:
- [ ] Cada classe do plano roteada certo (portas dublês); re-tentativa única em `SESSION_NOT_OWNED`; nenhum import de Baileys/GramJS
**Tests**: unit
**Gate**: quick
**Commit**: `feat(messaging): engine remota para o processo http`

### T12: Mídia de envio entre processos

**What**: `outboundMediaTransfer.ts` sobre `MediaFileStore` (S3): `stage(filePath)` → chave `outbound-tmp/{uuid}`; `fetch(key)` → arquivo
temporário local; `discard(key)`. Remote: `sendMediaMessage` faz `stage` e manda a chave (descarta se o envio falhar antes do worker).
Server: `fetch` → engine local → apaga tmp e chave em `finally`.
**Where**: `messaging/infrastructure/remote/outboundMediaTransfer.ts` (+ `.test.ts`), `RemoteMessagingEngineAdapter.ts`, `EngineCommandServer.ts`
**Depends on**: T10, T11
**Requirement**: WROLE-11
**Done when**:
- [ ] Teste com store dublê: chave criada, consumida e apagada em sucesso e em erro; arquivo local do http intocado
**Tests**: unit
**Gate**: quick
**Commit**: `feat(messaging): arquivo de envio de mídia via storage entre processos`

### T13: Fan-out de WS pelo Redis [P]

**What**: `ChatWebSocketPublisher` ganha `setRelay(relay)` opcional sem mudar `publish/subscribe`. `RedisChatEventRelay`:
modo `publish` (worker: `publish()` vira `PUBLISH tenant:{tenantId}`) e modo `deliver` (http: `PSUBSCRIBE tenant:*` → entrega
local). Sem relay = hoje. `pingAll` continua local.
**Where**: `chat/infrastructure/ws/ChatWebSocketPublisher.ts`, `chat/infrastructure/ws/RedisChatEventRelay.ts` (+ `.int.test.ts`)
**Depends on**: T3
**Requirement**: WROLE-12
**Done when**:
- [ ] Sem relay, teste existente do publisher igual; com Redis real, evento publicado num cliente chega ao WS do outro
**Tests**: unit + int
**Gate**: int
**Commit**: `feat(chat): eventos do painel entre processos por Redis pub/sub`

### T14: `FailOrphanPendingMedia` poupa lease vivo de outro processo [P]

**What**: `failPending` aceita `spareLiveLeaseOtherThan?: string` (exclui `PENDING` cuja sessão tem `leaseUntil > now()` e
`ownerWorkerId ≠ $me`). Config do use case ganha `workerId?`; `runBoot` passa o filtro quando presente; `runPeriodic` não (WROLE-14).
**Where**: `chat/application/use-cases/FailOrphanPendingMediaUseCase.ts` (+ teste), `chat/domain/contracts/IChatMessageRepository.ts`, `chat/infrastructure/repositories/PrismaChatMessageRepository.ts` (+ `.int.test.ts`)
**Depends on**: —
**Requirement**: WROLE-14
**Done when**:
- [ ] Sem `workerId` = consulta de hoje; com: lease vivo alheio poupado, próprio/vencido/nulo falhado; flag desligada continua sem escrita
**Tests**: unit + int
**Gate**: int
**Commit**: `fix(chat): recuperação de mídia no boot poupa sessão de outro processo`

### T15: Remover SSE `GET /chat/events` + `useChatSSE` [P]

**What**: rota SSE (`chat.routes.ts:~575-622`) e hook sem uso `app/src/hooks/useChatSSE.ts` removidos (§3.4: WS cobre; em `http` o
SSE nunca receberia `MESSAGE_RECEIVED`). Conferir que nada no `app/` e `extension/` referencia `chat/events`.
**Where**: `chat/presentation/routes/chat.routes.ts`, `app/src/hooks/useChatSSE.ts`
**Depends on**: —
**Requirement**: WROLE-16
**Done when**:
- [ ] `grep chat/events` vazio em `app/src`, `extension/src`, `api/src`; `tsc --noEmit` em `api/` e `app/`
**Tests**: none (remoção)
**Gate**: quick + `pnpm -C app tsc --noEmit`
**Commit**: `refactor(chat): remove SSE de eventos substituído pelo WebSocket`

### T16: Tabela de jobs por papel + gate no `server.ts`

**What**: `processJobs.ts` puro: `jobsFor(role)` → conjunto de `uploadSweeper | interruptedUploads | pendingMediaBoot | pendingMediaSweep |
offerDispatch | hubOutbox | extensionRetention | billingReconcile | linkRotationSync | sessionBootstrap | sessionReconciler | leaseKeeper`
(tabela §3.3; flags de cada job continuam valendo). `server.ts` envolve cada bloco existente com `jobs.has(...)`, sem mover nada.
**Where**: `app/processJobs.ts` (+ `.test.ts`), `app/server.ts`
**Depends on**: T1
**Requirement**: WROLE-03
**Done when**:
- [ ] Teste: `all` = todos os 12; `http` ∩ `worker` = ∅; `http` ∪ `worker` = `all`
- [ ] Com `PROCESS_ROLE` ausente o `server.ts` executa os mesmos blocos na mesma ordem (diff só de `if`)
**Tests**: unit
**Gate**: quick
**Commit**: `feat(api): jobs de boot por papel do processo`

### T17: Fastify mínimo do worker + `/health` com papel [P]

**What**: `buildWorkerApp(probe)` com só `GET /health` (sem auth, helmet/cors/rotas): `{status, role, workerId, localSessions,
redis: ok|down, database: ok|down}`; 503 se banco ou Redis caírem. `/health` de `routes.ts` acrescenta `role` (aditivo).
**Where**: `app/workerApp.ts` (+ `.test.ts` com `inject`), `app/routes.ts`
**Depends on**: T1, T3
**Requirement**: WROLE-04
**Done when**:
- [ ] `inject` cobre ok e 503; resposta do `/health` atual só ganha `role`
**Tests**: unit
**Gate**: quick
**Commit**: `feat(api): health do worker em Fastify mínimo`

### T18: Composição por papel

**What**: `composeForRole(role)` → `{ engine, stop() }`. `all`: `localEngine()`, nada de Redis. `worker`: `localEngine()` +
`EngineCommandServer` ligado ao `RedisEngineRpcServer` e aos consumidores BullMQ + relay WS em `publish`.
`http`: `RemoteMessagingEngineAdapter` (`setActiveEngine`) + relay em `deliver`. `stop()` fecha consumidores e servidor RPC
(não fecha sockets nem Redis; isso é do shutdown).
**Where**: `app/roleComposition.ts` (+ `.test.ts`)
**Depends on**: T2, T8, T9, T10, T11, T12, T13
**Requirement**: WROLE-02, WROLE-05, WROLE-12
**Done when**:
- [ ] Teste: `all` não toca `redisConnections` nem módulos remotos; `http` não chama `localEngine()`
**Tests**: unit (módulos mockados)
**Gate**: quick
**Commit**: `feat(api): composição de engine e eventos por papel`

### T19: `server.ts`: boot e shutdown por papel

**What**: `worker` usa `buildWorkerApp`, demais `buildApp`; chama `composeForRole`. Listeners: chat e `TenantSuspendedSessionListener` em
todo papel (engine = a do papel, WROLE-13); `GroupMonitoringMessageListener` só onde há sessões. `FailOrphanPendingMedia` recebe
`workerId`. Shutdown conforme WROLE-15; `all` byte a byte na ordem atual (inclusive o drain de mídia antes dos sockets, até E4).
**Where**: `app/server.ts`
**Depends on**: T14, T16, T17, T18
**Requirement**: WROLE-03, WROLE-13, WROLE-14, WROLE-15
**Done when**:
- [ ] `all`: log de boot/shutdown igual ao de hoje (comparado no smoke T20)
- [ ] `worker`: drain da fila de mídia antes de `closeAllSockets` (ofertas enviam pela fila no worker)
**Tests**: smoke (T20)
**Gate**: quick
**Commit**: `feat(api): boot e shutdown por papel do processo`

### T20: Smoke `all` e `http`+`worker`

**What**: roteiro dos critérios de aceite da spec com Postgres e Redis descartáveis e S3 local (MinIO), env sintético fora de `api/`.
Sessão de teste real só se o dono autorizar; senão, Telegram/Baileys mockados não valem como smoke (registrar como pendência).
**Where**: notas de execução deste arquivo (sem código)
**Depends on**: T19
**Requirement**: todos
**Done when**:
- [ ] Os 4 critérios da spec registrados com resultado; diferença de log em `all` = nenhuma
**Tests**: smoke
**Gate**: `pnpm vitest run` + `pnpm tsc --noEmit` completos
**Commit**: `docs(sessions): smoke da separação http × worker`

### T21: Docs, CHANGELOG e versão

**What**: `docs/arquitetura-escala.md` (§3.3: fila por worker + `session-open` em vez de fila por sessão, RPC; dono de cada job;
drain de mídia também no worker; §3.4 eco local; §5.1 env dos serviços `http`/`worker` + Key Value), `docs/plano-lancamento-hub-copysync.md`
(E3 ✅), `docs/sessoes-conexao.md` (503 quando o worker não responde), `CHANGELOG.md`, `api/package.json` → 0.60.0 (0.59.0 é a E2) e
`app/package.json` patch (remoção do hook), AGENTS.md: uma linha "engine só via `getActiveEngine()`; em `http` é remota; `all` sem Redis".
**Where**: arquivos acima
**Depends on**: T20
**Requirement**: todos
**Done when**:
- [ ] Doc diz o que não fazer: chamar engine local no `http`, pub/sub para comando que precisa de entrega, `PROCESS_ROLE` na Render antes da E4
**Tests**: none
**Gate**: `pnpm tsc --noEmit`
**Commit**: `docs(sessions): separação http × worker (E3) e versão 0.60.0`

---

## Decisões para o dono

| # | Decisão (proposta) | Alternativa | Por quê |
| --- | --- | --- | --- |
| D1 | Redis só para `http`/`worker`; `all` ignora `REDIS_URL` | `all` usar Redis se houver URL | garante "default não muda nada"; Render Key Value (~US$ 10) só quando separar |
| D2 | Fila por **worker** (`engine-cmd-{id}`) + `session-open` compartilhada | fila por `sessionId` (doc §3.3) | cada fila BullMQ consumida custa 1 conexão bloqueante: 140 sessões = 140 conexões por worker. Muda o doc em T21 |
| D3 | Sessão sem dono: comando de abrir vai à `session-open` (qualquer worker, lease decide) | esperar adoção 15 s (doc §3.3) | adoção por tick é E4; sem isso `http`+`worker` não conecta nada na E3. E4 acrescenta o teto (worker cheio não consome) |
| D4 | `createOutboundMessageId` vira `Promise` (T6, 8 arquivos mecânicos) | gerar id no http sem Baileys | o id do Baileys usa o `user.id` do socket; id genérico arrisca o reconhecimento do eco |
| D5 | `http` fica em **1 réplica** na E3 | N réplicas já | uploads em partes em disco local e `InMemoryReactionSendThrottle` são por processo; N `http` exige upload em objeto + throttle em Redis (item próprio) |
| D6 | Eco continua em memória | eco em Redis (doc §3.4) | envio e eco acontecem no mesmo processo dono |
| D7 | SSE removido (T15) | manter e ligar ao Redis | sem uso no painel; doc §3.4 já decidiu remover |
| D8 | Worker também drena a fila de mídia, antes dos sockets | drain só no `http` (doc §3.3) | `OfferDispatchWorker` envia imagem pela mesma fila no worker; sem drain o boot do `http` não falharia (lease vivo, T14) mas o envio morreria no meio |
| D9 | `http`/`worker` exigem `MEDIA_STORAGE_DRIVER=s3` | permitir disco | arquivo do http não existe no worker; disco na Render já impede 2 serviços |
| D10 | Health do worker na `PORT`; sem tabela de heartbeat | `WORKER_HEALTH_PORT` | Private Service usa `PORT`; heartbeat é E4 |
| D11 | Envio sem retry automático (`attempts: 1`) | retry do BullMQ | retry duplica mensagem no grupo; quem decide reenvio é o fluxo de produto |

## Riscos para produção (1 instância hoje, `all`)

| Risco | Mitigação |
| --- | --- |
| T2 muda o momento em que a engine nasce (efeito de import → chamada) e `server.ts:285` lê `getActiveEngine()` | `localEngine()` chamado no mesmo ponto do `session.routes.ts`; teste de identidade; smoke T20 compara log |
| T3 importa `bullmq`/`ioredis` e alguém abre conexão em `all` | getters lançam fora de `http`/`worker`; T18 testa que `all` não toca Redis |
| T1 `superRefine` derruba o boot da Render | validação só dispara com `PROCESS_ROLE` definido; Render não define até E4 |
| T6 contrato async esquece um `await` (id vira `[object Promise]`) | `tsc` pega uso como `string`; testes de chat/ofertas verificam id gravado |
| T14 muda o boot da recuperação de mídia | só com `workerId` passado e flag `MEDIA_PENDING_RECOVERY_ENABLED`; na Render de 1 instância com disco não há sobreposição, então o resultado é o mesmo |
| T15 remove rota pública | sem consumidor (grep); WS cobre `MESSAGE_RECEIVED` |
| T16/T19 reordenam o `server.ts` | T16 só envolve blocos em `if`; T19 exige log de `all` idêntico |
| Deploy com `PROCESS_ROLE` ligado sem Key Value/R2 | validação de T1 falha o boot (Render mantém a versão anterior); doc T21 proíbe ligar antes da E4 |
| Separar papéis com 1 worker sem E4: worker morto = nada conecta até subir de novo | aceito: produção segue em `all` até E4 |

---

## Diagram-Definition Cross-Check

| Task | Depends on (corpo) | Diagrama | Status |
| --- | --- | --- | --- |
| T1–T6, T14, T15 | — | Fase 1 | ✅ |
| T7 | T6 | T6 → T7 | ✅ |
| T8, T9 | T3, T7 | T3,T7 → T8/T9 | ✅ |
| T10 | T4, T7 | T4,T7 → T10 | ✅ |
| T11 | T4, T5, T7 | T4,T5,T7 → T11 | ✅ |
| T12 | T10, T11 | T10,T11 → T12 | ✅ |
| T13 | T3 | T3 → T13 | ✅ |
| T16 | T1 | T1 → T16 | ✅ |
| T17 | T1, T3 | T1,T3 → T17 | ✅ |
| T18 | T2, T8–T13 | Fase 5 | ✅ |
| T19 | T14, T16, T17, T18 | Fase 6 | ✅ |
| T20, T21 | T19, T20 | Fase 6 | ✅ |

[P] sem arquivo em comum na mesma fase: Fase 1 (T1–T6, T14, T15; T6 não toca `env.ts`, `session.routes.ts` nem `chat.routes.ts`),
Fase 3 (T8/T9/T10/T11 em arquivos novos distintos).

## Test Co-location Validation

| Task | Camada | Matriz (`.specs/codebase/TESTING.md`) | Task | Status |
| --- | --- | --- | --- | --- |
| T1, T4, T7, T16 | função pura / config | unit | unit | ✅ |
| T2, T3, T17, T18 | composição / infra | nenhum | unit leve | ✅ acima do mínimo |
| T5, T14 | repositório Prisma (SQL cru) | nenhum | int | ✅ acima do mínimo |
| T6, T10, T11, T12 | engine / adapter | unit na parte pura | unit com dublês | ✅ |
| T8, T9, T13 | transporte Redis | nenhum | int (Redis descartável) | ✅ |
| T15, T21 | remoção / docs | nenhum | none | ✅ |
| T19, T20 | `server.ts` / smoke | nenhum | smoke | ✅ |

## Notas de execução

- T1: `parseEnv(source)` puro em `env.ts`; `processRole.ts` (`currentRole`, `runsSessions`, `runsHttp`, `usesRedis`). Validação de `PROCESS_ROLE` só com a env definida.
- T2: `localEngine()` (lazy, idempotente) em `messaging/infrastructure/localEngineContainer.ts`; `session.routes.ts` chama no nível do módulo (mesma ordem de antes).
- T3: bullmq 6.3.19 + ioredis 5.11.1; `redisConnections.ts` recebe papel/URL por `bindRedisAccess({ enabled, url, onError })` — **T17/T18 precisam chamar** `bindRedisAccess({ enabled: () => usesRedis(currentRole()), url: () => env.REDIS_URL, ... })`; sem isso todo getter lança (= `all`). `scripts/redis-descartavel.sh` (porta ≥ 56379 ou `REDIS_INT_PORT`).
- T4: fio de erro `{ code, message, statusCode, meta?, name?, fields? }` (`name` desempata `SessionLeaseHeldError`); `SessionNotOwnedError` (409, interno).
- T5: `findLiveOwner(sessionId)` não filtra `deletedAt` (lease vence sozinho).
- T6: `createOutboundMessageId` async; router usa só cache (`resolveSync`), T7/T11 decidem `resolve`.
- T13: `ChatEventRelay` + `RedisChatEventRelay` (publish/deliver); ligar por papel na T18. Int pula sem `INTEGRATION_REDIS_URL`.
- T14: `FailOrphanPendingMedia` aceita `workerId` (boot); **ligar `workerId` no server.ts na T19**.
- T15: SSE removido (api + `app/src/hooks/useChatSSE.ts`); `docs/arquitetura-escala.md:249` atualizar na T21; **app precisa bump de versão na T21**.
- T16: `jobsFor(role)` em `app/processJobs.ts`; em `all` logs iguais.
- T17: `buildWorkerApp(probe)` em `app/workerApp.ts`; `/health` ganhou `role`.
- Gate integrado após onda 2: api tsc ok, vitest completo 2848/2848; app tsc ok.
- T8: `RedisEngineRpc` (canais `engine-rpc:{workerId}` / `engine-rpc-reply:{processId}`; clientes injetados, fechados por `closeAllRedis`).
- T9: `BullEngineCommandQueues` (`concurrency` padrão 2 — T18 passa do env; `deadline` por job; `workerId` sem `:`).
- T10: `EngineCommandServer` (rpc/command sem socket local → `SessionNotOwnedError`; disconnect/logout soltam lease em `finally`).
- T11: `RemoteMessagingEngineAdapter` (sem dono: alguns métodos devolvem `null`/no-op como a engine local; validar).
- Int tests só de Redis ainda exigem `INTEGRATION_DATABASE_URL` (setup.int.ts).
- T12: `OutboundMediaTransfer` (chave `outbound-tmp/{uuid}.ext`) + `S3OutboundObjectStore`; **T18 constrói `new OutboundMediaTransfer(new S3OutboundObjectStore(cfg))` e passa ao adapter remoto e ao `EngineCommandServer` (4º arg)**.
- T18: `composeForRole(role)` async `{ engine, stop() }`; `all` só carrega `localEngineContainer`; http/worker exigem `S3_ENABLED` e chamam `bindRedisAccess`. **Boot deve chamar `composeForRole` antes de `buildApp` (T18b/T19).**
- T18b: rotas e adoção leem `getActiveEngine()`; `server.start()` faz `await composeForRole(currentRole())` antes de `buildApp`; env `ENGINE_COMMAND_CONCURRENCY` (default 2). **T19 liga `composition.stop()` no shutdown**; smoke T20 confere `all` idêntico.
- T19: boot/shutdown por papel em `server.ts` (worker usa `buildWorkerApp`; `composition.stop()` no shutdown; `closeAllRedis` fora de `all`; `flushAllAuthStates` por import dinâmico; worker drena mídia antes dos sockets). Em `all`, recuperação de mídia do boot passa a filtrar por lease (só com `MEDIA_PENDING_RECOVERY_ENABLED`).
