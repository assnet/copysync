# Validação: plano versus implementação

**Data:** 2026-11-08 · **Escopo atual:** planejamento e revisão, sem mudança operacional.

| Verificação | Estado |
|---|---|
| Leitura de arquitetura, código e testes atuais | Feita; evidências em design.md |
| Rastreabilidade spec → design → tarefas | 15 requisitos mapeados |
| Grafo, granularidade e testes co-localizados | Conferidos em tasks.md |
| Revisão independente /caveman-review | Registro em review.md |
| Validação de links locais e diff | Links locais conferidos; git diff --check sem erros |
| Baselines de latência/CPU/RSS/DB e contagens de testes | A: reduzido/sintético local feito (abaixo); gate de produção pendente; T8/T11 não |
| Unitários/integração/typecheck/smoke da implementação | A (T1–T5): unit/typecheck ok; smoke pendente |
| Deploy, flags, migration ou dados de produção | Nenhuma alteração |

## Evidência de RAM nesta sessão

Amostragem temporária a cada 5 s com `vm_stat`; total físico 16 GiB, confirmado por `sysctl`.
A leitura inicial de `top` indicou ~15 GiB ocupados, incluindo cache recuperável; por isso a
primeira comunicação foi corrigida. A estimativa usada no guard e sua limitação estão no design.
O usuário informou ter fechado aplicativos. Nenhum build, teste de carga ou banco foi iniciado.

174 amostras, de 14:58:59 a 15:13:26 (Brasília); máximo estimado **83.77%**, último valor **82.46%**; 0 amostras no guard de 88% e 0 em 90%. Monitor encerrado ao concluir o trabalho; não houve carga de testes.
Essas medições são do Mac de desenvolvimento; não são baseline de performance do servidor.

## Roteiro para a futura execução

1. Medir contagens-base e carga com flags false, sem produção, guard de RAM ativo.
2. Registrar commit, ambiente, fixture e três repetições comparáveis por entrega.
3. Anexar resultados e logs resumidos sem dados sensíveis, com gates binários do design.
4. Corrigir bugs/risks apontados pelo /caveman-review e repetir apenas verificações afetadas.
5. Aprovar ativação somente das entregas com gates cumpridos; diferir as demais explicitamente.

Não preencher testes como aprovados apenas porque o documento foi revisado. Resultado esperado
de uma implementação planejada não é evidência de execução nem garantia absoluta de não regressão.

## Entrega A — execução de T4/T5 (2026-11-09)

**Versão:** `api` 0.73.3, base `e763f73` (T1–T3) + T4 não commitado. **Ambiente:** Mac de desenvolvimento
(16 GiB, RAM livre 37–45% durante as execuções), PostgreSQL 16.15 local descartável (porta 55432), banco
isolado `copysync_bench_offers` criado por `pg_dump --schema-only` de `copysync_int`, fuso `UTC`, apagado ao fim.
Sem WhatsApp, sem rede, sem produção; sem `prisma migrate`.

### T4 — composição

- `OFFER_WORKER_INDEPENDENT_STAGES_ENABLED` (default `false`) em `api/src/shared/config/env.ts`.
- `api/src/app/offerWorkerComposition.ts`: `buildOfferWorkerOptions` (papel via `jobsFor`, `http` nunca;
  false = tick sequencial legado idêntico; true = etapas `offer-dispatch`/`group-monitoring` por flag,
  repassando `ctx`) e `offerWorkerStopOptions` (true: `timeoutMs = mediaDrainBudgetMs(decorrido)`, nunca
  invade a reserva de 10 s; legado: `stop()` sem teto extra, como hoje). `server.ts` só chama as duas.

### Gate determinístico (relógio virtual, dublês) — `offerWorkerComposition.gate.test.ts`

