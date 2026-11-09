# Estratégia de escala — CopySync

Fonte de verdade de **como** a plataforma cresce de 1 instância para milhares de sessões
WhatsApp sem reescrever a arquitetura. Complementa [`../AGENTS.md`](../AGENTS.md) (regras de
código) e [`produto-roadmap.md`](produto-roadmap.md) (o que é vendido). Atualizado em 2026-11-04 (E2 api 0.59.0; E3 e E4 em código na api 0.62.0, produção em `all` com adoção desligada).

Meta de dimensionamento: **3.000 sessões Baileys** como teto (1.000 tenants × até 3 números).
Pelos planos reais ([roadmap, "Carga por plano"](produto-roadmap.md)), 1.000 tenants no mix
50/35/15 dão **~1.150 sessões WhatsApp + 650 Telegram**, ~300 mil posts/dia concentrados nas
janelas agendadas. Telegram (Bot API) custa uma fração de uma sessão Baileys. Logo, para 1.000
tenants a Fase A/B (AX42) basta; o teto de 3.000 só chega perto de 2.500 tenants.

---

## 1. Diagnóstico: por que hoje só roda com 1 instância

Nada no desenho amarra tenant a instância de propósito. O acoplamento é acidental: todo estado
operacional vive na memória do processo Node.

| Componente | Onde | O que quebra com 2+ processos |
|---|---|---|
| Socket Baileys | `messaging/infrastructure/engines/baileys/BaileysSessionRegistry.ts` | Request cai no processo sem o socket → `SessionNotConnectedError`; QR só existe onde o socket abriu |
| Dono da sessão | `prisma/schema.prisma` (`Session`) | **Resolvido na E2**: lease `ownerWorkerId`/`leaseUntil` (3.1). Antes, N processos abriam N sockets (440) |
| Auth state | `sessions/infrastructure/repositories/PrismaSessionAuthStateRepository.ts` | **Resolvido na E2** (Baileys): CAS por `version` em `writeKeys`. Telegram segue sem CAS (lease basta) |
| WS / SSE do painel | `chat/infrastructure/ws/ChatWebSocketPublisher.ts`, `GET /events` | Evento nasce num processo e só chega aos clientes conectados nele |
| Event bus, fila de mídia, throttle | `shared/events/InternalEventBus.ts`, `chat/infrastructure/queue/InMemoryOutboundMediaQueue.ts` | `EventEmitter` e fila in-memory; perdem tudo no restart |
| Mídia | `shared/storage/MediaStorage.ts`, `media/infrastructure/uploads/DiskUploadSessionStore.ts` | Disco local. Arquivo de um processo não é servido por outro; partes de um upload podem cair em processos diferentes |
| Registro de eco | `chat/infrastructure/echo/OutboundEchoRegistry.ts` | Eco chega em outro processo → mensagem duplicada ou mídia baixada de novo |
| Reconciliadores de boot | `SessionStatusReconciler`, `FailOrphanPendingMediaUseCase.runBoot` | Marcam DISCONNECTED/FAILED sem saber se outro processo ainda cuida |

Pontos fortes que tornam a evolução barata: Baileys isolado no adapter, auth state já em
Postgres, paginação por cursor, upload em partes. Nada disso precisa mudar.

### Comparação com os legados e o mercado

| | legado1 (Whaticket) | legado2 (Evolution API v2) | CopySync hoje |
|---|---|---|---|
| Sessões | Map em memória, 1 processo | idem | idem |
| Auth state | Postgres | Postgres / Redis / arquivo | Postgres |
| Lock de dono | não | `DATABASE_CONNECTION_CLIENT_NAME` manual | não |
| Realtime | Socket.IO sem adapter | Socket.IO + webhooks | WS + SSE in-process |
| Fila | Bull + Redis | nenhuma | in-memory |
| Mídia | disco | S3 / MinIO | disco |
| Servidor alvo | VPS + PM2 + nginx | VPS Dokploy / Swarm nó único | Render 1c-2g |

Evolution, o padrão de mercado, chega a centenas de instâncias por nó e escala horizontal
**à mão**: outra instalação com outro `clientName`, e alguém decide qual cliente vai em qual.
O CopySync vai além disso com lease automático (seção 3).

---

## 2. Limites físicos

- **1 processo Node suporta ~150-300 sessões Baileys.** Single-thread: criptografia Signal,
  protobuf, mídia e gravação de auth state disputam o event loop. Acima disso o painel fica lento
  antes de faltar RAM.
- **RAM por sessão: 15-40 MB** (sem store em memória; auth em Postgres). 3.000 sessões =
  45-120 GB.
- **Postgres**: auth state com debounce de 750 ms × 3.000 sessões = centenas de writes/s em pico.
  Plano de 8 GB+ e pool pequeno por processo (`connection_limit=5` na `DATABASE_URL`) ou pooler.
- **Rede**: 3.000 números num único IP é padrão de spam. Acima de ~500 sessões, IPs adicionais
  ou proxy por tenant.

Os números acima são estimativas de experiência com Baileys. Antes de dimensionar compra de
servidor, medir `process.memoryUsage()` com 50, 100 e 200 sessões reais.

**Consequência:** "escalar em 1 instância" significa 1 máquina grande rodando 10-20 processos
worker. Isso exige exatamente o mesmo trabalho de código que multi-instância. Não há atalho.

---

## 3. Arquitetura alvo

```
app (static) ──► API HTTP + WS  (N réplicas, stateless)
                      │  BullMQ (comandos)   ▲ Redis pub/sub (eventos → WS)
                      ▼                      │
                 Workers Baileys  (M processos, cada um dono de até WORKER_MAX_SESSIONS sessões)
                      │
          Postgres (sessões, lease, auth state, mensagens)   S3/R2 (mídia)   Redis
```

### 3.1 Dono da sessão (lease)

**Feito na E2 (api 0.59.0)**, sem flag (D6: rollback = voltar versão; a migration
`20261104150000_add_session_lease` só adiciona colunas). Peças: `sessionLeasePolicy.ts` (60 s TTL,
renova a cada 20 s, fence 55 s, timeout 5 s, sem env), `PrismaSessionLeaseRepository`,
`SessionLeaseLedger`, `Acquire/Renew/ReleaseSessionLeaseUseCase`, `SessionLeaseKeeper`,
`ISessionSocketControl` (Baileys, Telegram, router), `sessionLeaseContainer`, `markConnectRequested`,
`WORKER_ID` (`shared/config/workerIdentity.ts`). Comportamento:

