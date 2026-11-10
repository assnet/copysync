# Tarefas de implementação

**Design:** [design.md](design.md) · **Status:** T1–T18 implementadas (commits e763f73..HEAD, api 0.74.0); gates de produção em validation.md.
**Ferramentas:** shell/`rg`, TLC e `/caveman-review`; Postgres somente local descartável nos testes.
Nenhuma tarefa autoriza alterar produção, ativar flags, publicar ou trocar papéis.

## Plano de execução

Grafo de dependências diretas (lista de arestas; execução serial para economizar RAM):

```text
T1 → T2 → T3 → T4 → T5
T5 → T6 → T7 → T8
T5 → T9 → T10 → T11
T5, T8, T11 → T12
```

A = T1–T5, entrega independente e recomendada primeiro. B = T6–T8, condicional após medir A.
C = T9–T11, condicional se a espera desigual persistir. T12 fecha apenas as entregas escolhidas:
para release só de A, dependências T8/T11 devem estar formalmente **diferidas**, nunca marcadas feitas.
O grafo completo acima é para A+B+C; para A apenas, o grafo reduzido é `T1→T2→T3→T4→T5→T12`.
Sem `[P]`: revisão pode usar dois subagentes de leitura; testes/carga/integração sempre seriais.

### T1 — Contexto cooperativo e observação de capturas

**What / Where:** alterar apenas a unidade `ProcessPendingCapturedOffersUseCase` e seu teste
co-localizado (`api/src/modules/automation/application/use-cases/`).
**Depends on:** nenhuma. **Reuses:** logger, relógio injetado, `sourceKey`, stale existente.
**Requirement:** MQ-04/05/06. **Tests:** unit. **Gate:** quick API + alvo de captura abaixo.

**Done when / Verify:**
- [ ] Sinal opcional impede início de novo claim/enqueue; sinal após enqueue permite `markQueued`.
- [ ] Claim em voo ao parar deixa item recuperável; parada não vira FAILED/INTERNAL_ERROR.
- [ ] Testes provam até três itens, orçamento entre itens, não cancelamento de I/O, recuperação por
  sourceKey, idades/durações com relógio injetado e ausência de dados sensíveis nos novos logs.
- [ ] Asserções de janelas/validade/IA/cross-session existentes preservadas; medir contagem-base B1,
  adicionar casos necessários e exigir total ≥B1 sem skips/deleções.
**Commit:** `refactor(automation): observa captura e respeita parada`

### T2 — Contexto cooperativo e observação do envio serial

**What / Where:** unidade `ProcessDueOfferDispatchesUseCase.ts` + teste co-localizado.
**Depends on:** T1. **Reuses:** `touchClaim`, `markResult`, offline/flood, timeout e finalização.
**Requirement:** MQ-04/05/06. **Tests:** unit. **Gate:** quick API + alvo de envio.

**Done when / Verify:**
- [ ] Sinal opcional bloqueia novos efeitos; itens pré-claimed não iniciados ficam recuperáveis
  pelo stale. Sender iniciado pode terminar e concluir token; sem retry novo por parada.
- [ ] Logs distinguem `notBefore` de início real; instrumentação não muda envio nem expõe conteúdo.
- [ ] Testes cobrem abort antes/depois de claim, antes/depois de sender, SEND_TIMEOUT tardio,
  perda de token e suites atuais; contagem ≥B2 medida antes de editar, sem apagar cobertura.
**Commit:** `refactor(campaigns): observa envio e respeita parada`

### T3 — Dois slots no worker, um timer e um teto de parada

**What / Where:** componente `OfferDispatchWorker.ts` + seu teste co-localizado.
**Depends on:** T2. **Reuses:** timer 2 s, start/stop, logger e promises existentes.
**Requirement:** MQ-01/02/04/05. **Tests:** unit com relógio falso/promises controladas.
**Gate:** quick API + alvo do worker.