| Cenário | Resultado |
|---|---|
| Envio preso 60 s, flag true | ≥3 rodadas de captura em 10 s (5 obtidas); envio sem sobreposição — OK |
| Inverso (captura presa 60 s) | ≥3 rodadas de envio em 10 s — OK |
| Baseline flag false | captura 0 rodadas em 10 s (bloqueio confirmado) |
| Parada com as duas etapas presas, decorrido 15 s | sinal abortado nas duas, retorna em exatamente 2 s (27−15−10), sem ticks novos — OK |
| Orçamento maior que o teto do worker | limitado a 10 s — OK |

### Benchmark sintético REDUZIDO — `offerWorkerComposition.bench.int.test.ts`

Use cases reais de envio e captura + repositórios Prisma reais; dublês: link (250 ms), produto/texto/imagem,
entitlements, fila de oferta (grava offer + dispatches no banco) e sender (300 ms; 1 a cada 10 envios preso
15 s). 1 tenant, 5 sessões, 2 grupos de disparo por sessão, 2 capturas/s. **3 repetições × 2 min por modo**
(alternadas false/true), não 10 min. Mesmo processo mede CPU (`process.cpuUsage`) e RSS do teste (inclui vitest).

| Mediana das 3 | false (legado) | true (etapas) |
|---|---|---|
| Rodadas de captura / envio | 13 / 13 | 59 / 14 |
| p95 duração etapa captura / envio (ms) | 792 / 16 252 | 789 / 16 259 |
| p95 espera da captura até o claim (ms) | 98 586 | 28 964 |
| Capturas enfileiradas (entrada 240) | 39 | 177 |
| Envios | 58 | 60 |
| CPU do processo (ms em 120 s) | 863 (~0,7%) | 1 937 (~1,6%) |
| RSS p95 (MB) | 83 | 83 |
| Queries / p95 por query (ms) | 1 594 / 0 | 3 276 / 1 |

Leitura: com envio lento, o legado processou 16% das capturas e a fila crescia (espera p95 ~99 s); com
etapas, 74% e espera ~29 s, sem perder envios. CPU e queries dobram porque o trabalho processado
quadruplica (≈ mesmo custo por captura); +0,9 p.p. de CPU, RSS igual, p95 de query ≤1 ms, sem timeout de pool.
Dentro dos limites do design **para esta carga**. Bruto (JSONL) não versionado; reproduzir com o comando no
cabeçalho do arquivo de teste.

### Regressão

- `vitest` (`src/modules/campaigns src/modules/automation src/app src/shared/config`, serial):
  **67 arquivos, 790 testes, 0 falhas** (inclui 17 novos de T4/T5).
- `pnpm typecheck` (api): sem erros.

### Estado do gate de A: **PENDENTE**

Carga reduzida e sintética, Mac local, 2 min × 3, um tenant: não cobre o gate de produção (10 min × 3,
vazio / 1 sessão / 10 sessões / 7 tenants com backlog desigual, CPU/RSS do container, MEDIA/texto/LINK_PREVIEW,
janela de 30 min em carga representativa). Smoke com tenant/sessão de teste autorizado não executado.
Flag continua `false`; nenhuma ativação, deploy ou alteração de produção. Rollback de A = flag false + restart.

## Entrega C — execução de T9–T11 (2026-11-09)

**Base:** `5df078b` + C não commitado, `api` 0.73.3 (versão/CHANGELOG ficam para T12). **Ambiente:** Mac local,
PostgreSQL 16 descartável (55432), banco isolado `copysync_int_c` (cópia de `copysync_int`, fuso UTC, apagado ao fim).
Sem produção, sem `start:migrate`; migration aplicada só com `DATABASE_URL` explícito local sobre cópia do schema.

### T9 — migration `20261109130000_add_monitoring_claim_turn`

- `tenants."monitoringClaimTurn" BIGINT` nullable (SQL do `prisma migrate diff`) + `CREATE SEQUENCE monitoring_claim_turn_seq`
  manual. Sem backfill, DTO ou painel. Aplicada em fixture anterior (`copysync_int_c`, `copysync_int`) e em banco vazio
  (64 migrations); `migrate diff` banco × schema vazio depois. Código anterior não lê a coluna (rollback de código a mantém).

