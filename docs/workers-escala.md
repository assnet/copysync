# Gestão de escala dos workers

Super admin ajusta o teto de sessões por worker e os limiares de alerta pelo painel, sem redeploy.
Spec: [`.specs/features/worker-scaling/`](../.specs/features/worker-scaling/spec.md) (WSCALE-01..10, 17, 19). Arquitetura:
[`arquitetura-escala.md`](arquitetura-escala.md) §3.2. Configuração na P1 (api 0.82.0 · app 0.101.0); capacidade e
alerta de ocupação sem adoção na P2 (api 0.83.0 · app 0.102.0); escalador e subida automática (P3–P4) ainda não existem.

## Onde fica

- Valor: `platform_settings`, chave `worker_scaling` (JSON). Sem tabela própria, um valor para todas as réplicas (D1).
- Domínio: `sessions/domain/services/workerScalingSettings.ts` (faixas, defaults, `resolveEffectiveSettings`).
- Provider: `RefreshingWorkerScalingSettingsProvider` via `workerScalingSettingsProvider()` (`sessionLeaseContainer.ts`),
  singleton em todo papel; `server.ts` faz `refresh()` + `start()` no boot e `stop()` no shutdown.
- Rotas (super admin): `GET`/`PUT /admin/workers/settings`. Tela: aba **Configuração** em `/admin/workers/settings`.

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
guardados na P1 (escalador é P3/P4).

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
  sem medir", `arquitetura-escala.md` §6); aviso se o teto fica abaixo da ocupação atual; rascunho em `usePersistedState`
  (`workers.settings.draft`, escopo `tab`), limpo ao salvar. Texto da confirmação distinto para subir (risco de memória)
  e reduzir (não derruba sessão, só para de adotar). Campo editado mostra a origem "Alterado"; razão exibida com vírgula
  (`formatDraftValue`), digitação aceita `.` ou `,`. Sem botão de suporte na aba (`SUPPORT_CHAT_HIDDEN_PATHS`).

Sem flag de privacidade: a tela só mostra números da plataforma, nenhum dado de cliente, grupo ou produto.

## Capacidade (P2)

Rota `GET /admin/workers/capacity` (super admin, `GetWorkerCapacityUseCase`); aba **Capacidade** em
`/admin/workers/capacity`. Só tabelas locais (`tenants`/`sessions` agregados e `ops_metrics_samples`), nunca a Render,
nenhum dado de tenant individual.

**Fonte**: o coletor (`OpsMetricsSamplerJob`, [`ops-metricas.md`](ops-metricas.md)) coleta a cada tick (60 s) e grava a média de 5 min
das métricas `sessions_*` (fonte `sessions`, recurso `cluster`) em `all` e `worker`, com ou sem adoção. Sem
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
  produção, leitura de 2026-11-11); as instâncias são somadas por `at`. Mais de um `srv-` em `RENDER_RESOURCE_IDS` →
  `mbPerSession`, `memoryLimitMb` e `suggestedMaxSessions` `null` (não há como saber qual roda sessões; o filtro por
  `WORKER_SCALER_SERVICE_ID` é da P3). Sem métrica da Render ou sem sessões → `null`.
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
- Aba **Configuração** lê `suggestedMaxSessions` daqui: confirmação reforçada (digitar o valor) **só** quando o teto novo
  passa do sugerido ou não há sugestão (sem amostra ou rota fora). Reduzir o teto (mesmo acima do sugerido) usa título
  neutro e o texto de redução. Enquanto a medição carrega (`suggestedState: 'loading'`), "Revisar e salvar" fica
  desabilitado com "Carregando medição…" se o teto mudou; a tela não afirma ausência de medição antes da resposta. A
  medição tem teto de 8 s (`CAPACITY_TIMEOUT_MS`): resposta pendurada vira `unavailable` (confirmação reforçada) e a
  resposta tardia é ignorada. Sem
  formulário na aba Capacidade: só a aba na URL.

## Alerta de ocupação sem adoção

Com a adoção desligada (`all` ou `worker`) o `WorkerCapacityAlertJob` não roda; o coletor avalia `sessions_connected ÷
sessions_capacity > alertOccupancyRatio` a cada tick (motivo `session_occupancy` em `opsAlertPolicy.ts`; o valor e o
limiar do log saem em percentual, não em fração). **Só log**
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