- Socket (Baileys `openSocket`, Telegram `openClient`) só abre com lease. Negado: rota do usuário
  recebe `ENGINE_TEMPORARILY_UNAVAILABLE` 503 (`SessionLeaseHeldError`) e o status do dono é
  restaurado; reconexão automática e bootstrap só logam, sem gravar status.
- Lease perdido na renovação ou fence vencido: `abortSession` derruba sem gravar status nem chave.
- CAS no Baileys: conflito de `version` descarta o pendente e derruba o socket.
- Shutdown: keeper → jobs → drain de mídia → `closeAllSockets()` → `flushAllAuthStates()` →
  `releaseAllOwned` (solta lease e marca `DISCONNECTED` as ativas, mantém `connectRequestedAt`) →
  `app.close()`. E4 manteve mídia antes dos sockets, com teto que reserva o fim ao flush (D4).
- **Religar após deploy depende de `connectRequestedAt`, não do status.** O shutdown deixa `DISCONNECTED`; quem
  religa precisa aceitar `DISCONNECTED` com pedido vivo: a adoção (E4) já aceita, e o bootstrap sem adoção
  (`findActiveSessionsForBootstrap`) passou a aceitar na api 0.66.1. Sem isso, todo deploy desconectava todas as
  sessões (incidente 2026-11-06). Não filtrar religação só por status ativo; não limpar `connectRequestedAt` no shutdown.
- Fechado depois: readoção pelo ticker da E4 (§3.2, com a flag); `FailOrphanPendingMediaUseCase.runBoot`
  poupa `PENDING` de sessão com lease vivo de outro processo (E3); `nextAdoptAt`/`adoptFailures` usados
  pela E4; `shard` só como filtro (ninguém grava).

Desenho original abaixo; onde diverge, vale o bloco acima.

Novos campos em `Session` (uma migration `add-session-lease`): `ownerWorkerId String?`,
`leaseUntil DateTime?`, `connectRequestedAt DateTime?`, `nextAdoptAt DateTime?`,
`adoptFailures Int @default(0)`, `shard String?`.

`connectRequestedAt` é o único sinal de "deve estar conectada". Hoje **nenhum** use case
grava ou limpa esse campo (não existe), então E2 inclui:

- grava: `ConnectSessionUseCase`, `ReconnectSessionUseCase`, `RequestSessionPairingCodeUseCase`
  e os três de login Telegram (`SessionLoginByCodeUseCases`: send-code, sign-in, password), por
  um helper único `markConnectRequested(sessionId)` chamado antes de falar com a engine;
- limpa (`null`, na mesma escrita do status, antes de chamar a engine): `DisconnectSessionUseCase`
  (hoje só grava `DISCONNECTED`), `LogoutSessionUseCase`, `DeleteSessionUseCase` e o
  `TenantSuspendedSessionListener` (suspensão de tenant).

- Adoção: `UPDATE sessions SET "ownerWorkerId"=$me, "leaseUntil"=now()+60s WHERE id=$id AND
  "deletedAt" IS NULL AND ("leaseUntil" IS NULL OR "leaseUntil" < now() OR "ownerWorkerId"=$me)`.
  Zero linhas = outro worker é dono. Horário sempre `now() AT TIME ZONE 'UTC'`.
- Renovação a cada 20 s, só das sessões com socket aberto neste processo, com
  `WHERE id = ANY($ids) AND "ownerWorkerId"=$me AND "leaseUntil" > now()`. Fence local: cada
  sessão guarda `lastRenewOkAt`; se `now() > lastRenewOkAt + 60 s − 5 s` por qualquer motivo
  (zero linhas, erro de banco, timeout), o worker **derruba o socket sem gravar auth state**
  antes de qualquer outra adoção. Sem isso dois workers abrem socket da mesma sessão (440 +
  chaves Signal corrompidas).
- `SessionStatusReconciler.markActiveSessionsAsDisconnected()` (só no boot com
  `SESSION_BOOTSTRAP_ON_STARTUP=false`) só toca sessões sem lease vivo (feito).
  `FailOrphanPendingMediaUseCase`: mesmo filtro, na E3.
- Deploy da Render (sobe nova instância antes de matar a antiga) deixa de gerar 440 em cadeia.
- Auth state: a escrita real é `PrismaSessionAuthStateRepository.writeKeys` (não `upsert`), que
  hoje faz `version+1` sem condição em `session_auth_states` (as chaves ficam em
  `session_auth_keys`, sem versão). Passa a `WHERE version = esperado` em `session_auth_states`
  na mesma transação das chaves; `findAllKeys` devolve a versão carregada. Conflito = log + descarta,
  nunca sobrescreve.

Use cases novos: `AcquireSessionLeaseUseCase`, `RenewSessionLeaseUseCase`,
`ReleaseSessionLeaseUseCase`. Repositório: `ISessionLeaseRepository` + `PrismaSessionLeaseRepository`.
`JobLease` (tabela `job_leases`, `expiresAt`) é outro mecanismo, para jobs singleton, não para sessão.

### 3.2 Adoção por capacidade (teto por worker)

**Feito na E4 (api 0.62.0), atrás de `WORKER_ADOPTION_ENABLED=false`** (desligada = E3 idêntica, nenhuma
escrita em `worker_heartbeats`). Spec: `.specs/features/session-adoption/`. Onde diverge do desenho abaixo:

- Teto no gate: `CapacityLimitedLeaseGate` nega `acquire` de sessão alheia com `ativas >= WORKER_MAX_SESSIONS`.
  **Só login concluído ocupa vaga (T24):** `ativas` = `listAuthenticatedSessionIds()` (Baileys `creds.registered`/
  `creds.me`; Telegram após `finishLogin`) + reservas de reabertura com credencial salva (`hasStoredCredentials`).
  Abertura sem credencial (QR/pareamento/código/senha) passa sem vaga, limitada por `WORKER_MAX_PENDING_LOGINS`.
  `listLocalSessionIds()` segue com todas (lease e renovação não mudam). Login concluído com o worker cheio
  **fica** (inclui o reinício do socket logo após o QR lido, janela de 60 s): o teto pode ser excedido
  temporariamente; ticker e `session-open` só param de adotar enquanto `autenticadas ≥ teto`. Vale para rota,
  `session-open`, bootstrap e ticker. Rota recebe 503 `ENGINE_TEMPORARILY_UNAVAILABLE`; o item da sessão traz `awaitingCapacity` e o
  painel mostra o chip "Aguardando capacidade".