**Done when / Verify:**
- [ ] Opções distinguem modo legado de etapas independentes; uma etapa não sobrepõe a si mesma.
- [ ] Envio preso permite pelo menos três rodadas rápidas de captura em dez segundos virtuais;
  repetir inverso, falhas síncronas/assíncronas e cada combinação de etapas habilitadas.
- [ ] Parada cancela agendamento e sinaliza as duas etapas antes de aguardar; teto único, sem
  novos ticks e sem limpar uma execução antiga em cima de outra; resumo no máximo uma vez/minuto.
- [ ] Preservar os quatro casos atuais e medir novos casos sem skips. Corrigir comentário do lock.
**Commit:** `refactor(campaigns): separa execução das etapas de ofertas`

### T4 — Compor etapas por papel/flag e orçamento de shutdown

**What / Where:** composição de ofertas em `api/src/app/server.ts`; extrair só essa composição para
`offerWorkerComposition.ts` se necessário para testá-la sem boot, com teste co-localizado.
`api/src/shared/config/env.ts` + teste incluem a nova flag de A.
**Depends on:** T3. **Reuses:** `jobsFor`, containers lazy, `mediaDrainBudgetMs`, flags existentes.
**Requirement:** MQ-03/04/12. **Tests:** unit de configuração/composição, regressão de papéis/leases.
**Gate:** quick API + `processJobs`, composição e `env`.

**Done when / Verify:**
- [ ] Flag default false conserva ordem/capacidade antiga; true usa slots independentes.
- [ ] `http` não inicia etapas; `all`/`worker` respeitam separadamente envio/monitoramento.
- [ ] Stop recebe orçamento restante compartilhado sem consumir reserva de sockets/flush,
  inclusive quando keeper/adoção já consumiram tempo; não alterar papel ou ligar adoção.
- [ ] Testes importam composição sem subir engine/banco; baseline de testes medido e preservado.
**Commit:** `feat(campaigns): configura etapas independentes de ofertas`

### T5 — Gate reproduzível de A e baseline de recursos

**What / Where:** um roteiro/fixture de carga controlada e seu relatório em `validation.md` desta
feature; usar dublês e PG descartável, nunca gerar mensagens para clientes reais.
**Depends on:** T4. **Reuses:** testes e gates existentes, logs de A, critérios do design.
**Requirement:** MQ-05/06/12/13/15. **Tests:** unit/integration/smoke previstos; execução serial.
**Gate:** full + smoke controlado, após conferir RAM.

**Done when / Verify:**
- [ ] Registrar versão/ambiente/carga, contagens antes/depois e três repetições baseline/candidato.
- [ ] Matriz de regressão abaixo sem falhas; comparar CPU/RSS/DB/p95 e limites do design.
- [ ] Plano de rollout/rollback de A comprovado; B/C continuam desligados. Dados insuficientes
  significam gate pendente, não aprovação por ausência de erro.
**Commit:** `test(campaigns): valida isolamento e custo das etapas`

### T6 — Exclusão de sessões já atendidas na rodada

**What / Where:** `IOfferDispatchRepository.claimDue` + `PrismaOfferDispatchRepository.ts` e testes.
Uma alteração de contrato compatível: parâmetro opcional de exclusões, vazio preserva o claim.
**Depends on:** T5. **Reuses:** advisory lock e SQL de lanes/janelas.
**Requirement:** MQ-06/08/13. **Tests:** unit + integração Postgres local serial.
**Gate:** quick API + projeto `db` para o repositório.

**Done when / Verify:**
- [ ] Excluir sessões já atendidas e sessões com sender original ainda pendente entre rodadas
  (fornecidas pelo executor), sem quebrar itens legados sem sessão, prioridade offline,
  janela de origem, agendamento, pausas e hold mínimo de 120 s.
- [ ] Claims de dois workers não abrem a mesma sessão nem perdem token; todos os consumidores
  e dublês compilam; preservar contagem de integração medida antes da alteração.
