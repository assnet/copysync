# Métricas de recursos da plataforma (ops)

Entrega E de `.specs/features/monitoring-queue-isolation` (MQ-21..25). Mede CPU/RAM dos
containers, saúde do Postgres e dos workers **fora do caminho do usuário**: um job no `worker`,
baixa frequência, persistência rara. Dado de infraestrutura: sem tenant, sem PII, sem SQL bruto.

## O que é medido e onde

| Fonte | Métricas (`OPS_METRIC` em `metrics/domain/OpsMetric.ts`) | Origem |
|---|---|---|
| Render | `cpu`, `cpu_pct`, `memory`, `memory_pct` por recurso/instância | Render Metrics API (`RenderPlatformMetricsSource`) |
| Postgres | `db_connections`, `db_active`, `db_idle`, `db_idle_in_transaction(_max_age_s)`, `db_xact_commit/rollback`, `db_deadlocks`, `db_temp_bytes`, `db_cache_hit_pct`, `db_statement_total_ms` | catálogo `pg_stat_*` com `statement_timeout` 2 s (`PrismaDatabaseStatsSource`) |
| Workers | `rss_mb`, `node_cpu_pct`, `event_loop_p99_ms` | `worker_heartbeats` (`rssMb`, `cpuPct`, `eventLoopP99Ms`), gravados pelo `WorkerHeartbeatJob` |
| Sessões | `sessions_connected`, `sessions_pending_login`, `sessions_awaiting`, `sessions_capacity` (recurso `cluster`) | `SessionsOccupancySource`: uma consulta em `sessions` (lease vivo; `statement_timeout` 2 s); `awaiting` = 0 e `capacity` = teto × donos de lease sem adoção; com adoção, `countAwaitingCapacity()` e soma dos tetos dos batimentos. Uso: [`workers-escala.md`](workers-escala.md) (Capacidade; a subida automática decide a ocupação sustentada por estas amostras, então sem coletor ela só age por sessão aguardando) |

- **Sampler**: `OpsMetricsSamplerJob` (`api/src/modules/metrics/infrastructure/jobs/`), tick de
  60 s com `unref()`, só em `worker`/`all`. Um dono por vez no cluster: lease `ops-metrics-sampler`
  (`IJobLease`), TTL 45 s (menor que o tick), solto no `stop()`. Coleta limitada a 30 s
  (`OPS_TICK_TIMEOUT_MS`, `AbortSignal.timeout`): estourou, a amostra do tick é descartada. Antes do
  `persist` o lease é renovado (`release` + `tryAcquire`, pois `tryAcquire` só pega lease vencido);
  se outro processo virou dono, não grava. Não remover essa renovação nem subir o teto acima do TTL.
- **Persistência**: ring buffer de 60 leituras em memória, agregado e gravado em
  `ops_metrics_samples` a cada 5 ticks (gauge = média; counter = último valor; `sessions_capacity` = último valor, porque o teto muda em degrau e a média misturaria antes e depois; `meta` = min/max/n/unit; `meta.agg` = `'avg'` ou `'last'` diz como o valor foi obtido; ausente em amostras gravadas antes da api 0.83.0, que são média para gauge).
- **Retenção**: 7 dias; o próprio tick apaga `at < now() - 7d` (índice `ops_metrics_samples(at)`)
  em lotes de 5 mil por `ctid`, cada lote com `SET LOCAL statement_timeout = '2s'`, no máximo 10 lotes
  por tick (pior caso 20 s, dentro do lease renovado). Backlog maior escoa nos ticks seguintes.
  Nunca `deleteMany` sem limite.
- **Leitura bruta**: `GET /api/admin/ops/metrics?metric=&from=&to=&cursor=` só super admin
  (`metrics/presentation/routes/opsMetrics.routes.ts`). Lê só `ops_metrics_samples` e o estado
  atual de `worker_heartbeats`; nunca chama a Render. Janela padrão 24 h, máximo 7 dias; página de
  500 decidida pelo servidor; o cliente repete `from`/`to` devolvidos em `window` junto do
  `nextCursor` (cursor de outra janela recomeça do início).

## Leitura do dashboard (Consumo, super admin)

Duas rotas para a tela "Consumo" dentro de Workers. Mesmos hooks (`authHook` + `superAdminHook`,
401 sem super admin), só tabelas locais, **nunca Render ao vivo**.

`GET /api/admin/ops/metrics/series?metrics=cpu_pct,memory_pct&from=&to=&resource=`
(`GetOpsMetricsSeriesUseCase`)

- `metrics`: nomes de `OPS_METRIC` separados por vírgula, no máximo 12 (repetidos contam uma vez);
  ausente = `cpu_pct,memory_pct`. Nome desconhecido → 400.