- Tentativa conta **na adoção** (`adoptFailures+1` e `nextAdoptAt` no mesmo `UPDATE`, D1); zera no
  `SESSION_CONNECTED` e em pedido novo (`markConnectRequested`). 5 tentativas → `FAILED`, pedido nulo,
  auditoria `SESSION_DISCONNECTED` `reason: ADOPTION_EXHAUSTED`.
- Status adotáveis: `CONNECTED`, `CONNECTING`, `DISCONNECTED` e `AWAITING_*` com lease vencido (órfã de
  SIGKILL; a adoção reconecta e gera QR novo).
- `SessionAdoptionTicker`: 1 adoção por tick de 5 s (D2). Flag ligada + `SESSION_BOOTSTRAP_ON_STARTUP=true`
  = bootstrap delegado ao ticker (D8). Flag ligada **sem** bootstrap: o ticker reconecta quem tem pedido vivo.
- Worker cheio pausa o consumo de `session-open` (vigia 5 s; job pego na corrida volta atrasado).
- `WorkerHeartbeatJob` (20 s, tabela `worker_heartbeats`, apagada no shutdown) e `WorkerCapacityAlertJob`
  (`JobLease` `worker-capacity-alert`, 1 log `warn`/min no cluster). E-mail ao super-admin adiado (D5: sem
  template na central). `GET /admin/workers` (super-admin) + página `/admin/workers` no painel.
- `GET /admin/workers` devolve `adoptionEnabled` (`WORKER_ADOPTION_ENABLED`). Desligada: sem heartbeat, a resposta traz
  `processes` (leases vivos de `sessions.ownerWorkerId/leaseUntil` agrupados por processo, `PrismaSessionLeaseHolderRepository`)
  e `leasedSessions`, sem teto; a tela mostra aviso info, "Processos ativos", "Sessões conectadas · sem teto" e a lista
  dos processos. Leitura de plataforma, só super-admin, **sem `tenantId`** (o lease é do processo). Ligada: heartbeats
  como antes, sem consultar leases.
- Shutdown: drain de mídia **antes** dos sockets, com teto que reserva o fim para close+flush+release (D4).
- QR sem leitura não prende mais vaga (T24); ainda ocupa memória e um lugar em `WORKER_MAX_PENDING_LOGINS`.
  `worker_heartbeats.sessions` = autenticadas, `pendingLogins` = logins em andamento (`/admin/workers`
  mostra a coluna "Aguardando login").
- Pendentes do dono: heartbeat de worker morto só é limpo após 1 dia
  (`listAlive` já filtra 90 s); índice de candidatas (D7) não medido; "sem 440" na readoção só com sessão real.

Decisão 2026-11-04: **sem shard por hash**. Envs (todas em `env.ts` desde a E4):

| Env | Default | Função |
|---|---|---|
| `WORKER_ADOPTION_ENABLED` | `false` | liga a adoção. **Só na Render.** `api/.env` local aponta para produção: `pnpm dev` com isso ligado roubaria lease e reconectaria sessões reais |
| `WORKER_MAX_SESSIONS` | `40` | teto por processo = `0,7 × RAM ÷ MB por sessão` medido na Fase 0 (§2: 15–40 MB). A 40 MB: 2 GB → 35, 8 GB → 140, 16 GB → 280. Teto 200 exige medição ≤ 28 MB em 8 GB |
| `WORKER_MAX_PENDING_LOGINS` | `50` | teto separado de logins em andamento (QR/código sem leitura) por processo, só para proteger a memória; acima dele a abertura dá 503 como o teto de sessões |
| `WORKER_ID` | `${HOSTNAME ?? os.hostname()}-${pid}-${nonce8}` | identidade do dono, única por boot (restart no mesmo host não herda leases). `RENDER_INSTANCE_ID` não existe no código nem está confirmada; `HOSTNAME` não existe fora do Docker |
| `WORKER_SHARD` | vazio | worker com valor só adota `Session.shard = x`; sem valor só adota `"shard" IS NULL` (tenant dedicado fica isolado). Coluna entra na migração de E2, sem uso até existir tenant dedicado |

Adoção (tick de 5 s enquanto `ativas < WORKER_MAX_SESSIONS`; `ativas` = sessões com
`ownerWorkerId = $me` **e** socket aberto neste processo), uma linha por tick:

```sql
UPDATE sessions s SET "ownerWorkerId"=$me, "leaseUntil"=now()+interval '60 s'
WHERE s.id = (SELECT s2.id FROM sessions s2
  JOIN tenants t ON t.id = s2."tenantId" AND t.status = 'ACTIVE'
  WHERE s2."deletedAt" IS NULL AND s2."connectRequestedAt" IS NOT NULL
    AND s2.status IN ('CONNECTED','CONNECTING','DISCONNECTED')
    AND (s2."leaseUntil" IS NULL OR s2."leaseUntil" < now())
    AND (s2."nextAdoptAt" IS NULL OR s2."nextAdoptAt" < now())
    AND s2."shard" IS NOT DISTINCT FROM $shard
  ORDER BY s2."connectRequestedAt" LIMIT 1 FOR UPDATE SKIP LOCKED)
RETURNING s.id
```

Falha ao conectar depois de adotar (bootstrap e reconciler gravam `DISCONNECTED` com
`connectRequestedAt` vivo): `adoptFailures+1`, `nextAdoptAt = now() + min(2^n, 30) min`,
e após 5 falhas `FAILED` + `connectRequestedAt = null`. Sem isso a mesma sessão quebrada
seria readotada a cada minuto na frente das outras.

- Lista positiva de status: `PENDING` (rascunho nunca conectado), `AWAITING_QR/PAIRING/CODE/
  PASSWORD` (login em andamento, estado em memória do dono) e `LOGGED_OUT/FAILED` ficam fora.
  Sessão conta igual para WhatsApp e Telegram.
