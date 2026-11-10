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

- **Sampler**: `OpsMetricsSamplerJob` (`api/src/modules/metrics/infrastructure/jobs/`), tick de
  60 s com `unref()`, só em `worker`/`all`. Um dono por vez no cluster: lease `ops-metrics-sampler`
  (`IJobLease`), TTL 45 s (menor que o tick), solto no `stop()`. Coleta limitada a 30 s
  (`OPS_TICK_TIMEOUT_MS`, `AbortSignal.timeout`): estourou, a amostra do tick é descartada. Antes do
  `persist` o lease é renovado (`release` + `tryAcquire`, pois `tryAcquire` só pega lease vencido);
  se outro processo virou dono, não grava. Não remover essa renovação nem subir o teto acima do TTL.
- **Persistência**: ring buffer de 60 leituras em memória, agregado e gravado em
  `ops_metrics_samples` a cada 5 ticks (gauge = média; counter = último valor; `meta` = min/max/n/unit).
- **Retenção**: 7 dias; o próprio tick apaga `at < now() - 7d` (índice `ops_metrics_samples(at)`)
  em lotes de 5 mil por `ctid`, cada lote com `SET LOCAL statement_timeout = '2s'`, no máximo 10 lotes
  por tick (pior caso 20 s, dentro do lease renovado). Backlog maior escoa nos ticks seguintes.
  Nunca `deleteMany` sem limite.
- **Leitura**: `GET /api/admin/ops/metrics?metric=&from=&to=&cursor=` só super admin
  (`metrics/presentation/routes/opsMetrics.routes.ts`). Lê só `ops_metrics_samples` e o estado
  atual de `worker_heartbeats`; nunca chama a Render. Janela padrão 24 h, máximo 7 dias; página de
  500 decidida pelo servidor; o cliente repete `from`/`to` devolvidos em `window` junto do
  `nextCursor` (cursor de outra janela recomeça do início). Sem tela: ler pela rota/Render.

## Flags e variáveis (só na Render)

| Variável | Padrão | Uso |
|---|---|---|
| `OPS_METRICS_SAMPLER_ENABLED` | `false` | liga o sampler; só no serviço `worker` |
| `RENDER_API_KEY` | vazio | chave da Metrics API; sem ela (ou sem IDs) a fonte Render fica de fora e o resto segue. Nunca no painel, nunca em log |
| `RENDER_RESOURCE_IDS` | vazio | `srv-…`/`dpg-…` separados por vírgula |
| `OPS_MEMORY_LIMIT_MB` | vazio | limite de RAM para o alerta de RSS quando a Render não dá `memory-limit` |

Custo no worker dono, por minuto: 4 GETs à Render (`cpu`, `cpu-limit`, `memory`, `memory-limit`,
timeout 5 s cada) + consultas de catálogo do PG. Zero no `http`.

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
de 30 min por motivo no cluster via lease `ops-alert:<reason>`. **Só log** (`ops metrics alert`):
não há notifier de produção nem template de e-mail na central; e-mail entra quando o template existir.

## Ativação e reversão

Migrations no boot normal. Ligar `OPS_METRICS_SAMPLER_ENABLED=true` só no worker, após
`RENDER_API_KEY`/`RENDER_RESOURCE_IDS` e a conferência da unidade. Reverter: flag `false`; a tabela
fica e a retenção não roda mais (apagar à mão só com autorização).

## O que não fazer

- APM externo (Datadog, New Relic, etc.) ou agente extra no container.
- Endpoint `/metrics` público (Prometheus) no processo `http`.
- Medir em requisição de usuário ou chamar a Render ao vivo numa rota.
- Estado operacional em memória sem tabela: o ring buffer é cache de `ops_metrics_samples`
  (exceção declarada em `docs/arquitetura-escala.md`, §3.7); alerta/cooldown nunca em memória.
- Tenant, PII ou SQL bruto em `ops_metrics_samples` (só forma normalizada truncada em `meta.shape`).
- Expor `RENDER_API_KEY` ao painel ou à resposta da rota.
