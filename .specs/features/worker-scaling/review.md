# Revisão — plano da gestão de escala dos workers

**Branch:** `feature/worker-scaling` · **Escopo:** `spec.md`, `design.md`, `tasks.md` contra o código (`/caveman-review`, só contradição com arquivo:linha).
**Critério de saída:** nenhum 🔴 aberto; 🟡 corrigido ou aceito com motivo.

| Rodada | Achados | Resultado |
| --- | --- | --- |
| 1 (plano × código) | 1 🔴, 14 🟡, 3 ❓ | 🔴 corrigido: o teto só é aplicado com a adoção ligada (`sessionLeaseContainer.ts:130`, `sessionAdoptionContainer.ts:92-93`); spec ganhou o limite conhecido, `enforced`, smoke P1 refeito e D12. 🟡 corrigidos: referências de linha, `updatedAt` já existente, mudança de assinatura da política, filtros de `awaiting`, boot degradado, resolução de 5 min do sustentado, fonte do `mbPerSession`, confirmação reforçada do teto, `RangeSlider`, arquivos de T10/T13, entrada nova do alerta (T17, deixou de ser paralela), caso de reinício (T27), abas como sub-rotas. ❓ respondidas: `connected` da aba Capacidade é a contagem do banco, rotulada; `GET /scale` usa cache de 30 s; base `feature/rebranding-app` por decisão do dono. Convergiu: sem 🔴 aberto. |
| 2 (plano × código em `891a26b`, 3 revisores) | 4 🔴, 20 🟡, 2 ❓ | 🔴 corrigidos: fila `session-open` lia o teto da env (`roleComposition.ts:98`) e entrou na T7; versões da P1 já usadas (agora api 0.80.0, app 0.99.0); `actorUserId` era `uuid` com `User.id` cuid. 🟡 corrigidos: ordem de boot do provider; contratos na T1; T5/T6 ajustam o chamador (gate `full`); memória por sessão derivada de `memory ÷ memory_pct`; aguardando contado ao vivo; recusas limitadas por lease; limpeza de 180 dias; envs do escalador em `http` e `worker`; recorte da regra "rota nunca chama a Render"; diálogos próprios; fonte da série de 7 dias; `Where` de T17/T24/T28; rascunho da aba Escala; smoke T25 com ambiente declarado. ❓: histórico não identifica o ator; "próxima avaliação" virou "última decisão". |
| 3 (correções × código e entre arquivos) | 0 🔴, 6 🟡, 1 ❓ | 🟡 corrigidos: critério de pronto da T7; T2 com uma migration; confirmação reforçada sempre na P1 e `suggestedMaxSessions` ligado na T18; filtro por serviço na T23; lease de 24 h da limpeza; `missing` no estado `not_configured`. ❓: casamento instância→serviço por prefixo, conferido no T25. D13: atualizar a branch antes da P1. |
| 4 (correções da rodada 3) | 0 🔴, 0 🟡, 2 🔵 | Só nits (requisitos citados em T18 e T23), corrigidos. Convergiu. |
| 5 (plano × integração em `d30c625`, +29 commits) | 0 🔴, 3 🟡 | Nenhum arquivo citado de `sessions`, `metrics`, `app/` de workers, containers, `server.ts` ou docs de escala mudou (`git diff --stat 891a26b d30c625` nos caminhos do plano: só `schema.prisma`, `AGENTS.md`, roadmap e `padrao-ui-painel.md`). 🟡 corrigidos: versões fixas viraram "próxima minor acima do topo" (0.80/0.81 e 0.99/0.100 já usadas); última migration agora `20261111130000`; linhas de `PlatformSetting` (948-955). Lista de arquivos do dono atualizada. Só nits. |

## R1 — revisão da implementação da P1