- `CreateSessionUseCase` só insere `PENDING`, não abre socket (como hoje). As rotas que pedem
  conexão (`connect`, `reconnect`, `pairing-code`, `telegram/send-code`, `telegram/sign-in`,
  `telegram/password`) gravam `connectRequestedAt`; o dono (ou o próximo worker com vaga) conecta. Sem vaga em
  nenhum worker, fica com `connectRequestedAt` e sem dono: painel mostra "aguardando
  capacidade" e isso é o sinal para subir réplica.
- `SESSION_BOOTSTRAP_ON_STARTUP=true` passa a usar o mesmo caminho de adoção (respeita o
  teto); o `SessionBootstrapService` atual conecta todas as ativas sem limite.
- Drain no `SIGTERM`, dentro dos 30 s da Render e **nesta ordem**: parar de adotar →
  `closeAllSockets()` awaited (passo novo; hoje não existe e `app.ts` não fecha a engine no
  `onClose`) → `flushAllAuthStates` (já existe) → um único
  `UPDATE sessions SET "ownerWorkerId"=NULL,"leaseUntil"=NULL WHERE "ownerWorkerId"=$me` →
  `app.close()`. Lease solto só depois do socket fechado, senão outro worker conecta com o
  antigo vivo. A ordem atual de `server.ts` (parar jobs → drain de mídia até 25 s → flush →
  close) muda: o drain de mídia é só do role `http` e, em `all`, vem **depois** do flush com
  teto `30 s − tempo gasto − 3 s`. Flush interrompido por SIGKILL perde chaves Signal
  (próximo dono reutiliza pre-key → bad MAC), então o flush tem prioridade sobre mídia.
- Heartbeat: tabela `worker_heartbeats` (`workerId`, `role`, `sessions`, `maxSessions`,
  `rssMb`, `seenAt`) atualizada a cada 20 s; super-admin lista workers e ocupação. Alerta
  (log `warn` + e-mail ao super-admin, sob `JobLease` `worker-capacity-alert`) quando a soma
  de sessões passa de 80% da soma dos tetos dos workers vivos (`seenAt` < 90 s) ou quando
  existe sessão com `connectRequestedAt` há mais de 2 min sem dono.

Por que não hash: hash exige `WORKER_SHARD_COUNT` igual em todos os workers e re-hash ao
mudar N (todas as sessões trocam de dono = onda de reconexão). Capacidade só precisa de
subir mais uma réplica com a mesma env. Réplicas necessárias = `ceil(sessões / (teto × 0,8))`.

**Autoescala (diferido).** Subir worker é manual: aumentar réplicas do serviço `worker` na
Render ou no Dokploy quando o alerta de 80% disparar. Controlador que chama a API da infra
(com teto de instâncias, intervalo mínimo entre escaladas e descida só manual) fica para
depois do primeiro worker extra em produção; não entra no plano atual.

### 3.3 Separação HTTP × worker

**Feito na E3 (api 0.62.0); produção segue em `all`.** Spec: `.specs/features/worker-role/`. Onde diverge
do desenho abaixo:

- Engine só via `getActiveEngine()`: em `all`/`worker` é a local (`localEngineContainer`); em `http` é
  `RemoteMessagingEngineAdapter` (não carrega Baileys/GramJS). Composição em `app/roleComposition.ts`,
  chamada antes de `buildApp`; jobs por papel em `app/processJobs.ts`.
- Fila BullMQ **por worker** (`engine-cmd-{workerId}`), não por sessão (D2: cada fila consumida custa uma
  conexão bloqueante), mais `session-open` compartilhada para abrir sessão sem dono (D3: qualquer worker
  consome, o lease decide). Comandos: `disconnect`, `logout`, `sendText/MediaMessage`, sem retry (D11).
  Timeout: texto 60 s, mídia 300 s; job ainda em espera é removido (não envia depois).
- RPC request/reply no Redis (`engine-rpc:{workerId}`) para QR, pairing, status, grupos, reações, leitura,
  login Telegram, `createOutboundMessageId`; timeout 10 s → 503 `ENGINE_NOT_READY`. Worker recusa sessão
  alheia (`SESSION_NOT_OWNED`) e o adapter re-resolve o dono uma vez. Erro atravessa como
  `{code,message,meta}` (`engineErrorWire`).
- Mídia do envio vai por objeto temporário (`outbound-tmp/`), por isso `http`/`worker` exigem S3 (D9).
  Chave órfã (processo morto antes do `finally`): o worker varre `outbound-tmp/` no boot e a cada 1 h
  (job `outboundTmpSweep`, `sweepExpired`) e apaga só chaves no formato de `stage` com mais de 1 h (envio
  mais longo: 300 s). Alternativa sem job: regra de lifecycle do bucket expirando `outbound-tmp/` em 1 dia
  (granularidade mínima do S3); se adotada, o job pode ficar como reforço. Nunca varrer outro prefixo.
- RPC leva `deadline` (agora + timeout do cliente): o worker descarta pedido vencido sem executar nem
  responder (sem `sendReaction`/`submitLogin*`/`markMessagesRead` tardio). Pedido sem `deadline` (cliente
  antigo em deploy escalonado) executa. Depende de relógio sincronizado (NTP) entre `http` e worker.
- Worker sobe só `GET /health` na `PORT` (`role`, `workerId`, sessões, Redis, banco); `/health` do `http`/
  `all` ganhou `role`. Worker também drena a fila de mídia antes dos sockets (D8). `http` em 1 réplica (D5).
- `TENANT_SUSPENDED`: listener em todo papel; no `http` o `disconnect` vai ao dono pela fila.
- Decidido (dono, 2026-11-04): timeout do comando de texto fica em 60 s (mídia 300 s); RPC segue 10 s.
- Pendente: sessão real (QR lido, código, envio, recebimento, grupos) não testada no smoke.

Mesmo código, três modos de boot via `PROCESS_ROLE=http|worker|all`:

- `http`: Fastify, rotas, WS/SSE, upload. Não instancia engine. Não adota sessão.
- `worker`: Fastify só com `/health` numa porta interna; adoção (§3.2), consome fila.
- `all`: comportamento atual (dev e instalação pequena), com o teto de §3.2 se a flag ligar.