### T10 — claim justo (`PrismaCapturedOfferRepository.claimFair`)

Um statement (CTEs) em `$transaction([SET LOCAL lock_timeout 200ms, SET LOCAL statement_timeout 2s, claim])`.
Tenant: `FOR NO KEY UPDATE SKIP LOCKED` (não bloqueia FK do insert de captura; o `FOR UPDATE` do billing conflita e
é pulado). Elegibilidade em dois `EXISTS` (PENDING; PROCESSING stale): a 1ª versão com `IN (… OR …)` varria o
histórico do tenant (93 714 buffers, 14 ms) e foi descartada.

`PrismaCapturedOfferRepository.fairClaim.int.test.ts` (serial, 9 testes, 3 execuções seguidas sem falha):

| Cenário | Resultado |
|---|---|
| 7 tenants, lote pedido 3, backlog desigual (t0 = 30 mais antigas; demais 4–9) | ≤1 por chamada; 14 claims = 2 rodadas completas na mesma ordem; FIFO dentro do tenant; nenhum backlog esgotado; turnos distintos |
| PROCESSING stale × recente | stale reivindicado com token novo; recente não |
| Duas conexões concorrentes até esvaziar | sem duplicata, tokens únicos, os dois progrediram, 7 turnos distintos e não nulos |
| Restart (novo PrismaClient) | continua pelos turnos persistidos (3 atendidos → os 4 restantes → volta ao 1º) |
| Rollback (trigger falha o UPDATE da captura) | erro propagado; turno null e capturas PENDING; após remover a trigger, claim normal |
| Timeout explícito (`LOCK TABLE` externo) | falha em < 2 s (lock_timeout), turno intacto |
| Captura travada externamente | `[]`, turno intacto; atendida ao liberar |
| Tenant travado como o billing (`FOR UPDATE`) | sem espera; os outros 6 atendidos; turno do travado null; atendido logo após liberar |
| Flag false | FIFO global, 3 itens do tenant com backlog antigo, turnos intocados |

Limitação aceita: se o tenant de menor turno tem a única captura elegível travada por outra transação (não por
claim, que travaria o tenant), a chamada devolve vazio e a próxima rodada tenta de novo.

### EXPLAIN (10 mil elegíveis desiguais + 100 mil de histórico)

500 tenants (metade com turno), 1 tenant com 6 000, 40 com 100, 200 PROCESSING (metade stale), 100 mil
QUEUED/SKIPPED/FAILED em todos. `EXPLAIN (ANALYZE, BUFFERS)` do statement completo dentro de transação revertida:

| Consulta | Buffers | Tempo |
|---|---|---|
| FIFO atual (flag false) | 187 | 1,8 ms |
| Justa, tenant pequeno escolhido | 376 | 1,8 ms |
| Justa, tenant de 6 000 escolhido | 381 até o lock da captura (sort de 5 936 linhas, 656 kB) | 2,7 ms |

Custo proporcional ao backlog elegível (índice `[status, capturedAt]` e `[tenantId, status, capturedAt]`), nunca ao
histórico. **Índice novo não justificado.**

### T11 — configuração

`MONITORING_FAIR_CLAIM_ENABLED` (default `false`) em `env.ts`, injetada em `automationContainer.ts`. Unit:
`env.monitoringFairClaim.test.ts` (default) e `PrismaCapturedOfferRepository.test.ts` (roteamento por flag, 3).
Regressão `vitest src/modules/automation src/shared/config`: 17 arquivos, 185 testes, 0 falhas. `pnpm typecheck`:
sem erros nos arquivos de C (erros restantes em `campaigns/…concurrency.test.ts`, da entrega B em andamento).

### Estado do gate de C: **PENDENTE**

Faltam carga comparativa false/true (CPU/RSS/DB, 3×10 min, 7 tenants), smoke autorizado e `/caveman-review`.
Ativar só após a migration no boot da Render e com todos os consumidores no mesmo modo. Rollback = flag false +
restart; coluna, sequência e itens ficam; sem seed nem UPDATE em produção.