**Commit:** `refactor(campaigns): limita claims às sessões da rodada`

### T7 — Executor com duas chamadas pendentes ao sender

**What / Where:** unidade `ProcessDueOfferDispatchesUseCase` + testes; executor novo somente no modo 2.
**Depends on:** T6. **Reuses:** T2, exclusões T6, caminhos atuais de envio/resultado/finalização.
**Requirement:** MQ-06/07/08/09. **Tests:** unit determinísticos e regressão PG de lanes.
**Gate:** quick API + alvos de envio/repositório; benchmark conforme T8.

**Done when / Verify:**
- [ ] Ondas limitadas por vagas de chamadas pendentes ao sender, até dez itens por rodada, relógio atualizado, uma seleção
  por sessão/rodada. Sem fila pré-claimed aguardando slot; modo 1 conserva o caminho serial.
- [ ] Duas sessões progridem, terceira aguarda; erro de uma não descarta resultado da outra.
- [ ] Timeout não libera vaga; promise original e sua sessão são observadas até settle, inclusive
  entre ticks. Após 120 s, outra vaga livre não pode claimar a mesma sessão. Duas promises eternas
  deixam estado degradado limitado a duas, sem busy loop/novos claims.
- [ ] Testes distinguem envio textual de MEDIA (sender devolve ao enfileirar) e LINK_PREVIEW;
  limites próprios da fila de mídia preservados, sem prometer teto de transferências de rede.
- [ ] Alertas limitados e nenhuma reexecução por resultado desconhecido; stop tem o mesmo teto.
**Commit:** `feat(campaigns): limita concorrência real entre sessões`

### T8 — Configuração e gate de ativação de B

**What / Where:** configuração `OFFER_DISPATCH_CONCURRENCY` em `env.ts`/teste e injeção no
`offersContainer.ts`; registrar evidência e runbook de B em `validation.md`.
**Depends on:** T7. **Reuses:** env centralizada, containers lazy, gates de T5.
**Requirement:** MQ-07/09/12/13/15. **Tests:** unit de configuração + carga local serial.
**Gate:** full + cenários B + smoke controlado.

**Done when / Verify:**
- [ ] Default 1; rejeitar 0, 3, fração, NaN e modo 2 com A desligada. Sem env obrigatória nova.
- [ ] Contar chamadas originais ao sender em voo; throughput rápido não cai >5%; claims/pool/locks e
  CPU/RSS dentro dos limites. Runbook cobre duas vagas travadas sem retry automático.
- [ ] Medir até dez claims mais uma busca vazia por rodada com uma vaga presa. Ativação exige
  um único consumidor de ofertas; rollback 2→1 + restart controlado documentado.
**Commit:** `feat(campaigns): configura capacidade de envio com rollback`

### T9 — Migration aditiva do turno de monitoramento

**What / Where:** `api/prisma/schema.prisma` e migration nova `add_monitoring_claim_turn`.
**Depends on:** T5. **Reuses:** entidade tenant e índices atuais de captura.
**Requirement:** MQ-10/11. **Tests:** integração/migration em PG local descartável.
**Gate:** projeto `db`, validação do schema e geração do client contra schema local/sintético.

**Done when / Verify:**
- [ ] Coluna nullable BigInt `monitoringClaimTurn` e sequência `monitoring_claim_turn_seq`, sem
  backfill, DTO/UI novo ou plano novo. Números sem precisão perdida nem serialização em JSON público.
- [ ] Migration aplica em banco vazio e em fixture anterior, sem alterar dados existentes;
  código anterior funciona com coluna extra; rollback de código mantém coluna.
- [ ] Medir EXPLAIN do acesso tenant/status/ordem; índice adicional só se necessário e testado.
**Commit:** `feat(automation): persiste turno de captura por tenant`

### T10 — Claim justo e atômico no Postgres