**Dono de cada job de boot** (hoje nenhum checa role; só o rodízio usa `JobLease`):

| Job (`server.ts`) | Role dono | Lease |
|---|---|---|
| `UploadSessionSweeper`, `ReconcileInterruptedUploadsUseCase` (boot), drain de mídia no shutdown, `failOrphanPendingMedia.runBoot()` e `pendingMediaSweep` periódico (`MEDIA_PENDING_RECOVERY_ENABLED`) | `http` | disco `/var/data` é de um processo só; worker com a flag mataria envios em voo do http |
| `OfferDispatchWorker` (`OFFER_DISPATCH_WORKER_ENABLED`, `GROUP_MONITORING_ENABLED`) | `worker` | claim `pg_advisory_xact_lock('offer_dispatch_claim')` + `claimToken` em `PrismaOfferDispatchRepository.claimDue` (multi-instância segura; o comentário de `OfferDispatchWorker.ts:18` cita SKIP LOCKED por engano); lease opcional |
| `HubOutboxWorker` (`HUB_EVENTS_ENABLED` + `HUB_EVENTS_CONFIGURED`), `ExtensionRetentionJob` | `worker` | já seguros: `PrismaHubOutboxRepository` usa `SKIP LOCKED`; `ExtensionRetentionJob` usa `pg_try_advisory_lock` (não copiar como modelo: `$queryRaw` no pool pode dar `unlock` em outra conexão; preferir `JobLease`) |
| reconcile de billing (`ReconcileSubscriptionsUseCase`, `BILLING_ENABLED`, `BILLING_RECONCILE_INTERVAL_MS`) | `worker` | já usa `JobLease` (`BILLING_RECONCILE_LEASE_TTL_MS`) |
| Gestor de Links (`LINK_ROTATION_MEMBER_SYNC_ENABLED`) | `worker` | já usa `JobLease` |
| `markActiveSessionsAsDisconnected()` no boot (só com `SESSION_BOOTSTRAP_ON_STARTUP=false`) | `worker`, só sessões sem lease válido | — |
| `prisma migrate deploy` (`CMD pnpm start:migrate`) | todos; Prisma serializa por advisory lock | subir `http` antes das réplicas `worker` no deploy, para o código novo não rodar com schema velho |

Comunicação HTTP → worker por **BullMQ** (fila por `sessionId`, só o dono consome):
`session.connect`, `session.disconnect`, `session.logout`, `message.send.text`,
`message.send.media`. Resultado volta por evento no Redis.

**Chamadas síncronas que dependem da memória do dono** (não cabem em fila): `GET /:id/qr`
(`latestQr`), pairing code, login Telegram (`requestLoginCode` espera `codeSent` na mesma
chamada; `submitLoginCode`/`submitLoginPassword` exigem `pending` em memória), listagem de
grupos, reações, leitura. Em `http` elas viram RPC request/reply via Redis para o dono
(`RemoteMessagingEngineAdapter` implementa `IMessagingEngine` e roteia por `ownerWorkerId`;
timeout 10 s → `ENGINE_NOT_READY`). Login Telegram/QR/pairing de sessão **sem dono** exige adoção
antes: a rota grava `connectRequestedAt` (helper de §3.1), espera adoção (até 15 s) e só
então o RPC. Nenhuma dessas 6 rotas passa por `ConnectSessionUseCase` hoje; por isso o
helper, não o use case, é o ponto único.

### 3.4 Fan-out de eventos

Decisão: **WS puro (`@fastify/websocket`) permanece**; não migrar para Socket.IO. Socket.IO
custa ~2x por conexão (engine.io, heartbeat próprio, ack buffer) e serve a fallback de polling
que nenhum navegador ou proxy atual precisa. Salas já existem no `Map<tenantId, Set<WebSocket>>`.
SSE (`GET /chat/events`, `useChatSSE`) removido na E3: cada painel segurava 1 WS + 1 SSE e recebia
`MESSAGE_RECEIVED` duas vezes. Webhooks ficam para API pública de integradores, com fila e
retry, item separado no roadmap.

`InternalEventBus` ganha implementação `RedisInternalEventBus` atrás da mesma interface.
Worker publica em canal `tenant:{tenantId}`; cada réplica HTTP assina e repassa aos seus WS/SSE.
`ChatWebSocketPublisher` não muda de contrato. **Feito na E3** com `RedisChatEventRelay` (só o fan-out do WS;
`InternalEventBus` segue local). Eco fica em memória: envio e eco ocorrem no mesmo dono (D6). Throttle de
reação segue em memória, por isso `http` tem 1 réplica.

### 3.5 Mídia em objeto

`LocalMediaFileStore` ganha irmão `S3MediaFileStore` (Cloudflare R2, sem egress). Upload em
partes vira multipart upload do S3. `resolveMediaUrl` passa a montar URL assinada ou de CDN.
Plano detalhado já existe em
[`superpowers/plans/2026-05-09-chat-media-storage-architecture.md`](superpowers/plans/2026-05-09-chat-media-storage-architecture.md).

**Estado na Render (2026-10-13):** `copysync_api` tem disco persistente em `/var/data`
(`STORAGE_PATH=/var/data/storage`). Mídia sobrevive a deploy, mas disco na Render impede
réplicas > 1 e zero-downtime deploy (o serviço para e sobe de novo). A migração para R2 é o
que libera as duas coisas.

### 3.6 Fila durável para o produto

Monitoramento de grupos, reescrita com IA e postagem agendada (roadmap itens 4, 6, 7, 10) são
jobs por natureza: BullMQ com filas `monitoring.inbound`, `offer.rewrite`, `broadcast.post`,
rate limit por sessão (WhatsApp pune rajada) e retry com backoff. Não construir essas features
sobre `setInterval` in-process.

### 3.7 Observabilidade de recursos

CPU/RAM dos containers, Postgres e workers são amostrados por um job do `worker` sob lease único
e lidos só pelo super admin em `GET /admin/ops/metrics`: ver [`ops-metricas.md`](ops-metricas.md).
**Exceção declarada** à regra de estado em memória: o ring buffer de 60 leituras do
`OpsMetricsSamplerJob` é cache de `ops_metrics_samples` (perda ≤ 5 min em crash aceita); alertas e
silêncio ficam em lease no banco. Sem APM externo, sem `/metrics` público no `http`.

