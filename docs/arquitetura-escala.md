# Estratégia de escala — CopySync

Fonte de verdade de **como** a plataforma cresce de 1 instância para milhares de sessões
WhatsApp sem reescrever a arquitetura. Complementa [`../AGENTS.md`](../AGENTS.md) (regras de
código) e [`produto-roadmap.md`](produto-roadmap.md) (o que é vendido). Atualizado em 2026-10-13.

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
| Dono da sessão | `prisma/schema.prisma` (`Session`) | Sem `ownerInstanceId`/lease. Boot em N processos abre N sockets, que se derrubam com 440 |
| Auth state | `sessions/infrastructure/repositories/PrismaSessionAuthStateRepository.ts` | `upsert` ignora `version`; dois sockets corrompem as chaves Signal |
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
                 Workers Baileys  (M processos, cada um dono de um shard de sessões)
                      │
          Postgres (sessões, lease, auth state, mensagens)   S3/R2 (mídia)   Redis
```

### 3.1 Dono da sessão (lease)

Novos campos em `Session`: `ownerWorkerId String?`, `leaseUntil DateTime?`.

- Worker adota sessão com `UPDATE ... SET ownerWorkerId=$me, leaseUntil=now()+60s WHERE id=$id
  AND (leaseUntil IS NULL OR leaseUntil < now())`. Zero linhas afetadas = outro worker é dono.
- Worker renova o lease a cada 20-30 s enquanto o socket vive. Se o processo morre, o lease
  vence e outro worker adota: **failover automático** sem intervenção.
- `SessionStatusReconciler` e `FailOrphanPendingMediaUseCase` só tocam sessões cujo lease está
  vencido ou é do próprio worker.
- Deploy da Render (sobe nova instância antes de matar a antiga) deixa de gerar 440 em cadeia.
- Auth state: `upsert` passa a checar `version` (lock otimista). Conflito = log + descarta,
  nunca sobrescreve.

Use cases novos: `AcquireSessionLeaseUseCase`, `RenewSessionLeaseUseCase`,
`ReleaseSessionLeaseUseCase`. Repositório: `ISessionLeaseRepository` + `PrismaSessionLeaseRepository`.

### 3.2 Shard

Cada worker lê `WORKER_ID` e `WORKER_SHARD` / `WORKER_SHARD_COUNT`. Adota apenas sessões cujo
`hash(sessionId) % WORKER_SHARD_COUNT === WORKER_SHARD`, ou cujo `Session.shard` (coluna
explícita) bate. Coluna explícita permite tenant grande em worker dedicado. É o `clientName`
do Evolution, só que com lease automático por cima.

### 3.3 Separação HTTP × worker

Mesmo código, dois modos de boot via `PROCESS_ROLE=http|worker|all`:

- `http`: Fastify, rotas, WS/SSE, upload. Não instancia `BaileysMessagingEngineAdapter`.
- `worker`: sem rotas HTTP além de `/health`; roda `SessionBootstrapService`, consome fila.
- `all`: comportamento atual (dev e instalação pequena).

Comunicação HTTP → worker por **BullMQ** (fila por `sessionId`, só o dono consome):
`session.connect`, `session.logout`, `message.send.text`, `message.send.media`. Resultado volta
por evento no Redis. Unificar antes os dois `BaileysMessagingEngineAdapter` que existem hoje
(`server.ts` e `session.routes.ts`) num único via `activeEngine`.

### 3.4 Fan-out de eventos

Decisão: **WS puro (`@fastify/websocket`) permanece**; não migrar para Socket.IO. Socket.IO
custa ~2x por conexão (engine.io, heartbeat próprio, ack buffer) e serve a fallback de polling
que nenhum navegador ou proxy atual precisa. Salas já existem no `Map<tenantId, Set<WebSocket>>`.
Remover o SSE (`GET /events`, `useChatSSE`): hoje cada painel segura 1 WS + 1 SSE e recebe
`MESSAGE_RECEIVED` duas vezes. Webhooks ficam para API pública de integradores, com fila e
retry, item separado no roadmap.

`InternalEventBus` ganha implementação `RedisInternalEventBus` atrás da mesma interface.
Worker publica em canal `tenant:{tenantId}`; cada réplica HTTP assina e repassa aos seus WS/SSE.
`ChatWebSocketPublisher` não muda de contrato. Registro de eco e throttle de reação migram
para Redis com TTL.

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

---

## 4. Ordem de entrega

| Fase | Entrega | Desbloqueia | Esforço |
|---|---|---|---|
| 0 | Medir RAM/CPU por sessão; `connection_limit` por processo; unificar adapter | decisões com número real | 1-2 dias |
| 1 | Mídia em S3/R2 (3.5) | remover disco, qualquer multi-processo | 1 semana |
| 2 | Lease + `version` no auth state (3.1) | deploy sem 440, failover, 2+ processos seguros | 1 semana |
| 3 | `PROCESS_ROLE` + BullMQ comandos (3.3) + Redis pub/sub (3.4) | HTTP escalar separado do worker | 1-2 semanas |
| 4 | Shard (3.2) | N workers, tenant dedicado | 2-3 dias |
| 5 | Filas de produto (3.6) | monitoramento e disparo em escala | junto com as features |

Fase 1 antes da 2 porque disco local bloqueia tudo. Fase 2 antes da 3 porque protege até com
1 processo. Cada fase é compatível com `PROCESS_ROLE=all`, então dev local e instalação pequena
seguem num único processo.

---

## 5. Servidores

### 5.1 Render (hoje)

Serviço `copysync_api` em Docker, plano 1c-2g, disco em `/var/data`. Postgres **compartilhado
com o PulsoSocial** (plano Basic-256mb em 2026-10-13): não aguenta auth state de 100 sessões
e qualquer pico de um produto derruba o outro. Mínimo 1c-2g (US$ 40); separar em instâncias
distintas antes de 300 sessões.

Um processo em modo `all` (HTTP + worker) com 150-300 sessões precisa de
`NODE_OPTIONS=--max-old-space-size=<70% da RAM em MB>`, senão o heap padrão do Node
(~2-4 GB) estoura antes do plano.

Escada na Render, só o worker:

| Sessões | API (processo único, `PROCESS_ROLE=all`) | US$/mês | Postgres (dedicado ao CopySync) | US$/mês |
|---|---|---|---|---|
| até 150 | 2c-8g | 135 | 1c-2g | 40 |
| até 300 | 4c-16g | 225 | 2c-4g | ~95 |
| até 600 | 4c-16g + `PROCESS_ROLE` separado, 2 workers | 400 | 2c-4g | ~95 |
| até 1.200 | 8c-32g, 6 workers | 450 | 4c-8g | ~185 |
| até 3.000 | 3× 8c-32g (preferível) ou 1× 12c-96g | 1.350-1.500 | 4c-16g + HA | ~370+ |

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
| B | 300-800 | Mesmo AX42. 1 serviço `api` (http) + 2-3 `worker` com `WORKER_SHARD`. Sobra RAM | €99 |
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
- Não ligar `SESSION_BOOTSTRAP_ON_STARTUP` em mais de um processo antes da Fase 2.
- Não usar Kubernetes abaixo de milhares de sessões.
- Não implementar monitoramento/disparo com `setInterval` in-process.
- Não guardar sessão, fila, eco ou cache de decisão em memória sem equivalente externo
  previsto. Cache de avatar e metadata de grupo pode ficar local (só desempenho).
- Não subir pool Prisma padrão em 15 processos; estoura o limite de conexões do Postgres.

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
| Auth state (`BaileysAuthStatePersistence.ts:140`) | blob único reescrito a cada `keys.set` | sim, fatiar por chave |
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
5. Auth state por chave: tabela `session_auth_keys (sessionId, type, id, value)`; grava só a
   chave alterada (padrão Evolution). Migration + mapper.
6. Retenção: job apaga `ChatMessage` > N dias e mídia órfã; índice em `ChatMessage.status`.
7. Remover SSE e o model `Message` legado.