**What / Where:** `PrismaCapturedOfferRepository.ts`, contrato e testes co-localizados.
**Depends on:** T9. **Reuses:** `claimToken`, stale e índices; transação tenant+captura do design.
**Requirement:** MQ-10/11/13. **Tests:** integração Postgres local serial, não apenas inspeção SQL.
**Gate:** quick API + projeto `db` para capturas.

**Done when / Verify:**
- [ ] Flag de construtor false conserva query antiga. Modo justo reivindica no máximo um item
  por chamada; não muda o loop serial do consumidor nem os critérios atuais de elegibilidade.
- [ ] Sete tenants/lote três: todos atendidos antes da repetição de um tenant continuamente
  elegível; FIFO dentro do tenant, duas rodadas completas e caso PROCESSING stale.
- [ ] Duas conexões: exclusividade/token/rollback/turno persistido; captura indisponível não
  altera o turno da linha; lacunas da sequência não prejudicam justiça. Testar seleções muito
  próximas, sem depender de resolução de milissegundos; timestamps de claim vêm do banco.
- [ ] Timeout explícito da transação, teste de contenção com lock de tenant e EXPLAIN com carga
  representativa; zero varredura/agrupamento de todo o histórico por item.
- [ ] Tenant travado por billing não impede os demais nem tem turno avançado; após liberar lock,
  ele é atendido. O limite de N seleções só é exigido sem contenção externa de locks.
**Commit:** `feat(automation): distribui claims entre tenants`

### T11 — Configuração e gate de ativação de C

**What / Where:** flag `MONITORING_FAIR_CLAIM_ENABLED` no env/teste e injeção no
`automationContainer.ts`; evidência de C em `validation.md`.
**Depends on:** T10. **Reuses:** modo legado do repositório, gates de T5, rollback aditivo.
**Requirement:** MQ-10/11/12/13/15. **Tests:** unit de configuração, integração e carga local serial.
**Gate:** full + cenários C + smoke controlado.

**Done when / Verify:**
- [ ] Default false; ativação só após migration e todos os consumidores atualizados e usando o
  mesmo modo; não avaliar justiça com consumidores misturando FIFO e seleção justa.
- [ ] Gates de justiça e CPU/RSS/DB atendidos sem mudar fairness/ordem do envio nem prometer
  SLA de marketplace. Comparar modo false/true e restart com turnos persistidos.
- [ ] Rollback false preserva coluna, sequência e itens; não exige seed ou UPDATE em produção.
**Commit:** `feat(automation): configura seleção justa de capturas`

### T12 — Documentação, versão e revisão final das entregas escolhidas

**What / Where:** `docs/monitoramento-grupos.md`, `docs/fila-de-envio.md`,
`docs/arquitetura-escala.md`, `.specs/codebase/TESTING.md`, changelogs e `api/package.json`.
**Depends on:** T5, T8, T11 (T8/T11 podem ser explicitamente diferidas para release só de A).
**Reuses:** SemVer, checklist Render e /caveman-review. **Requirement:** MQ-12/13/14/15.
**Tests:** revisão documental + gates full/smoke das entregas executadas. **Gate:** full + review.

**Done when / Verify:**
- [ ] Versão SemVer do módulo API atualizada na implementação; manifesto npm = `api/package.json`.
  Painel/extensão sem alteração não recebem versões ou manifests artificiais.
- [ ] Docs distinguem comportamento ativo/flag/futuro e capturas ao vivo versus histórico;
  preservar i18n, tema e privacidade das telas existentes. Nenhuma UI nova neste plano.
- [ ] `/caveman-review`: corrigir todos os bugs/risks do código/diff; repetir até restarem apenas
  nits, sem ocultar achados ou transformar risco conhecido em garantia.
- [ ] Evidências, contagens e smoke reais registrados; itens condicionais não executados seguem
  diferidos. Preparar PR na branch adequada; merge/push/deploy conforme autorização da execução.
**Commit:** `docs(automation): registra operação e validação das filas`

### T13 — Porta de entitlement do chat e gate nos listeners

