# Separação HTTP × worker (escala E3) — Spec

**Fonte:** [`docs/arquitetura-escala.md`](../../../docs/arquitetura-escala.md) §3.1 (lease), §3.3 (papéis, tabela
"dono por job", BullMQ, RPC síncrono), §3.4 (fan-out Redis, SSE), §4 fase 3, §5.1 (Private Service);
[`docs/plano-lancamento-hub-copysync.md`](../../../docs/plano-lancamento-hub-copysync.md) linhas E3/E4; E2 em
[`../session-lease/`](../session-lease/spec.md) (D7: filtro de lease no `FailOrphanPendingMediaUseCase` vem para cá).
**Tamanho:** Large (boot, contrato da engine, transporte novo, Redis). Design inline; tarefas em `tasks.md`.

## Problema

`server.ts` sobe `listen`, engine, listeners e todos os jobs em qualquer processo. Engine nasce como efeito
colateral de `session.routes.ts`. Rotas chamam a engine em memória (`getActiveEngine()`), WS é um `Map` local
(`ChatWebSocketPublisher`) e `TENANT_SUSPENDED` (webhook/super-admin, no HTTP) chega ao listener que fecha socket
pelo `EventEmitter` do mesmo processo. Com HTTP e sockets em processos diferentes nada disso funciona.

## Objetivo

Mesma imagem, três papéis por `PROCESS_ROLE`. `all` (default) é **exatamente** o comportamento de hoje, sem
Redis. `http` e `worker` funcionam juntos com Redis (BullMQ + pub/sub) e mídia em objeto. Produção segue em
`all` até a E4.

## Requisitos

| ID | Requisito |
| --- | --- |
| WROLE-01 | `PROCESS_ROLE=http\|worker\|all` (default `all`) e `REDIS_URL` opcional em `env.ts`. `http`/`worker` exigem `REDIS_URL` e `MEDIA_STORAGE_DRIVER=s3` (boot falha com mensagem). `all` nunca abre conexão Redis, mesmo com `REDIS_URL` |
| WROLE-02 | Engine local montada fora de `session.routes.ts` (container lazy). `http` não instancia engine local nem carrega Baileys/GramJS |
| WROLE-03 | Jobs de boot por papel conforme §3.3: `http` = sweeper de upload, `ReconcileInterruptedUploads`, `failOrphanPendingMedia` (boot + periódico); `worker` = `OfferDispatchWorker`, `HubOutboxWorker`, `ExtensionRetentionJob`, reconcile de billing, rodízio de links, bootstrap/reconciler de sessões, keeper do lease; `all` = todos, ordem de hoje |
| WROLE-04 | `worker` sobe Fastify só com `GET /health` na `PORT` (Private Service da Render): `role`, `workerId`, sessões locais, Redis e banco ok/falha. `/health` do `http`/`all` ganha `role` |
| WROLE-05 | Em `http`, `getActiveEngine()` devolve `RemoteMessagingEngineAdapter` (implementa `IMessagingEngine`); dono resolvido por `ownerWorkerId` com lease vivo |
| WROLE-06 | Comandos duráveis por BullMQ (`disconnect`, `logout`, `sendTextMessage`, `sendMediaMessage`) na fila do dono; quem chama espera o resultado (timeout → `ENGINE_NOT_READY`; job ainda em espera é removido para não enviar depois) |
| WROLE-07 | Chamadas que dependem da memória do dono (QR, pairing, status, grupos, reações, leitura, presença, `submitLoginCode/Password`, `createOutboundMessageId`) por RPC request/reply no Redis, timeout 10 s → `ENGINE_NOT_READY` |
| WROLE-08 | Abrir socket sem dono vivo (`connect`, `reconnect`, `requestPairingCode`, `requestLoginCode`) vai à fila compartilhada `session-open`: qualquer worker consome e o lease da E2 (`ISessionLeaseGate`) decide; com dono vivo vai ao dono |
| WROLE-09 | Worker recusa chamada de sessão que não é dele (`SESSION_NOT_OWNED`, interno); o adapter remoto re-resolve o dono uma vez. Após `disconnect`/`logout` o worker solta o lease (o `release` chamado no HTTP é no-op por não ser dono) |
| WROLE-10 | Erros da engine atravessam o processo como `{code, message, meta}` e voltam como a mesma classe interna (`shared/errors/internal`); código desconhecido → `ENGINE_TEMPORARILY_UNAVAILABLE`. Nunca erro cru |
| WROLE-11 | Mídia entre processos: no `http`, o `filePath` local do envio vira objeto temporário no storage; o worker baixa, envia e apaga os dois. `Buffer` (prévia de link) vai em base64 |
| WROLE-12 | `ChatWebSocketPublisher` mantém o contrato; em `worker` publica em `tenant:{tenantId}` no Redis, em `http` assina `tenant:*` e entrega aos WS locais; em `all` direto como hoje |
| WROLE-13 | `TENANT_SUSPENDED` funciona entre processos sem pub/sub: listener registrado em todo papel; no `http` a engine remota leva o `disconnect` ao dono por BullMQ (durável) |
| WROLE-14 | `FailOrphanPendingMediaUseCase.runBoot` poupa `PENDING` de sessão com lease vivo de outro processo (D7 da E2); `runPeriodic` sem esse filtro (`MEDIA_PENDING_STALE_MINUTES` cobre o órfão) |
| WROLE-15 | Shutdown por papel. `all`: idêntico a hoje. `http`: jobs → drain da fila de mídia → fecha Redis → `app.close()`. `worker`: keeper → jobs → consumidores BullMQ/RPC → drain da fila de mídia (ofertas) → `closeAllSockets` → flush → `releaseAllOwned` → Redis → `app.close()` |
| WROLE-16 | SSE `GET /chat/events` e `useChatSSE` removidos (§3.4; sem uso no painel) |

