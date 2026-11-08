# Validação: plano versus implementação

**Data:** 2026-11-08 · **Escopo atual:** planejamento e revisão, sem mudança operacional.

| Verificação | Estado |
|---|---|
| Leitura de arquitetura, código e testes atuais | Feita; evidências em design.md |
| Rastreabilidade spec → design → tarefas | 15 requisitos mapeados |
| Grafo, granularidade e testes co-localizados | Conferidos em tasks.md |
| Revisão independente /caveman-review | Registro em review.md |
| Validação de links locais e diff | Links locais conferidos; git diff --check sem erros |
| Baselines de latência/CPU/RSS/DB e contagens de testes | Não executados; gates de T5/T8/T11 |
| Unitários/integração/typecheck/smoke da implementação | Não executados; não há implementação |
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