---

## 4. Ordem de entrega

| Fase | Entrega | Desbloqueia | Esforço |
|---|---|---|---|
| 0 | Medir RAM/CPU por sessão; `connection_limit` por processo (adapter já unificado) | decisões com número real | 1-2 dias |
| 1 | Mídia em S3/R2 (3.5) | remover disco, qualquer multi-processo | 1 semana |
| 2 ✅ api 0.59.0 | Lease + teardown ao perder lease + CAS em `writeKeys` (3.1); `connectRequestedAt` | deploy sem 440, failover, 2+ processos seguros | 1 semana |
| 3 ✅ código, api 0.62.0 | `PROCESS_ROLE` + dono por job + BullMQ comandos + RPC síncrono (3.3) + Redis pub/sub (3.4) | HTTP escalar separado do worker | 2-3 semanas |
| 4 ✅ código, api 0.62.0 | `WORKER_ADOPTION_ENABLED` + teto + drain + heartbeat + alerta (3.2) | N réplicas, tenant dedicado | 1 semana |

Fases 3 e 4 estão no código, não ligadas na Render: falta o checklist de §5.1 e o smoke com sessão real.
| 5 | Filas de produto (3.6) | monitoramento e disparo em escala | junto com as features |

Fase 1 antes da 2 porque disco local bloqueia tudo. Fase 2 antes da 3 porque protege até com
1 processo. Cada fase é compatível com `PROCESS_ROLE=all`, então dev local e instalação pequena
seguem num único processo.

---

## 5. Servidores

### 5.1 Render (hoje)

Serviço `copysync_api` em Docker, plano 1c-2g, disco em `/var/data`. O `CMD` da imagem é
`pnpm start:migrate` (`prisma migrate deploy` com retry → `node dist/app/server.js`): toda
migration commitada em `api/prisma/migrations/` é aplicada no boot de cada deploy, sem Pre-Deploy
Command no painel. Migration falhando = container não sobe = Render mantém a versão anterior.
Incidente 2026-10-27: API 0.33 no ar com migration `offer_config_multi_session` não aplicada
porque o `CMD` subia o servidor direto. Postgres: **dedicado ao CopySync desde ~2026-10-30**
(informado pelo owner em 2026-11-06); até então era compartilhado com o PulsoSocial (Basic-256mb),
que não aguentava auth state de 100 sessões e deixava um produto derrubar o outro.

Escada do Postgres dedicado do CopySync (decisão 2026-10-26; região **Virginia**, mesma do `copysync_api` e do banco `waioprime`;
a central fica em Oregon e não deve ser seguida):

| Momento | Plano Render | Observação |
|---|---|---|
| Desenvolvimento e debug | 0.1c-256mb (US$ 6) | serve para poucas sessões; `connection_limit=5` na `DATABASE_URL` desde já |
| Primeiro cliente pagante | 0.5c-1g (US$ 19) | mínimo para produção pequena |
| ~50 sessões ou CPU/conexões > 70% | 1c-2g (US$ 40) | cobre até 110 sessões; daí em diante vale a tabela abaixo |

A medição da Fase 0 (RAM/CPU por sessão) só vale no 0.5c-1g ou acima; no 256 MB o gargalo medido é o Postgres, não o Node.
Criação (decisão 2026-10-26: só sessões de teste em produção, então **sem dump**): banco vazio + `prisma migrate deploy`, trocar
`DATABASE_URL`, subir, parear as sessões de teste de novo. Criado sob demanda, antes da Fase 1 (R2) ou do primeiro teste de carga.
Tabelas antigas no banco compartilhado: verificado em 2026-11-06 que o Postgres do PulsoSocial não tem nenhuma tabela do CopySync; nada a apagar ali. Storage 15 GB basta porque mídia vai para R2 (Fase 1).

Um processo em modo `all` (HTTP + worker) com 150-300 sessões precisa de `WORKER_MAX_SESSIONS` igual à meta e de
`NODE_OPTIONS=--max-old-space-size=<70% da RAM em MB>`, senão o heap padrão do Node
(~2-4 GB) estoura antes do plano.

Escada na Render (teto por réplica `worker` = `WORKER_MAX_SESSIONS`; réplicas = `ceil(sessões / (teto × 0,8))`):

| Sessões | Serviços | US$/mês | Postgres (dedicado ao CopySync) | US$/mês |
|---|---|---|---|---|
| até 110 | 1× `PROCESS_ROLE=all` 2c-8g, teto 140 | 135 | 1c-2g | 40 |
| até 220 | 1× `all` 4c-16g, teto 280 | 225 | 2c-4g | ~95 |
| até 448 | `http` 1c-2g + 4× `worker` 2c-8g (teto 140) | ~565 | 2c-4g | ~95 |
| até 896 | `http` 1c-2g + 8× `worker` 2c-8g | ~1.100 | 4c-8g | ~185 |
| 1.000+ | migrar para Hetzner/Dokploy (§5.3) | — | — | — |

Serviço `worker` na Render é **Private Service** (porta interna + health check em `/health`
+ `SIGTERM` com grace), não Background Worker (sem porta nem health check). Mesma imagem e
`CMD` do `copysync_api`; só a env muda. `NODE_OPTIONS=--max-old-space-size` vai na env de
cada serviço (não está no `Dockerfile`, `render.yaml` nem `docker-compose.yml`). O `render.yaml`
hoje só declara o static `copysync`; a env e o tipo de cada serviço ficam documentados aqui
até entrarem no blueprint.

Envs de papel e adoção (`api/src/shared/config/env.ts`; nunca no `api/.env` local, que aponta para produção):

| Env | Default | Quando ligar |
|---|---|---|
| `PROCESS_ROLE` | `all` | `http` no `copysync_api` e `worker` no Private Service, só após o checklist abaixo. `http`/`worker` sem `REDIS_URL` ou sem `MEDIA_STORAGE_DRIVER=s3` falham o boot |
| `REDIS_URL` | vazio | com o Key Value da Render; `all` ignora |
| `ENGINE_COMMAND_CONCURRENCY` | `2` | comandos simultâneos por fila do worker; subir só medindo |
| `WORKER_ADOPTION_ENABLED` | `false` | no worker (ou `all`) quando houver mais de um processo de sessão ou para readotar no deploy |
| `WORKER_MAX_SESSIONS` | `40` | teto medido na Fase 0 (§3.2), junto com `NODE_OPTIONS`; conta só sessões com login concluído |
| `WORKER_MAX_PENDING_LOGINS` | `50` | logins em andamento (QR/código) por processo; só baixar se a RAM apertar |
| `WORKER_SHARD` | vazio | só com tenant dedicado (ninguém grava `Session.shard` ainda) |
| `DATABASE_SOCKET_TIMEOUT_S` | vazio | em todo serviço antes de ligar o 2º processo (ex.: 30; §6) |