- Janela: padrão 24 h até agora; `from > to` ou mais de 7 dias → 400 (`resolveOpsMetricsWindow`).
- Agregação **no servidor** (`PrismaOpsMetricsSampleRepository.aggregate`): balde =
  `max(5 min, ceil(janela/240))` arredondado para cima a 1/5/15/30/60/120/360 min
  (`opsBucketMinutes`; 24 h → 15 min, 7 dias → 60 min, ≤ 240 pontos por série). SQL cru com
  `avg(value)` por (source, resource, metric, balde), em `$transaction` com
  `SET LOCAL statement_timeout = '2s'`.
- min/max: cada linha da tabela é a média de 5 min. Para **gauge** o balde usa
  `min(meta.min)`/`max(meta.max)` (pico real do tick de 60 s); `meta` ausente ou não numérica
  (`jsonb_typeof <> 'number'`) cai para `value`. **Counter** (`OPS_COUNTER_METRICS`) usa sempre
  `value`. Nunca voltar a `max(value)` em gauge: esconde pico de CPU/memória.
- Teto de séries **no SQL** (nada é materializado além dele): `db_statement_total_ms` entra só
  com os `OPS_SERIES_MAX_STATEMENT_SERIES` (10) `queryid` de maior `max(value)` na janela; depois
  no máximo `OPS_SERIES_MAX_SERIES` (40) séries por resposta, na ordem resource, metric, source.
  Série cortada não aparece; para ver uma consulta específica, passe `resource=<queryid>`.
- Fuso: `at` é `timestamp` sem fuso gravado em UTC. Corte com `::timestamptz AT TIME ZONE 'UTC'`
  e balde por `extract(epoch FROM at)` (nominal, alinhado à época): independe do `TimeZone` da
  sessão (teste de integração troca o banco para São Paulo e compara).
- Resposta: `{ window:{from,to}, bucketMinutes, series:[{ resource, kind, metric, points:[{ at, avg, min, max }] }] }`;
  `at` = início do balde; valores arredondados a 3 casas. `kind` derivado (`opsResourceKind`):
  `query` (`db_statement_total_ms`) › `worker` (source worker) › `postgres` (`dpg-` ou source
  postgres) › `worker_service` › `api` (outro `srv-`) › `other` (fonte `sessions`).
- `worker_service` (desde api 0.86.0): amostra da Render (`srv-`) cujo `resource` é igual a
  `WORKER_SCALER_SERVICE_ID` ou começa com `<WORKER_SCALER_SERVICE_ID>-` (instâncias, `srv-<id>-<sufixo>`).
  Réplicas novas do worker entram sozinhas: o sampler já pede à Render o `WORKER_SCALER_SERVICE_ID`
  válido junto com `RENDER_RESOURCE_IDS` (`samplerResourceIds`, sem duplicar), e a Render devolve
  cada instância como `<id>-<sufixo>`; não é preciso pôr o worker na lista. Prefixo
  com `-` para `srv-ab` nunca pegar `srv-abc`. A env é lida no ponto de composição
  (`opsMetrics.routes.ts`) e conferida por `opsWorkerServiceId` (`^srv-[a-z0-9]+$`); ausente ou
  inválida = todo `srv-` é `api` (comportamento antigo). Não confundir com `worker`, que é o
  batimento por processo (`source='worker'`). Só derivado na leitura: nada é regravado, e
  amostras antigas do worker passam a sair como `worker_service` assim que a env existe no `http`.
- Counters (`db_xact_*`, `db_deadlocks`, `db_temp_bytes`, `db_statement_total_ms`) são acumulados:
  o avg do balde é do acumulado; taxa (delta) é conta da tela.

`GET /api/admin/ops/metrics/latest` (`GetOpsMetricsLatestUseCase`)

- `latest`: última linha por (resource, metric) nos últimos 15 min, sem `db_statement_total_ms`
  (`DISTINCT ON`, mesmo timeout de 2 s): `{ resource, kind, metric, value, at }`.
- Top consultas (`latestStatementSnapshot`): linhas do último `at` de `db_statement_total_ms`,
  numa única consulta sob o mesmo `statement_timeout` de 2 s.
- `thresholds`: `OPS_ALERT_THRESHOLDS` de `opsAlertPolicy` (`memoryPct`, `cpuPct`,
  `idleInTransaction`, `eventLoopP99Ms`). Não duplicar números no painel.
- `topQueries`: linhas do snapshot mais recente de `db_statement_total_ms` (top 10 do sampler),
  `{ queryid, shape, totalMs, meanMs, calls, at }`; `shape` é a forma truncada já gravada em
  `meta`. Snapshot antigo também aparece: conferir `at`.
