# Gestão de escala dos workers

Super admin ajusta o teto de sessões por worker e os limiares de alerta pelo painel, sem redeploy.
Spec: [`.specs/features/worker-scaling/`](../.specs/features/worker-scaling/spec.md) (WSCALE-01..10, 17, 19). Arquitetura:
[`arquitetura-escala.md`](arquitetura-escala.md) §3.2. Configuração na P1 (api 0.82.0 · app 0.101.0); capacidade e
alerta de ocupação sem adoção na P2 (api 0.83.0 · app 0.102.0); escala manual pelo super admin na P3 (api 0.84.0 ·
app 0.103.0, desligada por env); subida automática (P4) ainda não existe.

## Onde fica

- Valor: `platform_settings`, chave `worker_scaling` (JSON). Sem tabela própria, um valor para todas as réplicas (D1).
- Domínio: `sessions/domain/services/workerScalingSettings.ts` (faixas, defaults, `resolveEffectiveSettings`).
- Provider: `RefreshingWorkerScalingSettingsProvider` via `workerScalingSettingsProvider()` (`sessionLeaseContainer.ts`),
  singleton em todo papel; `server.ts` faz `refresh()` + `start()` no boot e `stop()` no shutdown.
- Rotas (super admin): `GET`/`PUT /admin/workers/settings`. Tela: aba **Configuração** em `/admin/workers/settings`.
  Escala (P3): `GET`/`POST /admin/workers/scale`, `GET /admin/workers/scale/events`; aba **Escala** em `/admin/workers/scale`.

## Campos e faixas

| Campo | Faixa | Default sem linha salva |
|---|---|---|
| `maxSessionsPerWorker` | 1–1000 | `WORKER_MAX_SESSIONS` (40) |
| `maxPendingLoginsPerWorker` | 1–500 | `WORKER_MAX_PENDING_LOGINS` (50) |
| `alertOccupancyRatio` | 0,5–0,95 | 0,8 |
| `awaitingAlertSeconds` | 30–3600 | 120 |
| `scalerMode` | `off`\|`manual`\|`auto` | `off` |
| `minReplicas` / `maxReplicas` | 1–20, `max ≥ min` | 1 / 1 |
| `scaleUpSustainSeconds` | 300–3600 | 900 |
| `scaleCooldownSeconds` | 300–86400 | 1800 |

Inteiros exceto o ratio; sem coerção de string. Campo desconhecido, tipo errado ou fora da faixa → 400
`INVALID_WORKER_SCALING_SETTINGS` com `meta.field`. `PUT` exige o objeto completo. `scalerMode` e réplicas só ficam
guardados na P1; a P3 passa a usá-los no `POST /scale` (seção Escala).

## De onde vem o valor

- Sem linha salva: o default acima (comportamento de antes). `WORKER_MAX_*` viram **só valor inicial** (D2), lidos
  apenas em `workerScalingEnvDefaults()` (`shared/config/workerAdoption.ts`).
- Salvo, o banco vence a env campo a campo. A resposta traz `origin[campo] = default|saved`.
- Provider: `current()` síncrono; refresh a cada 30 s (`unref`) e na hora no processo que salvou.
- Linha salva inválida (não-objeto ou objeto inválido): `GET` e provider usam o default da env (origem `default`);
  o `GET` devolve o `updatedAt` real, então o `PUT` regrava. O `warn` (uma vez por sequência, sem o conteúdo) sai do
  refresh do provider, não do `GET`.
- Erro de leitura do banco: o provider mantém o último valor bom. Boot com leitura lenta espera no máximo 5 s e segue
  com a env.
- Env acima da faixa (`WORKER_MAX_SESSIONS` > 1000, `WORKER_MAX_PENDING_LOGINS` > 500) é limitada ao teto, com aviso no log.
- Mudança vale em todas as réplicas em até 30 s, sem reinício.

## Efeito