## Fora do escopo (fronteira com E4/E5)

- **E4:** `WORKER_ADOPTION_ENABLED`, `WORKER_MAX_SESSIONS` (worker cheio deixa de consumir `session-open`), tick de
  adoção, `nextAdoptAt`/`adoptFailures`, `WORKER_SHARD`, heartbeat (`worker_heartbeats`), alerta 80 %, "aguardando
  capacidade", inverter mídia × flush no shutdown, N réplicas `worker` em produção.
- **Depois:** N réplicas `http` (uploads em partes em disco local e `InMemoryReactionSendThrottle` exigem 1 réplica;
  ver D5), filas de produto (E5), `render.yaml` com os serviços.
- Registro de eco em Redis: desnecessário, o envio sempre roda no dono (D6).

## Design inline

| Peça | Onde | Papel |
| --- | --- | --- |
| `processRole` | `shared/config/processRole.ts` | `currentRole()`, `runsSessions(role)`, `runsHttp(role)` puras |
| `localEngineContainer` | `messaging/infrastructure/localEngineContainer.ts` | `createRouter` + `bindSocketControl` + `setActiveEngine` (sai de `session.routes.ts`) |
| `redisConnections` | `shared/redis/redisConnections.ts` | clientes ioredis lazy (comando, assinante, BullMQ) + `closeAll()` |
| `engineCallPlan` + portas | `messaging/infrastructure/remote/` | método → `local \| rpc \| command \| open`; codec JSON (Buffer, Date); portas `IEngineRpcClient`, `IEngineCommandProducer` |
| `engineErrorWire` | `messaging/infrastructure/remote/` | erro interno ↔ `{code,message,meta}` |
| `RedisEngineRpc` / `BullEngineCommandQueues` | `messaging/infrastructure/remote/transport/` | transporte; canal `engine-rpc:{workerId}`, filas `engine-cmd-{workerId}` e `session-open` |
| `EngineCommandServer` | `messaging/infrastructure/remote/` | worker: valida posse, executa na engine local, solta lease após disconnect/logout |
| `RemoteMessagingEngineAdapter` | `messaging/infrastructure/remote/` | http: `IMessagingEngine` remoto |
| `RedisChatEventRelay` | `chat/infrastructure/ws/` | fan-out de WS entre processos |
| `processJobs` | `app/processJobs.ts` | tabela de jobs por papel (pura, testada) |
| `workerApp` / `roleComposition` | `app/` | Fastify mínimo do worker; composição de engine/relay por papel |

## Critérios de aceite (smoke, depois de T19)

1. `all` sem `REDIS_URL`: mesmo log de boot e shutdown de hoje; nenhuma conexão Redis.
2. `http` + `worker` (Postgres e Redis descartáveis, S3 local/MinIO): conectar por QR e por código, enviar texto e
   mídia pelo painel, receber mensagem no WS, listar grupos, suspender tenant → socket fecha no worker.
3. Matar o worker: chamadas RPC viram 503 `ENGINE_NOT_READY` em ≤ 10 s; comandos de envio respondem no timeout do comando (texto 60 s, mídia 300 s — decisão do dono 2026-11-04); nenhum envio sai depois do timeout.
4. `SIGTERM` no worker: sockets → flush → leases soltos; novo worker conecta pela `session-open`.

## Decisões

Ver `tasks.md`, seção "Decisões para o dono".