**What / Where:** `chat/domain/contracts/IChatEntitlementGate.ts`, implementação com cache TTL sobre
`tenant_entitlements` em `chat/infrastructure/`; gate dentro de `IngestIncomingMessageUseCase` e
`IngestHistorySyncUseCase` e nos listeners de estado; porta `IIncomingMediaPolicy` no messaging
injetada no adapter (`:1333`, prévia), implementação compondo entitlement + catálogo de grupos
monitorados; consumo da marca de eco no `notify` (`:601/:662/:1651`); registro em `server.ts`.
**Depends on:** —. **Reuses:** entitlements/eventos do hub, listeners existentes, `chatMediaContainer`.
**Requirement:** MQ-16/17/18/20. **Tests:** unit por listener (ligado/desligado), unit da política de
mídia, regressão de eco e marca `:598`. **Gate:** full.

**Done when / Verify:**
- [ ] Desligado: só upsert de contato; zero conversa/mensagem/WS inclusive via `append`; download só
  de imagem de grupo monitorado; `sourceMediaUrl` da captura preservado; 1:1 e vídeo sem download.
- [ ] Ligado: suíte atual do chat sem diff. Adapter sem import de entitlement. Política aplicada em
  `notify` e `append` do Baileys e no Telegram; composição única para `server.ts` e `localEngineContainer`.
- [ ] Disparo MEDIA/texto/LINK_PREVIEW conclui `SENT`; eco não grava nem vaza marca.
**Commit:** `feat(chat): condiciona ingestão ao entitlement do tenant`

### T14 — Coluna `lid` em `chat_contacts` e uso na resolução de menções

**What / Where:** passo 1 (contrato): `MESSAGE_RECEIVED.authorLid?` em `shared/events/InternalMessagingEvent.ts`,
emissores Baileys/Telegram/remoto e consumidores, CHANGELOG (AGENTS §36). Passo 2: migration aditiva
`add-chat-contact-lid`; `ChatContact` + mapper + repositório (`findByLid`, upsert com `lid`); consulta
antes da engine na resolução de menção/citação.
**Depends on:** —. **Reuses:** resolução `participant`/`participantAlt` já no adapter (`:1844–1848`).
**Requirement:** MQ-19. **Tests:** integração Postgres local (migration + unique), unit do upsert e
da resolução com hit/miss. **Gate:** full + integração.

**Done when / Verify:**
- [ ] Chave única continua `tenantId+phone`; `lid` nulo permitido; sem backfill.
- [ ] Menção com `lid` conhecido não chama a engine; miss cai no caminho atual.
**Commit:** `feat(chat): persiste LID do contato e usa na resolução de menções`

### T15 — Flag, gate de ativação e docs de D

**What / Where:** `CHAT_INGEST_ENTITLEMENT_GATE_ENABLED` em `env.ts`; evidência em
`validation.md`; `docs/monitoramento-grupos.md`, `docs/chat-*.md`, `docs/produto-roadmap.md`
(gate do produto Chat), changelog e versão.
**Depends on:** T13, T14. **Reuses:** gates de T5, checklist Render. **Requirement:** MQ-12/13/14/20.
**Tests:** unit de configuração + smoke controlado. **Gate:** full + review.

**Done when / Verify:**
- [ ] Default false; ativação só após hub publicar `chat_enabled`.
- [ ] Medição: escritas/mensagem e downloads antes × depois em tenant sem chat.
- [ ] Rollback false sem reprocessamento.
**Commit:** `feat(chat): ativa gate de ingestão por entitlement`

### T16 — CPU, event loop e pool no heartbeat

**What / Where:** `WorkerHeartbeatJob.ts` + repositório + migration aditiva `add-worker-heartbeat-resources`
(colunas `cpuPct`, `eventLoopP99Ms` **nullable**; sem pool Prisma).
**Depends on:** —. **Reuses:** heartbeat de 20 s, RSS existente. **Requirement:** MQ-21.
**Tests:** unit com relógio/cpuUsage injetados; integração da migration. **Gate:** full.