- `samplerActive`: há amostra nos últimos 15 min (sampler ligado e gravando).
- `workers`: workers vivos de `worker_heartbeats` (mesmo formato da leitura bruta).
- `workerInstances` (desde api 0.87.0): uma linha por instância viva do serviço worker,
  `{ instance, resource, cpuPct, memoryPct, sampledAt, heartbeat: { workerId, sessions, pendingLogins, maxSessions, rssMb, seenAt } | null }`.
  Casamento puro em `metrics/domain/services/workerInstancesPolicy.ts` (`matchWorkerInstances`), sobre as mesmas
  linhas do `latest` e o mesmo `listAlive` (90 s); nada novo é lido e a Render não é chamada.
  - Amostra: `source='render'`, `cpu_pct`/`memory_pct`, `resource` = `WORKER_SCALER_SERVICE_ID` ou `<id>-<sufixo>`.
    Instância atual = amostra mais nova dela ≥ (mais nova do serviço − 2 min), o mesmo corte do painel; a trocada
    por deploy sai. Por métrica vale a amostra mais nova.
  - Batimento: o `workerId` padrão é `<HOSTNAME>-<pid>-<nonce>` e o HOSTNAME na Render é `srv-<id>-<hash>-<sufixo>`
    (ex.: `srv-dbq…670-5f44954c7b-4lx97-19-18faf21d` ↔ instância `srv-dbq…670-4lx97`). Tira-se o prefixo
    `<id>-` e os 2 últimos segmentos (pid, nonce); casa com a instância cujo sufixo é um desses segmentos
    **inteiro** (nunca substring: `4lx9` não casa `4lx97`). Vários batimentos na mesma instância (processo
    reiniciado ainda vivo) = vale o `seenAt` mais novo.
  - Instância sem batimento (adoção desligada, processo subindo): `heartbeat = null`. Batimento sem amostra
    atual (réplica nova antes do 1º tick do sampler): `resource`/`cpuPct`/`memoryPct` nulos, `instance` = último
    segmento do host. Batimento fora do serviço (api `all`, `WORKER_ID` manual) é ignorado.
  - Batimento vivo (TTL de 90 s do `listAlive`) de instância cortada pelos 2 min (troca por deploy, métrica da
    Render atrasada) **continua** como linha "Sem amostra" (CPU/RAM nulos): nenhuma sessão viva some da tela.
    Não descartar por sufixo.
  - Sem `WORKER_SCALER_SERVICE_ID` válido no `http`: lista vazia (sem worker separado).
  - O batimento não guarda início do processo: a tela mostra "visto há", não uptime. Uptime exigiria coluna nova.

Não fazer: balde no cliente sobre a leitura bruta paginada; aceitar `limit`/tamanho de balde do
cliente; métrica fora de `OPS_METRIC`; chamar a Render nessas rotas.

## Tela (painel, super admin)

Workers → aba **Consumo** (`/admin/workers/usage`; Ocupação segue em `/admin/workers`). Código em
`app/src/features/opsMetrics/` (desenho em `.specs/features/ops-metrics-dashboard/design.md`);
gráficos com `@mui/x-charts` 8.29.3 fixo, só no chunk lazy da aba.

- Filtros: período 1 h/6 h/24 h/7 dias (janela `from`/`to` pelo `serverNow()`; o balde é o que a
  API devolver), recurso Todos/API/Worker/Postgres (filtra só CPU/RAM) e atualização de 60 s (pausa com a
  aba do navegador oculta). Persistidos em `usePersistedState('workers.usage.filters')`, escopo `tab`.
- Busca `latest` + 3 chamadas de `series` (servidores, banco, workers; ≤ 12 métricas cada) em
  paralelo, erro por bloco. Counters viram taxa/total na tela (`rules.counterDeltas`: delta negativo
  = reinício, balde vazio). Vários `srv-` do mesmo tipo viram uma série com o pior valor.
- Status dos KPIs: limiares de `latest.thresholds` (Atenção a partir de 87,5% do limiar); cache hit
  tem faixa própria da tela (Ok ≥ 99, Crítico < 95). `RAM · API` em MB usa 2.048 MB (plano atual).