**Antes de ligar mais de um processo na Render:**

- [ ] Key Value (Redis) criado na mesma região; `REDIS_URL` nos dois serviços.
- [ ] Mídia em S3/R2 (`MEDIA_STORAGE_DRIVER=s3` + `S3_*`) e disco `/var/data` fora do caminho.
- [ ] `DATABASE_SOCKET_TIMEOUT_S` e `connection_limit` na `DATABASE_URL` de cada serviço.
- [ ] Worker como **Private Service** (health em `/health`, `PORT`), mesma imagem e `CMD`.
- [x] Timeout de comando de texto: 60 s (decisão do dono 2026-11-04).
- [x] QR sem leitura não ocupa vaga do worker (decisão do dono 2026-11-04; E4 T24).
- [ ] Smoke com sessão real autorizada: QR lido, código, envio texto/mídia, recebimento, grupos, readoção sem 440.

Preços de Postgres acima de 1c-2g são aproximados; conferir nos 24 planos do painel.

Mais HTTP 4c-8g (175), Postgres 8 GB com HA (~150-200), Key Value (~10-30), R2 (~15/TB).
Total em 3.000 sessões: **~US$ 1.900/mês**. Static do app: 0.

### 5.2 Self-hosted (Hetzner + Coolify)

Coolify é open source e grátis; instala com um comando num Ubuntu limpo e dá deploy por git,
HTTPS automático, Postgres, Redis e MinIO com um clique, backup agendado para R2. O custo é só
a máquina.

| Sessões | Máquina | €/mês (2026-10, sem IVA) |
|---|---|---|
| até 800 | Dedicado **AX42** (Ryzen 7 PRO 8700GE, 8c/16t, 64 GB DDR5 ECC, 2× 512 GB NVMe) | 99 + 49 setup |
| até 3.000 | Dedicado **AX102** (Ryzen 9 7950X3D, 16c/32t, 128 GB DDR5 ECC, 2× 1,92 TB NVMe) | 259 + 129 setup |
| 3.000+ | 2× AX102, ou AX102 para workers + AX42 para Postgres/Redis | ~360 |

Hetzner Cloud (linha CCX, vCPU dedicada) subiu em junho/2026: CCX23 (4 vCPU/16 GB) ~€86,
CCX33 (8 vCPU/32 GB) ~€138. Ficou mais caro que o dedicado AX42 com o dobro de RAM, então
**começar direto no dedicado**. Trade-offs do dedicado: sem snapshot automático (usar backup
do banco para R2 + imagem com `rescue`/Borg), hardware físico pode falhar (RAID1 nos 2 NVMe,
Hetzner troca peça em horas), setup em horas em vez de minutos. Linha SX/EX não vale: mais
caro para o mesmo caso.

Total em 3.000 sessões: **~€260-360/mês**, 5-6× mais barato que a Render. Usar datacenter
Ashburn se o Postgres ficar na Render (latência Virginia ↔ Alemanha pesa no auth state).

Alternativa sem painel: `docker-compose.yml` com `api`, `worker`, `postgres`, `redis`, `minio`,
`caddy` (HTTPS automático). O compose do legado2 serve de base.

### 5.3 Trajetória self-hosted recomendada (nó único → multi-nó)

| Fase | Sessões | Infra | Custo |
|---|---|---|---|
| A | 0-300 | Dedicado AX42 (64 GB) + Dokploy (Swarm + Traefik). `api`, `postgres`, `redis`, `minio` no mesmo nó. App no Cloudflare Pages | €99 |
| B | 300-800 | Mesmo AX42. 1 serviço `api` (http) + 2-3 réplicas `worker` com `WORKER_MAX_SESSIONS`. Sobra RAM | €99 |
| C | 800-2.000 | Segundo nó AX42 ou AX102 via Dokploy (SSH). Workers no nó 2, Postgres/Redis no nó 1 | €200-360 |
| D | 3.000+ | AX102 para workers; AX42 para Postgres com réplica | ~€360 |

Dokploy em vez de Coolify: usa Swarm (replicas 1 preso a hostname é o modelo do worker
Baileys), o compose do legado2 já declara `dokploy-network`, multi-nó nativo. Coolify é
equivalente.

Compose de produção parte do `docker-compose.yml` da raiz com `redis`, `minio`, volume
`/var/data` e `NODE_OPTIONS=--max-old-space-size`. Saída da Render: mídia para R2/MinIO,
`pg_dump` → restore (separa do PulsoSocial no ato), DNS para o nó, env com `REDIS_URL` e `S3_*`.
Nó único cai inteiro: backup do banco para R2 a cada 6 h + RAID1 nos NVMe. Pedir o servidor em Ashburn (EUA) se o Postgres ficar na Render.

### 5.4 Critério de escolha

Render enquanto a diferença de preço for menor que o custo de operar Linux. A linha fica em
torno de 500-800 sessões. Se já houver conforto com Docker e SSH, Hetzner + Coolify desde o
início, mantendo app estático na Render ou Cloudflare Pages.

Em qualquer hospedagem o trabalho de código da seção 4 é o mesmo; é ele que destrava a escala,
não o servidor.

---

## 6. O que não fazer

- Não criar container ou VM por tenant. Instância é uma linha no banco; um processo serve centenas.
- Não abrir socket sem passar pelo `ISessionLeaseGate` (lease), nem gravar status ou chave ao
  abortar (`abortSession`) sessão que perdeu o lease.
- Não chamar `writeKeys` sem `expectedVersion` no Baileys (sem CAS dois donos corrompem as chaves).
- Não soltar lease antes de fechar o socket, nem mudar a ordem do shutdown em `server.ts`.
- Não subir 2 processos com `SESSION_BOOTSTRAP_ON_STARTUP=true` e adoção desligada esperando divisão:
  o segundo só pula as sessões do primeiro. Divisão = `WORKER_ADOPTION_ENABLED=true`.