**Done when / Verify:**
- [ ] Delta de CPU correto entre ticks; p99 do event loop zerado após leitura; sem timer novo.
- [ ] Falha do banco só loga, como hoje.
**Commit:** `feat(sessions): registra CPU, event loop e pool no heartbeat`

### T17 — Sampler de métricas Render + Postgres com retenção e alertas

**What / Where:** portas `IPlatformMetricsSource`/`IDatabaseStatsSource`, adapters Render (`AbortSignal.timeout`)
e Prisma (`$transaction` + `SET LOCAL statement_timeout`), `OpsMetricsSamplerJob` com `IJobLease`
`ops-metrics-sampler` e `stop()` na ordem de shutdown, migration `create-ops-metrics-samples`,
avaliador de limiares com silêncio por `IJobLease` `ops-alert:<reason>` (só log),
`processJobs.ts` (só worker), env `OPS_METRICS_SAMPLER_ENABLED`, `RENDER_API_KEY`, `RENDER_RESOURCE_IDS`.
**Depends on:** T16. **Reuses:** `capacityAlert`, orçamento de shutdown, e-mail do hub.
**Requirement:** MQ-22/23/24. **Tests:** unit com clientes falsos; integração da tabela e do delete de
retenção; unit do silêncio de 30 min. **Gate:** full + integração.

**Done when / Verify:**
- [ ] Nunca registra no `http`; `statement_timeout` aplicado; falha parcial não derruba a amostra.
- [ ] 1 linha/5 min; retenção 7 dias; sem PII nem SQL bruto.
- [ ] Alerta 1× por limiar/30 min via lease, válido com 2 workers; sem e-mail até template na central.
- [ ] Dois workers: só um amostra; TTL 45 s + `release()` no stop; timeout do PG provado por teste.
- [ ] Shutdown: stop sinalizado e aguardado em `Promise.all`, dentro da reserva de 10 s.
**Commit:** `feat(metrics): amostra recursos da Render e do Postgres no worker`

### T18 — Rota super admin, flag, docs e versão de E

**What / Where:** `GET /admin/ops/metrics` (super admin, cursor assinado), `docs/arquitetura-escala.md`
(§ observabilidade), `docs/ops-metricas.md` novo, changelog, versão.
**Depends on:** T17. **Reuses:** guard super admin, `OpaqueCursor`. **Requirement:** MQ-25/12/13/14.
**Tests:** unit da rota (403 não super admin), review. **Gate:** full + review.

**Done when / Verify:**
- [ ] Rota lê só tabelas locais; sem chamada à Render em requisição.
- [ ] Docs dizem o que não fazer: APM, `/metrics` público, medir em requisição.
**Commit:** `feat(metrics): expõe amostras de recursos ao super admin`

## Comandos de verificação previstos

Executar um comando por vez, somente com margem de RAM. Nenhum comando abaixo foi executado neste
planejamento; as contagens B1/B2/etc. serão registradas **antes de editar o código** na execução.

```sh
# Alvos unitários (api/)
pnpm exec vitest run --maxWorkers=1 --no-file-parallelism src/modules/campaigns/infrastructure/worker src/modules/campaigns/application/use-cases/ProcessDueOfferDispatchesUseCase.test.ts src/modules/automation/application/use-cases/ProcessPendingCapturedOffersUseCase.test.ts src/modules/automation/application/use-cases/RegisterCapturedMessageUseCase.test.ts src/app/processJobs.test.ts src/app/roleComposition.test.ts

# Gate quick de cada task, ampliado apenas quando houver falha/mudança nova
pnpm exec vitest run --maxWorkers=1 --no-file-parallelism
pnpm typecheck

# Integração: api/, PostgreSQL LOCAL descartável, serial
bash scripts/postgres-descartavel.sh start
INTEGRATION_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/copysync_int pnpm exec vitest run --config vitest.int.config.mts --project db src/modules/campaigns/infrastructure/repositories/PrismaOfferDispatchRepository.int.test.ts src/modules/automation/infrastructure/repositories/PrismaCapturedOfferRepository.int.test.ts
bash scripts/postgres-descartavel.sh stop
```

