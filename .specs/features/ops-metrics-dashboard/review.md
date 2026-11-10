# Revisão — aba Consumo (Workers, super admin)

**Branch:** `feature/ops-metrics-dashboard` · api 0.75.0 · app 0.91.0 · 2026-11-09

| Rodada | Achados | Resultado |
|---|---|---|
| Código (`/caveman-review`) | 🔴 polling rearmava após cleanup; 🟡 min/max pela média de 5 min; taxa de counter inflada em buraco; filtro persistido inválido travava carregamento; conexões sem dado = Ok; séries sem teto; 🔵 snapshot sem statement_timeout; gráficos sem memo | Todos corrigidos (33507ba, 2e62b4c) |
| QA visual (agent-browser, 1440 e 360 px, claro/escuro) | Scroll horizontal no mobile, rótulos cortados, eixo X esticado, eixo Y sem topo, rótulos de commits, números en-US, rótulos diretos no mobile, pontos extras da faixa, svg no Tab, botão de atualizar perdia foco | Todos corrigidos (044554c) |
| Convergência | 🟡 eixo de commits sem rótulos em fuso de meia hora; 7 dias no celular sobrepunha rótulos; 🔵 corte de séries sem sinal na resposta | Os dois 🟡 corrigidos (32bd5e5); 🔵 documentado em `docs/ops-metricas.md` |

Aceitos: chunk da aba 105 KB gzip (lazy, só super admin; acima dos ~90 KB previstos por causa da lib);
requisição cancelada termina e é descartada (serviço sem AbortSignal); KPIs mantêm "Ok" com coleta
parada (o alerta amarelo explica). Parada por convergência.
