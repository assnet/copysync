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