Gate full também executa `pnpm typecheck` e `pnpm exec vitest run --maxWorkers=1 --no-file-parallelism`
em `app/`, serialmente. Smoke com tenant/sessão de teste autorizado. Não executar `start:migrate`,
`prisma:deploy`, seed, testes com host remoto ou um boot que carregue `api/.env` de produção.

## Matriz mínima de regressão

| Área | Verificações obrigatórias |
|---|---|
| Worker | independência entre rodadas, ausência de overlap por etapa, erro síncrono/assíncrono, flags, roles, stop/deadline, nenhum efeito novo após sinal |
| Captura | unique sessão+mensagem, link/keyword/janela, até 3/orçamento, credenciais, texto/IA fallback, imagem, sourceKey, validade original e cross-session |
| Envio | uma lane/sessão, cooldown, token perdido, timeout tardio/hold120s, offline60s/6h, flood, pausa/cancelamento, agendado/expirado, limites por canal |
| Concorrência | chamadas pendentes ao sender ≤2 em B inclusive após timeout, excluir sessão até settle, mídia mantém limites próprios, refill≤10, uma seleção/sessão/rodada, promessa eterna sem crescimento local |
| SQL justo | N maior que lote, backlog desigual, FIFO tenant, stale, duas conexões, restart, rollback e contenção com tenant |
| Operação | CPU/RSS/DB/p95, volume de logs, ausência de PII, rollback e manutenção de leases/engine/mídia/eco |

## Gates TLC de estrutura (planejamento)

| Tarefa | Unidade principal / granularidade | Depende de | Grafo mostra | Teste exigido / previsto |
|---|---|---|---|---|
| T1 | um use case e seus testes | — | — | unit / unit |
| T2 | um use case e seus testes | T1 | T1 | unit / unit |
| T3 | um worker e seus testes | T2 | T2 | unit por comportamento / unit |
| T4 | uma composição/configuração e seus testes | T3 | T3 | unit / unit |
| T5 | um relatório/roteiro de validação de A | T4 | T4 | execução dos gates / gates |
| T6 | um contrato de claim compatível e implementação/testes | T5 | T5 | integração para SQL / unit+integração |
| T7 | um executor e seus testes | T6 | T6 | unit / unit+regressão integração |
| T8 | configuração/capacidade e gate B | T7 | T7 | unit+gates / unit+gates |
| T9 | uma evolução de schema | T5 | T5 | integração migration / integração |
| T10 | um claim transacional e seus testes | T9 | T9 | integração / integração |
| T11 | configuração/seleção e gate C | T10 | T10 | unit+gates / unit+gates |
| T12 | documentação/validação da release | T5,T8,T11 | T5,T8,T11 | docs+gates / docs+gates |
| T13 | porta + gate nos listeners e política de mídia | — | — | unit / unit+regressão |
| T14 | uma evolução de schema + resolução | — | — | integração / unit+integração |
| T15 | configuração/gate D e docs | T13,T14 | T13,T14 | unit+gates / unit+gates |
| T16 | heartbeat + migration aditiva | — | — | unit+integração / unit+integração |
| T17 | sampler, portas, tabela, alertas | T16 | T16 | unit+integração / unit+integração |
| T18 | rota super admin + docs | T17 | T17 | unit+review / unit+review |

Resultado: tarefas coesas, arestas conferidas e testes co-localizados. A matriz antiga de TESTING.md
não exigia integração de repositórios, mas o projeto já a possui; este plano exige-a explicitamente
para toda alteração SQL. Integrações nunca `[P]`. Revisões e correções do plano: [review.md](review.md).