- `RAM · Worker` / `CPU · Worker` (`kind = worker_service`): mesma regra dos cartões da API, o
  **pior valor entre as instâncias** (% é por instância: cada uma tem o próprio limite; somar % não
  tem sentido). Com 2+ instâncias o contexto diz "pior de N instâncias". Sem MB (limite do worker
  não fixo na tela). Só contam instâncias atuais: amostra com `at` ≥ (mais nova do worker − 2 min)
  (`rules.currentValues`); a instância trocada por deploy, ainda nos 15 min do `/latest`, fica de
  fora do N e do pior valor. Os cartões só aparecem com amostra do worker; sem `WORKER_SCALER_SERVICE_ID`
  no `http` tudo segue em API. Nos gráficos de CPU e Memória de Servidores o Worker é a 2ª linha
  (3ª cor; pior instância por balde), separada da API.
- **Instâncias do worker** (app 0.107.0, `WorkerInstancesTable.tsx`): tabela abaixo dos gráficos de Servidores,
  uma linha por `workerInstances` (nome curto = sufixo, CPU %, RAM % com ícone + nome do status acima do limiar,
  nunca só cor nem texto colorido, sessões/teto
  com RSS no tooltip, logins em andamento, "visto há" do batimento ou, sem ele, da amostra). Chips "Sem batimento"/
  "Sem amostra" marcam o lado que falta. Aparece e some com as réplicas (dado do `/latest` a cada 60 s); sem worker
  separado não aparece. Segue o filtro Recurso (some em API/Postgres). Sem flag de borrar: só id de infraestrutura.
  Decisão em `workerInstancesSection` (`rules.ts`): skeleton carregando; `/latest` falhou = alerta; vazio com
  dado do worker = "Nenhuma instância online agora"; vazio com filtro só Worker e nenhum dado = "Worker não
  configurado". Carregando (skeleton com `role="status"`), erro e vazio ficam dentro do card, com o título.
  Linhas na ordem do nome curto (igual ao gráfico); em "Por instância" (até 3) um marcador `aria-hidden` mostra a
  cor da série, estável por instância (`assignInstanceColors`). 1ª coluna fixa; borda + sombra só quando a tabela
  está rolada. No `xs` os chips ficam só com ícone (palavra para leitor de tela, dica no tooltip, alvo de toque
  ≥ 44 px; a área invisível de 10 px pode cobrir a borda da linha vizinha, aceito); dicas com `describeChild` e foco por teclado; "Visto" = `instanceSeenAt`, tooltip com data completa
  (`formatFullDateTime`); "—" sempre em `text.secondary`; (i) de ajuda ao lado do título.
- **Worker nos gráficos** (alternância acima dos gráficos de Servidores, só com amostra do worker): "Pior instância"
  (padrão, comportamento anterior) × "Por instância" (uma linha por `resource` do `worker_service` no período,
  rotulada pelo sufixo; API e Postgres saem do gráfico para não passar de 3 cores; mais de 3 instâncias no período
  = só tabela). Cores de `chartColors().instances` (verde do Worker, roxo, magenta): nunca o azul da API nem o
  laranja do Postgres. Nos dois cards (CPU e Memória) o subtítulo vira "% do limite da instância" e a nota diz que
  API e Postgres ficam na visão "Pior instância". Persistida em `usePersistedState('workers.usage.workerView')`, escopo `tab`.
- Consultas: só `shape` (forma normalizada) do snapshot mais recente, sem flag de borrar (sem dado
  de cliente). Se a API mandar SQL não normalizado, é bug da API.

Não fazer: balde ou limiar fixo no front; chamar a Render pelo painel; importar o barrel de
`@mui/x-charts` ou tirá-lo do lazy; animação de gráfico (`skipAnimation` sempre); cor de status em
série; mais de 3 cores (mais de 3 workers = só tabela); persistir dado da API.

## Flags e variáveis (só na Render)

| Variável | Padrão | Uso |
|---|---|---|
| `OPS_METRICS_SAMPLER_ENABLED` | `false` | liga o sampler; só no serviço `worker` |
| `RENDER_API_KEY` | vazio | chave da Metrics API; sem ela (ou sem IDs: `RENDER_RESOURCE_IDS` + serviço worker de `WORKER_SCALER_SERVICE_ID`) a fonte Render fica de fora e o resto segue. Também usada pelo escalador dos workers ([`workers-escala.md`](workers-escala.md), Escala): com `WORKER_SCALER_ENABLED=true` passa a existir no `http` além do `worker`. Nunca no painel, nunca em log |
| `RENDER_RESOURCE_IDS` | vazio | `srv-…`/`dpg-…` separados por vírgula |
| `WORKER_SCALER_SERVICE_ID` | vazio | id `srv-…` do serviço worker (do escalador). No `worker`, o sampler o coleta automaticamente além de `RENDER_RESOURCE_IDS` (sem duplicar; réplicas incluídas). No `http`, separa as amostras da Render do worker (`worker_service`) das da API no Consumo. Inválido = ignorado |
| `OPS_MEMORY_LIMIT_MB` | vazio | limite de RAM para o alerta de RSS quando a Render não dá `memory-limit` |
| `INFRA_COST_SNAPSHOT_ENABLED` | `false` | liga o `InfraCostSnapshotJob` dos custos ([`custos-infraestrutura.md`](custos-infraestrutura.md)); só no `worker` |
| `INFRA_COST_RENDER_RESOURCES` | vazio | `api=srv-<id>,worker=srv-<id>,static=srv-<id>,postgres=dpg-<id>,redis=red-<id>`, só no `worker`; sem `worker=` usa `WORKER_SCALER_SERVICE_ID`. Entrada inválida ignorada com `warn` sem o id |

