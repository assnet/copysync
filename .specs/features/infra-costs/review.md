# Revisão — plano dos custos da infraestrutura

**Branch:** `feature/infra-costs` · **Escopo:** `spec.md`, `design.md`, `tasks.md` contra o código (`/caveman-review`, só contradição com arquivo:linha).
**Critério de saída:** nenhum 🔴 aberto; 🟡 corrigido ou aceito com motivo.

| Rodada | Achados | Resultado |
| --- | --- | --- |
| 0 (insumos do dono, 2026-11-12) | — | Dados reais da Render (api com disco, worker por instância e hoje 2 pelo T25, Redis 20, Postgres 0.5c-1g 19 + 15 GB, workspace Hobby) viraram valores iniciais e D10 (armazenamento como componente, preço por GB a confirmar). Decisão: preços em USD, toda tela em USD e BRL; cotação PTAX/SGS do BCB com override manual como recomendação (pergunta 5); arredondamento COST-06b; cotação guardada no fechamento (D7). |
| 1 (plano × código, 1 revisor) | 1 🔴, 9 🟡, 2 🔵 | 🔴 corrigido: ramo manual de `resolveFxRate` saiu da T12b (P2) para a T2 (P1 compila sem a P2). 🟡 corrigidos: BRL calculado na API (linha de Alternativas); `storage` separa "não se aplica" de "tamanho a confirmar"; contratadas por tenant ganham leitor próprio (`IInfraTenantUsageReader`, T13) porque `PrismaWorkerCapacityReader` só agrega por plano; tenant ilimitado anula a leitura por contratadas (`unlimited_contracted`); parse da env em `shared/config`; T5 (banco) depois da T4; `usePersistedState` sempre com valor inicial; T21 com arquivos; versões rebaseadas (topo app 0.106.0 → P1 0.107.0). 🔵 corrigidos: avisos completos no calculador; `opsResourceKind` em `opsMetricsSeriesPolicy.ts`. |
| 2 (preços da Render, 2026-11-12) | — | Preços públicos incorporados: disco 0,25/GB (só cresce), storage do Postgres 0,30/GB (15 GB = 4,50), tabela de planos de serviço e Postgres, workspace Hobby/Pro e excedentes. Total inicial US$ 93,50 com 1 worker. Job: instâncias pelas amostras `srv-<id>-<sufixo>` (sem chamada), plano/disco pela Render com aviso `config_drift`. Perguntas 1, 2 e 8 reescritas. |