- Não ligar `PROCESS_ROLE` nem `WORKER_ADOPTION_ENABLED` local (`pnpm dev` com `api/.env` = produção
  roubaria lease e reconectaria sessões reais), nem na Render antes do checklist de §5.1.
- Não chamar a engine local no `http` (`localEngine()` só em `roleComposition`/`localEngineContainer`;
  o resto usa `getActiveEngine()`), nem usar pub/sub para comando que precisa de entrega (BullMQ).
- Não ligar retry automático no envio (duplica mensagem no grupo) nem subir `http` para N réplicas
  (upload em disco e throttle de reação são por processo).
- Não subir `WORKER_MAX_SESSIONS` sem medir RAM (Fase 0), nem gravar `Session.shard` sem tenant dedicado.
- Smoke local só com env sintético apontando para o Postgres descartável
  (`api/scripts/postgres-descartavel.sh`): `api/.env` **e** `api/.env.dev` têm `DATABASE_URL` de produção.
- Testes de integração (`api/vitest.int.config.mts`, dois projetos, em sequência):
  - `db` = `*.int.test.ts`: exige `INTEGRATION_DATABASE_URL` em localhost (`postgres-descartavel.sh`).
  - `redis` = `*.redis.int.test.ts`: roda sem Postgres (`DATABASE_URL` forçada para localhost inexistente);
    `INTEGRATION_REDIS_URL` só localhost, ausente = arquivos pulados. Teste que usa Redis **e** banco fica
    no `db` (sem o sufixo `.redis`).
  - `api/scripts/redis-descartavel.sh start` → `INTEGRATION_REDIS_URL=… pnpm -C api test:int:redis` → `stop`.
    Container `copysync-redis-int-<porta>` (override `REDIS_INT_NAME`), nome salvo em
    `$TMPDIR/copysync-redis-int/name`: o `stop` derruba o mesmo que o `start` subiu. Jobs paralelos usam
    `TMPDIR` próprio; porta livre a partir de 56379 (ou `REDIS_INT_PORT`).
- Não usar Kubernetes abaixo de milhares de sessões.
- Não implementar monitoramento/disparo com `setInterval` in-process.
- Não guardar sessão, fila, eco ou cache de decisão em memória sem equivalente externo
  previsto. Cache de avatar e metadata de grupo pode ficar local (só desempenho).
- Não subir pool Prisma padrão em 15 processos; estoura o limite de conexões do Postgres.
- Não ligar mais de um processo sem `DATABASE_SOCKET_TIMEOUT_S` (inteiro, segundos; ex.: 30). Com
  ela o `PrismaClient` usa a `DATABASE_URL` + `socket_timeout=<n>` (`shared/database/datasourceUrl.ts`;
  não duplica se a URL já tiver o parâmetro): banco mudo devolve a conexão ao pool em vez de prendê-la.
  Ausente = URL idêntica à de antes. A fila do lease (`PrismaSessionLeaseRepository`) libera no prazo
  de cada operação, e o connect/pareamento do usuário tem prazo de 60 s na carga do auth state (503);
  a origem automática segue com 15 s.

---

## 7. Reduzir consumo por sessão (antes de comprar servidor)

A base herdou um inbox de atendimento (chat 1:1, presença, reações, receipts, avatares, estado
de chats) que o [roadmap](produto-roadmap.md) não lista. Para afiliados, cada número só precisa
ouvir grupos-fonte e postar em grupos-destino. Cortar o excesso reduz a carga por sessão em
~60-80% e dobra ou triplica sessões por processo. Referências em
`messaging/infrastructure/engines/baileys/BaileysMessagingEngineAdapter.ts` (A).

| Item | Hoje | Necessário? |
|---|---|---|
| `messages.upsert` ingere toda conversa (A:635) | ~7 queries + evento WS por mensagem | só grupos-fonte |
| Mídia de 1:1 (A:1235) | baixa sempre, buffer em RAM, disco sem limpeza | não |
| `chats.*`, `contacts.upsert`, `messaging-history.set` (A:846-949) | rajada de upserts no pareamento | não |
| `presence.update`, `messages.reaction`, receipts READ (A:747-812, 952) | N updates por leitor de grupo | não; só status "enviado" |
| Foto de perfil (A:416) | até 200 participantes por grupo, cache 6 h sem limite, dispara em `ListSessions` | não |
| Auth state (`BaileysAuthStatePersistence.ts`) | por chave (`writeKeys` com mapa `dirty`), sem CAS | CAS em `version` (§3.1) |
| `fetchLatestBaileysVersion` (A:501) | HTTP a cada conexão | cachear 24 h |
| `cachedGroupMetadata` ausente (A:504) | `groupMetadata` refeito em cada `sendMessage` de grupo | ligar com TTL |
| Logger Baileys herda `info` (A:108) | log interno da lib por mensagem | `warn` |
| SSE + WS (seção 3.4) | 2 conexões por painel | remover SSE |
| Retenção | nenhuma: `ChatMessage`, mídia e avatares acumulam | job diário, N dias por plano |
| Model `Message` legado (`schema.prisma:246`) | sem write em `src` | remover |

Ordem por ganho/esforço (1-4 sem migration):

1. `shouldIgnoreJid` por sessão: só grupos-fonte e grupos-destino cadastrados passam.
2. `Session.ingestionMode = FULL | MONITORED_GROUPS` (default `MONITORED_GROUPS`): desliga
   chats, contacts, presence, reactions, history, receipts READ, mídia 1:1, avatar de participante.
   `FULL` mantém o inbox para quem precisar; o módulo `chat` vira opcional.
3. `cachedGroupMetadata` com TTL (reaproveita `groupMetadataCache`); versão do Baileys em cache 24 h.
4. `BAILEYS_LOG_LEVEL=warn`.
5. Auth state por chave: feito (`session_auth_keys`, mapa `dirty` em `BaileysAuthStatePersistence`). Resta o CAS (§3.1).
6. Retenção: job apaga `ChatMessage` > N dias e mídia órfã; índice em `ChatMessage.status`.
7. Remover SSE e o model `Message` legado.