Custo no worker dono, por minuto: 4 GETs à Render (`cpu`, `cpu-limit`, `memory`, `memory-limit`,
timeout 5 s cada) + consultas de catálogo do PG. Zero no `http` para métricas. Recorte: só as rotas de escala
(`/admin/workers/scale`, escalador ligado) chamam a Render a partir do `http`, com cache de 30 s no `GET` e timeout de
5 s; as rotas de métricas e capacidade continuam sem chamada à Render.

**Job de custos** (`InfraCostSnapshotJob`, api 0.89.0): outro job do `worker` que fala com a Render, separado do
sampler (lease `infra-cost-snapshot`, tick 5 min). Por hora cheia: plano, instâncias e disco de cada recurso de
`INFRA_COST_RENDER_RESOURCES`, banda da hora fechada há mais de 1 h; 1×/dia os deploys do dia anterior e a cotação do
BCB. Instâncias do worker vêm das amostras de `ops_metrics_samples` deste coletor (Render só como fallback). Timeout 5 s,
429 respeita `Retry-After`. A regra segue: **nenhuma rota de métricas ou de custos chama a Render**; `/admin/costs` lê só
as tabelas gravadas pelo job.

**Antes de ligar**: conferir numa resposta real da Render a unidade (`unit`) e os labels das
séries (`instance`/`resource`/`service`). O `%` vem da razão uso/limite da mesma série, mas o valor
absoluto de `cpu`/`memory` só tem sentido com a unidade confirmada. Série sem `resource`/`service`
é descartada e contada: warn `render metrics series without resource label discarded` na 1ª vez por
endpoint (depois debug), com `path` e `discardedSeries`. Vários ids vão em `resource=a,b` (exemplo
da doc); a descrição da Render fala em parâmetro repetido e o OpenAPI não define `style`/`explode`.
Se a resposta real vier vazia com mais de um id, trocar por `resource` repetido.

## Alertas (MQ-24)

Limiares em `metrics/domain/services/opsAlertPolicy.ts`: RAM ≥ 80% do limite, CPU ≥ 80% por 5 min
(5 ticks), `idle in transaction` ≥ 3, p99 do event loop ≥ 200 ms. Um alerta por motivo, silêncio
de 30 min por motivo no cluster via lease `ops-alert:<reason>`. `session_occupancy` (WSCALE-17): `sessions_connected ÷
sessions_capacity > alertOccupancyRatio` do tick, só com a adoção desligada (com ela o `WorkerCapacityAlertJob` cobre); o log sai com `metric: 'sessions_occupancy_pct'` (percentual derivado, não gravado). **Só log** (`ops metrics alert`):
não há notifier de produção nem template de e-mail na central; e-mail entra quando o template existir.

## Ativação e reversão

Migrations no boot normal. Ligar `OPS_METRICS_SAMPLER_ENABLED=true` só no worker, após
`RENDER_API_KEY`/`RENDER_RESOURCE_IDS` e a conferência da unidade. Reverter: flag `false`; a tabela
fica e a retenção não roda mais (apagar à mão só com autorização).

## O que não fazer

- APM externo (Datadog, New Relic, etc.) ou agente extra no container.
- Endpoint `/metrics` público (Prometheus) no processo `http`.
- Medir em requisição de usuário ou chamar a Render ao vivo numa rota de métricas/capacidade (exceção única: rotas de
  escala dos workers, cache 30 s e timeout 5 s; ver `workers-escala.md`).
- Estado operacional em memória sem tabela: o ring buffer é cache de `ops_metrics_samples`
  (exceção declarada em `docs/arquitetura-escala.md`, §3.7); alerta/cooldown nunca em memória.
- Tenant, PII ou SQL bruto em `ops_metrics_samples` (só forma normalizada truncada em `meta.shape`).
- Expor `RENDER_API_KEY` ao painel ou à resposta da rota.