| Rodada | Achados | Resultado |
| --- | --- | --- |
| 1 (diff da fase, backend + painel/docs) | 0 🔴, 11 🟡, 1 ❓, 6 🔵 | Corrigidos em T12a/T12b: refresh em curso devolvia valor antigo; linha inválida divergia entre GET e provider; env > 1000 travava o PUT (clamp); boot sem teto de tempo; Prisma na rota (factories no container); `enforced` só do processo `http` (agora também batimento vivo); rascunho com base `null` sobrescrevia sem 409; aviso de ocupação sem adoção; "1.000"→1; textos prometiam aba Escala; erro de `scalerMode` sem lugar; aria do `RangeSlider`. |
| 2 (correções) | 1 🔴, 3 🟡, 4 🔵 | Corrigidos em T12c: 🔴 linha não-objeto → 409 eterno (repositório devolve `updatedAt` real); leitura sem timeout depois do boot; falha de `hasAlive` virava 500 depois de salvo; `parseSavedWorkerScalingSettings` no domínio; `hasAlive` com `EXISTS`. |
| 3 (T12c) | 0 🔴, 0 🟡, 3 🔵, 1 ❓ | Só nits, aceitos: fakes de heartbeat sem `hasAlive` em `sessionAdoptionContainer.test.ts`; warn sem dedupe quando `hasAlive` falha; teste da janela de microtask talvez não determinístico. ❓ aceito: com `hasAlive` falhando e adoção desligada no `http`, a tela mostra "sem efeito" naquele carregamento. Convergiu. |
| Smoke (local, Postgres descartável, adoção ligada) | 0 🔴, 4 🟡, 7 🔵 | Funcional ok (teto 40→25 no batimento em ~5 s sem reinício; 409; auditoria). Visual corrigido em T12d (botão de suporte, linha deslocada, "0,8", aba cortada no celular, textos) e T12e (409 sem `prisma:error`). Reconferência: 8/8 ok. Aceitos fora do escopo: contraste do Snackbar (tema global); seta das abas habilitada com ~6 px. |

Gates no topo: api 4.400 testes + typecheck; app 1.770 testes + typecheck + build; integração 262 testes (T12e).

## R2 — revisão da implementação da P2

| Rodada | Achados | Resultado |
| --- | --- | --- |
| 1 (diff da fase, backend + painel/docs) | 0 🔴, 9 🟡, 2 ❓, 5 🔵 | Corrigidos em T19a/T19b: `countAwaitingCapacity` sem `statement_timeout`; entitlement `'1e400'` derrubava a rota (regex decimal); amostra velha como atual (`cluster.stale`); alerta em percentual; texto de redução do teto; sugestão "carregando" tratada como "sem medição"; ajuda da capacidade por modo; docs "grava a cada tick". Aceitos e documentados: capacidade sem adoção conta só processos com sessão; "cabem mais" é projeção isolada por plano; cluster inclui tenant suspenso, planos não. |
| 2 (T19a/T19b) | 0 🔴, 4 🟡, 1 ❓, 1 🔵 | Corrigidos em T19c: timeout de aguardando derrubava as 4 métricas do tick; `getCapacity` pendurado travava a tela (8 s); regra exata do entitlement nos docs; changelogs com as correções; afirmação operacional movida do código para o doc com data. |
| 3 (T19c) | 0 🔴, 0 🟡, 2 🔵 | Só nits, aceitos. |
| Smoke (local, descartável, sem adoção) | 0 🔴, 3 🟡, 7 🔵 | Funcional ok (10 ticks, rota, tabela por plano, alerta 87,5 % / 80 %, sem chamada externa). Corrigidos em T19d: `sessions_capacity` pela última leitura da janela; borda pontilhada; rótulo sobre o ícone em 390 px; textos; ordem dos planos; botão de suporte oculto. Fora: rótulos repetidos do eixo no `TimeLineChart` compartilhado. |
| 4 (T19d) | 0 🔴, 3 🟡, 1 🔵 | Corrigidos em T19e: aviso de ocupação comparava teto por worker com total do cluster; `meta.agg` em todo agregado; changelogs. |
| 5 (T19e) | 0 🔴, 0 🟡, 2 🔵 | Só nits (teste negativo sem `waitFor`; `meta.agg` ausente em amostras antigas — doc ajustado). Convergiu. |

Formato real das amostras da Render conferido em produção (leitura, 2026-11-11): `meta.unit='bytes'`, `resource='srv-<id>-<sufixo>'`.