- Consumidores leem o provider **a cada uso**: gate do lease (`CapacityLimitedLeaseGate` recebe função), ticker de
  adoção, fila `session-open` (`roleComposition.ts`), `WorkerHeartbeatJob` (teto gravado) e `WorkerCapacityAlertJob`
  (ratio e segundos).
- `enforced` = adoção ligada no processo (`WORKER_ADOPTION_ENABLED`) **ou** batimento vivo de algum worker. **Limite conhecido:** sem adoção o gate com teto nem é criado e não há heartbeat;
  a configuração só é guardada e mostrada (faixa "sem efeito" na tela). Vale quando a adoção for ligada (D12).
- Reduzir o teto abaixo das sessões atuais **não derruba** sessão: o worker só para de adotar (ocupação > 100%). Aumentar
  libera vaga no próximo tick (D3).

## Gravação

- `PUT` com `expectedUpdatedAt` (o `updatedAt` do `GET`; `null` sem linha). Outro admin salvou antes → 409
  `WORKER_SCALING_SETTINGS_CONFLICT`; a tela recarrega e descarta o rascunho.
- Grava `updatedById` e auditoria `WORKER_SCALING_SETTINGS_CHANGED` com `before`/`after` (migration
  `20261111140000_add_audit_action_worker_scaling`, que também cria `WORKER_SCALE_REQUESTED` para a P3).
