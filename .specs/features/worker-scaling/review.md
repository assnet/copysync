# Revisão — plano da gestão de escala dos workers

**Branch:** `feature/worker-scaling` · **Escopo:** `spec.md`, `design.md`, `tasks.md` contra o código (`/caveman-review`, só contradição com arquivo:linha).
**Critério de saída:** nenhum 🔴 aberto; 🟡 corrigido ou aceito com motivo.

| Rodada | Achados | Resultado |
| --- | --- | --- |
| 1 (plano × código) | 1 🔴, 14 🟡, 3 ❓ | 🔴 corrigido: o teto só é aplicado com a adoção ligada (`sessionLeaseContainer.ts:130`, `sessionAdoptionContainer.ts:92-93`); spec ganhou o limite conhecido, `enforced`, smoke P1 refeito e D12. 🟡 corrigidos: referências de linha, `updatedAt` já existente, mudança de assinatura da política, filtros de `awaiting`, boot degradado, resolução de 5 min do sustentado, fonte do `mbPerSession`, confirmação reforçada do teto, `RangeSlider`, arquivos de T10/T13, entrada nova do alerta (T17, deixou de ser paralela), caso de reinício (T27), abas como sub-rotas. ❓ respondidas: `connected` da aba Capacidade é a contagem do banco, rotulada; `GET /scale` usa cache de 30 s; base `feature/rebranding-app` por decisão do dono. Convergiu: sem 🔴 aberto. |