- Tela: confirmação com o diff; mudar o teto pede digitar o valor novo (sem medição de RAM na P1, regra "não subir o teto
  sem medir", `arquitetura-escala.md` §6); aviso se o teto fica abaixo das sessões do worker mais ocupado (só com batimentos; sem batimento não há aviso, o total do cluster não é ocupação por worker); rascunho em `usePersistedState`
  (`workers.settings.draft`, escopo `tab`), limpo ao salvar. Texto da confirmação distinto para subir (risco de memória)
  e reduzir (não derruba sessão, só para de adotar). Campo editado mostra a origem "Alterado"; razão exibida com vírgula
  (`formatDraftValue`), digitação aceita `.` ou `,`. Sem botão de suporte na aba (`SUPPORT_CHAT_HIDDEN_PATHS`).

Sem flag de privacidade: a tela só mostra números da plataforma, nenhum dado de cliente, grupo ou produto.

## Capacidade (P2)

Rota `GET /admin/workers/capacity` (super admin, `GetWorkerCapacityUseCase`); aba **Capacidade** em
`/admin/workers/capacity`. Só tabelas locais (`tenants`/`sessions` agregados e `ops_metrics_samples`), nunca a Render,
nenhum dado de tenant individual.

**Fonte**: o coletor (`OpsMetricsSamplerJob`, [`ops-metricas.md`](ops-metricas.md)) coleta a cada tick (60 s) e grava a média de 5 min
das métricas `sessions_*` (exceto `sessions_capacity`, gravada pelo último valor da janela: depois de mudar o teto a aba não mostra número misturado) (fonte `sessions`, recurso `cluster`) em `all` e `worker`, com ou sem adoção. Sem
`OPS_METRICS_SAMPLER_ENABLED` não há amostra e a aba mostra "sem amostra" em vez de número. Falha ou timeout (2 s) só
da contagem de aguardando omite `sessions_awaiting` daquele tick (`warn` uma vez por sequência de falhas); as outras três
métricas e o alerta de ocupação seguem.

**Limite sem adoção**: `sessions_capacity` = teto × processos donos de lease (mínimo 1). Processo vivo sem sessão não
entra na soma. Em 2026-11-11 a produção rodava 1 processo `all`, caso coberto pelo mínimo 1; com vários processos, ligar a
adoção para a capacidade vir dos batimentos.

| Número | Significado |
|---|---|
| `capacity` | última `sessions_capacity` da janela de 1 h. Com adoção: soma dos tetos dos batimentos vivos. Sem adoção: teto × processos que mantêm sessões (donos de lease vivo; mínimo 1; processo sem sessão não conta). A ajuda do cartão escolhe o texto por `enforced` |
| `connected` — "Conectadas (banco)" | última `sessions_connected`: **todas** as sessões `CONNECTED` com lease vivo, contadas no banco (inclui tenant suspenso). A tabela por plano conta só tenants `ACTIVE`: a soma das linhas pode ficar abaixo do cluster. A aba **Ocupação** segue com a soma dos batimentos (socket ao vivo); as duas podem diferir por segundos |
| `occupancyPct`, `headroom` | `connected ÷ capacity × 100` (0 sem capacidade); folga = `max(0, capacity − connected)` |
| `requiredReplicas` | `ceil(connected ÷ (teto × alertOccupancyRatio))`, mínimo 1 |
| `mbPerSession` | média da `memory` da Render convertida para MB (`meta.unit`; a Render grava bytes) ÷ média de `sessions_connected`, ambas na janela de 1 h |
| `memoryLimitMb` | `memory ÷ (memory_pct ÷ 100)` da amostra mais recente (o limite não é gravado) |
| `stale` | `true` quando a última amostra tem mais de 10 min (coletor parado ou atrasado). A aba avisa "Última amostra há N min" (N por `serverNow()`, nunca `Date.now()`). Opcional no tipo do painel (API antiga não manda) |
| `suggestedMaxSessions` | `floor(0,7 × memoryLimitMb ÷ mbPerSession)` (`capacityPlan.ts`) |
| por plano | `tenants` `ACTIVE`, `contracted`/`unlimitedTenants`/`created`/`connected` por canal (`PrismaWorkerCapacityReader`, uma consulta, `statement_timeout` 2 s) |

- Memória: só recursos `srv-` da fonte `render`. O recurso gravado é por instância, `srv-<id>-<sufixo>` (confirmado em
  produção, leitura de 2026-11-11); as instâncias são somadas por `at`. Com `WORKER_SCALER_SERVICE_ID` válido (P3) a
  memória usa só esse serviço (id igual ou prefixo `<id>-`; sem casamento → `null`). Sem ele, mais de um `srv-` em
  `RENDER_RESOURCE_IDS` → `mbPerSession`, `memoryLimitMb` e `suggestedMaxSessions` `null` (não há como saber qual roda
  sessões). Sem métrica da Render ou sem sessões → `null`.
- Contratado: valor de `tenant_entitlements`. Número JSON = limite. String = limite só se casar
  `^\s*[0-9]{1,9}(\.[0-9]+)?\s*$` (decimal com casas aceito, ex.: `"5.5"`). Qualquer outra string (hex `0x…`, sinal,
  notação científica `1e3`, mais de 9 dígitos, `.5`), ausente ou `null` = **ilimitado** na aba (contado em
  `unlimitedTenants`). **Difere** de `CreateSessionUseCase` (`PrismaEntitlementReader.toNumber`, que usa `Number()` e
  aceita hex/notação científica): a aba é só leitura e conta essas strings como ilimitadas. `planSlug` nulo = grupo "Sem plano".
- Projeção "cabem mais N clientes" (`rules.clientsThatFit`): `floor(folga ÷ sessões contratadas pelo tenant médio)`.
  Plano com tenant ilimitado, sem tenant, sem contratado ou sem folga medida → "—". É projeção, não reserva vaga, e
  **isolada por plano**: cada linha usa a folga inteira, então não se soma entre planos.
- Série de 7 dias (sessões × capacidade) vem de `GET /admin/ops/metrics/series` (`sessions_connected`,
  `sessions_capacity`); a rota de capacidade não devolve série.
- Par usado para ocupação nas amostras: `sessions_connected` = média dos 5 ticks (`meta.agg: 'avg'`),
  `sessions_capacity` = último tick (`meta.agg: 'last'`). No bucket em que o teto muda a razão mistura os dois
  (aceito: o job da P4 usa várias amostras, não uma).
- Aba **Configuração** lê `suggestedMaxSessions` daqui: confirmação reforçada (digitar o valor) **só** quando o teto novo
  passa do sugerido ou não há sugestão (sem amostra ou rota fora). Reduzir o teto (mesmo acima do sugerido) usa título
  neutro e o texto de redução. Enquanto a medição carrega (`suggestedState: 'loading'`), "Revisar e salvar" fica
  desabilitado com "Carregando medição…" se o teto mudou; a tela não afirma ausência de medição antes da resposta. A
  medição tem teto de 8 s (`CAPACITY_TIMEOUT_MS`): resposta pendurada vira `unavailable` (confirmação reforçada) e a
  resposta tardia é ignorada. Sem
  formulário na aba Capacidade: só a aba na URL.

## Escala (P3)

Aba **Escala** (`/admin/workers/scale`): réplicas atuais × desejadas, estado do escalador (com a lista de envs que
faltam quando `not_configured`), subir/reduzir com diálogo e motivo obrigatório (3–200), `CooldownBar` até o fim do
intervalo mínimo e histórico paginado. Rascunho (alvo + motivo) em `usePersistedState('workers.scale.draft')`.
Com rascunho guardado, "Subir 1"/"Reduzir 1" com alvo diferente do rascunho começam um pedido novo (motivo vazio,
`requestId` novo); com o mesmo alvo, "Revisar" ou "Escolher alvo", reabrem o rascunho (mesmo `requestId`, "Reenviar").
A reabertura automática do rascunho restaurado espera a 1ª leitura com o escalador `ready`. Replay de evento ainda
`requested` não é sucesso: aviso "em andamento ou interrompido; confira o histórico" e o rascunho fica.

Código: `IWorkerScaler` + `sessions/infrastructure/scaler/` (`RenderWorkerScaler`, `NotConfiguredWorkerScaler`,
`workerScaler()` singleton), `ScaleWorkersUseCase` (regras), `RequestWorkerScaleUseCase` (rota: conta conectadas pela
última amostra `sessions_connected`), `GetWorkerScaleStateUseCase`, `ListWorkerScaleEventsUseCase`, tabela
`worker_scale_events` (migration `20261111150000_create_worker_scale_events`).

Envs (nos serviços `http` **e** `worker`: as rotas rodam no `http`, o job da P4 no `worker`):

| Env | Default | Uso |
|---|---|---|
| `WORKER_SCALER_ENABLED` | `false` | kill switch (D8). Saída da P3/P4 com `false` (D10); ligar só depois do T25 |
| `WORKER_SCALER_SERVICE_ID` | vazio | `srv-…` do Private Service `worker`. Fora de `^srv-[a-z0-9]+$` conta como ausente (1 `warn` sem o valor), não derruba o boot |
| `RENDER_API_KEY` | vazio | a mesma da Metrics API; passa a existir também no `http` quando o escalador for ligado |

Sem as três: estado `not_configured` com `missing` (nomes, nunca valores) e nenhuma chamada sai. Render: `GET
/v1/services/{id}`, `/instances`, `POST /scale` `{ numInstances }`; timeout 5 s, 429 respeita `Retry-After`; chave só
no header.

`POST /admin/workers/scale` `{ replicas, reason, requestId (uuid) }`. Regras na ordem do use case:

1. `scalerMode = off` → 409 `SCALER_MODE_OFF`.
2. Adoção desligada → 409 `ADOPTION_DISABLED`. Adoção = flag local **ou** batimento vivo de worker com adoção (o mesmo
   `enforced` da tela; com `http`/`worker` separados a flag mora só no worker).
3. Fora de `[minReplicas, maxReplicas]` → 400 `SCALE_TARGET_OUT_OF_RANGE`. `maxReplicas` ≤ 20 no código (D5).
4. Estado do escalador ao vivo: `not_configured` → 409 `SCALER_NOT_CONFIGURED` (`missing`); provedor fora → 503
   `SCALER_UNAVAILABLE` (`reason`) ou 429 `SCALER_RATE_LIMITED`.
5. Serviço com disco ou autoescala nativa da Render → 409 `SCALER_SERVICE_NOT_SCALABLE` (`disk`|`native_autoscaling`).
6. Automático (P4) só `atual + 1`.
7. Intervalo `scaleCooldownSeconds` desde o último `requested` ou `succeeded` → 409 `SCALE_COOLDOWN_ACTIVE` (`retryAt`).
8. Redução só se `floor(réplicas × teto × alertOccupancyRatio) ≥ conectadas` → 409 `SCALE_DOWN_WOULD_EXCEED_CAPACITY`
   com os números.
9. Alvo igual ao atual → 409 `SCALE_TARGET_UNCHANGED`.

- Motivo validado depois do `trim` (3–200, contado por code point com `Array.from`) no `RequestWorkerScaleUseCase`
  → 400 `INVALID_SCALE_REASON` (`field: 'reason'`). O schema da rota só barra vazio (`pattern`) e acima de 1000
  (teto de segurança): medir 3–200 lá recusaria um motivo válido com espaços nas pontas. O repositório trunca por
  code point (nunca parte emoji).
- **Serialização**: a regra 7 é checada cedo (para `checkPreconditions` e para recusar sem lock) e de novo em
  `recordRequestedIfIdle`, que lê o último `requested|succeeded` e grava `requested` numa transação com
  `pg_advisory_xact_lock(hashtextextended('worker-scale-request', 0))` (chave fixa: um recurso só). Dois `POST` com
  `requestId` diferentes ao mesmo tempo: um grava, o outro recebe `{ blocked: retryAt }` → `rejected` + 409
  `SCALE_COOLDOWN_ACTIVE`. Vale entre réplicas do `http` (o lock é do Postgres).
- **Replay estrito** por `requestId`: mesmo id com o mesmo alvo, motivo (após `trim`) e ator devolve o evento gravado
  (`replayed: true`) sem chamar a Render, **inclusive `failed`**; com qualquer um deles diferente → 409
  `REQUEST_ID_REUSED`. Por isso um pedido `failed` não é reenviado com o mesmo `requestId`: o painel gera outro id
  para tentar de novo. Replay concorrente (dois `POST` com o mesmo `requestId` ao mesmo tempo): sob o lock e
  **antes** do intervalo, `recordRequestedIfIdle` procura o `requestId` e devolve `{ existing }`; o use case aplica a
  mesma comparação (replay ou `REQUEST_ID_REUSED`), sem `rejected` espúrio nem 409 de intervalo. A unicidade segue
  como rede de segurança.
- Evento antes da chamada: `requested` → `scaleTo` (sem retry) → `succeeded` ou `failed` (`error` = código interno
  curto, nunca mensagem do provedor). Recusa grava `rejected` **sem** `requestId` (pode ser refeita).
- **Erro genérico**: erro do `scaleTo` fora de `AppError` vira 503 `SCALE_REQUEST_FAILED` sem a mensagem original
  (evento `failed` com `error = SCALE_REQUEST_FAILED`, `warn` só com o id do evento e o código).
- **Sucesso mesmo com falha de escrita**: se `updateOutcome(succeeded)` ou a auditoria lançar depois do `scaleTo`
  aceito, `warn` (sem segredo) e a resposta é de sucesso com o evento `succeeded` em memória. A linha pode ficar
  `requested` no banco: ela continua contando para o intervalo mínimo (regra 7), o que é o lado seguro.
- **`Retry-After`**: `SCALER_RATE_LIMITED` (429) leva `meta.retryAfterSeconds` e `meta.retryAt` (ISO); o
  `errorHandler` põe o header a partir de `retryAt`. Vale para o 429 do `scaleTo` e para o estado ao vivo
  `unavailable/rate_limited` (que carrega `retryAfterSeconds`). O header está em `CORS_EXPOSED_HEADERS`
  (`app/corsPolicy.ts`) para o painel de outra origem ler. Sem `Retry-After` do provedor, `retryAt` é `null` e
  não há header.
- Histórico (`GET /scale/events`, cursor opaco) sem ator: só `Manual`/`Automática`. Quem pediu fica na auditoria
  `WORKER_SCALE_REQUESTED` (`succeeded`/`failed`). Retenção 180 dias (limpeza no job da P4).
- `GET /scale`: estado do escalador em cache de 30 s por processo (`WorkerScalerStateCache`); o `POST` lê ao vivo e
  invalida o cache em `finally` (aceito ou recusado). O cache só alimenta a tela, nunca decisão.
- Descida só manual (D4); a Render escolhe qual instância encerra (`SIGTERM` + grace).
- **T25 pendente (dono)**: smoke real num Private Service de teste na Render (subir 1→2, reduzir 2→1, `SIGTERM`,
  `maxShutdownDelaySeconds`). Obrigatório antes de ligar `WORKER_SCALER_ENABLED` em produção; resultado anotado aqui.

## Alerta de ocupação sem adoção

Com a adoção desligada (`all` ou `worker`) o `WorkerCapacityAlertJob` não roda; o coletor avalia `sessions_connected ÷
sessions_capacity > alertOccupancyRatio` a cada tick (motivo `session_occupancy` em `opsAlertPolicy.ts`; o valor e o
limiar do log saem em percentual, não em fração, com `metric: 'sessions_occupancy_pct'`). **Só log**
(`ops metrics alert`), com o dedupe do coletor (lease `ops-alert:session_occupancy`, silêncio de 30 min). Com adoção o
coletor não alerta ocupação (o `WorkerCapacityAlertJob` já cobre).

## O que não fazer

- Ler `WORKER_MAX_SESSIONS`/`WORKER_MAX_PENDING_LOGINS` (ou `env.WORKER_MAX_*`) em código novo: use `current().value`.
- Guardar o número do provider em construtor, campo ou closure criada fora da função que checa: passe a função
  (`() => provider.current().value`) e leia no uso.
- Fazer I/O no construtor do provider ou criar outra instância: só `workerScalingSettingsProvider()`.
- Aplicar o teto sem adoção ou derrubar sessão acima do teto novo.
- Gravar `worker_scaling` direto no banco (sem auditoria nem validação); linha inválida cai no default da env (não no último valor salvo).
- Teto por instância: `workerId` muda a cada boot.
- Somar `memory` de recurso `dpg-` (Postgres) na conta de MB por sessão ou chamar a Render na rota de capacidade.
- Comparar "Conectadas (banco)" com a aba Ocupação como se fossem a mesma conta.
- Alertar ocupação no coletor com a adoção ligada (duplica o `WorkerCapacityAlertJob`).
- Chave, id do serviço ou corpo da Render em log, evento ou resposta (só operação, status e código interno).
- Reusar um `requestId` para outro pedido (alvo/motivo diferente) ou para tentar de novo um `failed`: gere outro.
- Checar o intervalo e gravar `requested` fora de `recordRequestedIfIdle` (perde a serialização).
- Relançar erro cru do escalador ou gravar a mensagem dele no evento: só o código interno.
- Retry automático de `scaleTo` (o evento `requested` já conta o intervalo; repetir duplica custo).
- Ligar `WORKER_SCALER_ENABLED` em produção sem o T25, ou localmente (`api/.env` aponta para produção).
- Escalar serviço com disco ou com a autoescala nativa da Render ligada.
- Chamar a Render nas rotas de métricas/capacidade: só as rotas de escala chamam (cache 30 s, timeout 5 s).
