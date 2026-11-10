# Design — aba "Consumo" em Workers (super admin)

Tela: `/admin/workers` (`app/src/pages/admin/AdminWorkersPage.tsx`). Dado de infraestrutura
(`docs/ops-metricas.md`): sem tenant, sem PII. Este doc é só o desenho; contrato da API vem da
trilha paralela — onde estiver marcado *(contrato esperado)*, ajustar ao que a API entregar.

## 1. Decisão de biblioteca de gráfico

Instalado: `@mui/material` 6.5.0, `react` 19.2.4.

| Alternativa | Veredito | Por quê |
|---|---|---|
| `@mui/x-charts` **8.29.3** (pin exato, sem `^`) | **Escolhida** | Peer `@mui/material ^5.15.14 \|\| ^6 \|\| ^7` e `react ^17–^19`: compatível. Lê `theme.palette` (claro/escuro sem código extra), tooltip por eixo com crosshair, `ChartsReferenceLine` para limiar, área empilhada, `SparkLineChart` para os KPIs. Publicada em 2026-08-21 (> 2 semanas). |
| `@mui/x-charts` 9.x (latest 9.17.0) | Recusada | Peer exige `@mui/material ^7.3`: quebraria o painel inteiro. |
| `@mui/x-charts` 7.29.1 | Recusada | Linha antiga (abr/2025), sem as correções da v8; mesmo custo de bundle. |
| SVG próprio | Recusada (exceto se o bundle estourar) | Zero dependência, mas teríamos de escrever eixo de tempo, ticks, crosshair, tooltip acessível, empilhamento, banda min–max e foco por teclado: ~600+ linhas para manter numa tela que só o super admin abre. |

**Bundle**: a aba Consumo é carregada com `React.lazy` (já há precedente em `EmojiPicker.tsx`),
então o x-charts só entra num chunk próprio, baixado ao abrir a aba. Medir no `vite build`; teto
aceitável ≈ 90 KB gzip para o chunk. Importar por subcaminho (`@mui/x-charts/LineChart`,
`/BarChart`, `/SparkLineChart`, `/ChartsReferenceLine`), nunca o barrel. Passar `skipAnimation`
sempre (refresh de 60 s não pode re-animar; cobre `prefers-reduced-motion`).

## 2. Estrutura e rota

- Abas MUI `Tabs` logo abaixo do `PageHeader`: **Ocupação** (`/admin/workers`, conteúdo atual,
  intacto) | **Consumo** (`/admin/workers/usage`). Cada `Tab` é link (`component={Link}`), aba
  ativa vem da URL (deep link, voltar do navegador funciona). Aba não vai para `usePersistedState`.
- `AppRoutes.tsx`: adicionar `/admin/workers/usage` (mesmo componente de página, que escolhe a aba
  pelo `pathname`). `navigation/model.ts`: item `admin-workers` ganha `matchPrefix: '/admin/workers'`.
- Pasta nova (white label): `app/src/features/opsMetrics/`
  - `strings.ts` (`opsMetricsStrings`), `types.ts`, `rules.ts` (puras: status vs limiar, delta de
    counter, formatação, tamanho do balde), `chartColors.ts`, `useOpsMetrics.ts`,
    `components/UsageTab.tsx` (default export, alvo do `lazy`), `UsageKpiTile.tsx`,
    `MetricChartCard.tsx`, `TopQueriesTable.tsx`, `CollectionOffState.tsx`.
  - Serviço HTTP em `services/adminOpsMetrics.service.ts` (Axios central).
- Rótulos das abas ficam em `workersAdminStrings.tabs` (a aba é da tela Workers).

## 3. Layout

### Desktop (≥ md, conteúdo ~1100 px)

```
Workers                                              [● Coleta ativa] Atualizado há 2 min [⟳]
Ocupação dos servidores e consumo de recursos.
┌ Ocupação ┬ Consumo ┐──────────────────────────────────────────────────────────────────────
Período [1 h|6 h|24 h|7 d]   Recurso [Todos|API|Postgres]   (o) Atualizar a cada 60 s
┌─────────────┬─────────────┬─────────────┬─────────────┬─────────────┬─────────────┐
│RAM · API    │CPU · API    │RAM · Postgr.│CPU · Postgr.│Conexões     │Cache hit    │
│ 62%  ✓ Ok   │ 34%  ✓ Ok   │ 81% ▲Crítico│ 12%  ✓ Ok   │ 18 · 1 ociosa│ 99,6% ✓ Ok │
│1.270 de 2.048│ ╱╲_╱‾╲_    │ ‾‾╱‾‾‾      │ __╱╲__      │em transação │ ‾‾‾‾‾‾      │
└─────────────┴─────────────┴─────────────┴─────────────┴─────────────┴─────────────┘
SERVIDORES
┌ CPU (%) ─────────────── [tabela] ┐ ┌ Memória (%) ─────────── [tabela] ┐
│100┤                              │ │100┤                              │
│ 80┤- - - - - Limite de alerta 80%│ │ 80┤- - - - - Limite de alerta 80%│
│   │  ▁▂▃╱╲▂▁  ── API ── Postgres │ │   │ ───────────╱‾‾‾  API         │
│  0└──┬────┬────┬────┬────┬───    │ │  0└──┬────┬────┬────┬────┬───    │
└──────────────────────────────────┘ └──────────────────────────────────┘
BANCO DE DADOS
┌ Conexões por estado (empilhado) ┐ ┌ Ociosas em transação ── lim. 3 ┐
└─────────────────────────────────┘ └────────────────────────────────┘
┌ Cache hit (%) ──── ideal ≥ 99% ┐ ┌ Transações por minuto (commit) ┐
└─────────────────────────────────┘ └────────────────────────────────┘
 Rollbacks no período 12 · Deadlocks no período 0 · Arquivos temporários 3,4 MB
┌ Consultas que mais consumiram tempo ─────────────────────────────────────────────────┐
│ #  Forma da consulta                           Tempo total   Participação   ID       │
│ 1  SELECT … FROM "messages" WHERE "tenant_i…   4 min 12 s    ████░░ 38%     -4721…[⧉]│
└──────────────────────────────────────────────────────────────────────────────────────┘
WORKERS
┌ Memória por worker (MB) ┐ ┌ Event loop p99 (ms) ── lim. 200 ┐   (ou aviso de adoção)
└─────────────────────────┘ └─────────────────────────────────┘
```

### Mobile (360 px, gutter 16)

```
Workers
[● Coleta ativa]  há 2 min  [⟳]
[ Ocupação | Consumo ]          ← Tabs variant="fullWidth"
[ 1 h | 6 h | 24 h | 7 d ]      ← largura total
[ Todos | API | Postgres ]      ← largura total
(o) Atualizar a cada 60 s
┌──────────┐┌──────────┐        ← KPIs 2 por linha (xs=6), ~156 px
│RAM · API ││CPU · API │
│62% ✓ Ok  ││34% ✓ Ok  │
│~╱╲_      ││_╱‾╲      │
└──────────┘└──────────┘
┌ CPU (%) ──── [tabela] ┐       ← gráficos 1 por linha, altura 180
│ legenda acima do plot │
└───────────────────────┘
Consultas → lista de cards (forma em 2 linhas com reticências, tempo e % abaixo)
```

Grade: `Grid container spacing={2}`; KPIs `xs=6 sm=4 lg=2`; gráficos `xs=12 md=6`; tabela `xs=12`.
Títulos de seção (`SERVIDORES`…) em `overline` `text.secondary`, `mt: 4, mb: 1.5`. Nada de scroll
horizontal da página; tabela de consultas vira cards em `xs`.

## 4. Cabeçalho

- `PageHeader` com `title` "Workers", `subtitle` genérico da tela; `action` só na aba Consumo:
  - Chip de estado: `samplerActive` → `success` outlined, ícone `Activity`, "Coleta ativa";
    senão `default` outlined, ícone `CirclePause`, "Coleta desligada". Tooltip explicativo.
  - "Atualizado há {x}" (`formatRelativeTime` com `serverNow()`), `<time dateTime>` com tooltip
    da data completa; base = horário da amostra mais recente (`latest.at`), não do fetch.
  - `IconButton` `RefreshCw` (`aria-label` + Tooltip "Atualizar agora"); gira só enquanto busca
    (desligado sob `prefers-reduced-motion`).
- `aria-live="polite"` num `span` visualmente oculto anunciando "Dados atualizados" só no refresh
  manual (o automático não anuncia, para não falar a cada minuto).

## 5. Filtros e persistência

Uma linha acima de tudo (escopa KPIs, gráficos e tabela):

| Controle | Componente | Valores | Padrão |
|---|---|---|---|
| Período | `ToggleButtonGroup` exclusivo, `size="small"` | `1h` `6h` `24h` `7d` | `24h` |
| Recurso | `ToggleButtonGroup` exclusivo | `all` `api` `postgres` | `all` |
| Atualização | `Switch` + `FormControlLabel` | 60 s liga/desliga | ligado |

- `usePersistedState('workers.usage.filters', { range: '24h', resource: 'all', autoRefresh: true },
  { version: 1 })` — escopo `tab`. Nada mais persiste (dados vêm da API).
- Recurso filtra só os gráficos/KPIs de CPU e RAM (série API × Postgres). Seções Banco de dados
  e Workers aparecem sempre (são do Postgres/worker por natureza); com `api` selecionado o
  Banco continua visível — o filtro não esconde seção, só séries de CPU/RAM.
- Auto-atualização (no hook, igual a `useAdminWorkers`): `setInterval` 60 s que pula se
  `document.hidden`; no `visibilitychange` para visível, busca na hora se a última busca tem
  > 60 s. Falha no refresh mantém dados e mostra `Alert` warning "Não foi possível atualizar…".
  Mudar filtro busca na hora e reinicia o intervalo.
- Balde por período (`rules.bucketFor`), para 70–100 pontos por gráfico: 1 h → 5 min (12 pts),
  6 h → 5 min (72), 24 h → 15 min (96), 7 d → 2 h (84). O cliente pede `bucket`; se a API decidir
  o balde, usar o devolvido *(contrato esperado)*.

## 6. KPIs "agora" (`UsageKpiTile`)

`StatCard` não serve (sem status nem sparkline); componente próprio da feature, mesmo `Card`/raio.

Conteúdo: rótulo (`caption` 600 maiúsculo, como o StatCard) + ícone `inline`; valor `h5` 800
`tabular-nums`; linha de contexto `caption` (`1.270 de 2.048 MB`); chip de status; sparkline
(`SparkLineChart`, 2 px, altura 32, cor da série do recurso, sem eixo, período do filtro, banda
não). Tooltip no rótulo (ícone `Info` `sm` focável) com o texto explicativo da métrica (§11).

| KPI | Valor | Contexto | Ícone |
|---|---|---|---|
| RAM · API | `memory_pct` api | `x de 2.048 MB` (pct × 2048) | `MemoryStick` |
| CPU · API | `cpu_pct` api | "média de 5 min" | `Cpu` |
| RAM · Postgres | `memory_pct` postgres | — | `MemoryStick` |
| CPU · Postgres | `cpu_pct` postgres | "média de 5 min" | `Cpu` |
| Conexões | `db_connections` | "{n} ociosa(s) em transação" | `Database` |
| Cache hit | `db_cache_hit_pct` | "ideal ≥ 99%" | `Gauge` |

Filtro de recurso esconde os tiles do outro recurso (grade reflui). Sem valor → "—" e chip
"Sem dados" neutro.

**Status** (`rules.statusFor`, limiares vindos de `latest.thresholds`, nunca fixos no front):

| Nível | Regra | Chip |
|---|---|---|
| Ok | < 87,5% do limiar (ex.: RAM < 70%) | `success` outlined, `CircleCheck`, "Ok" |
| Atenção | ≥ 87,5% do limiar e < limiar | `warning` outlined, `TriangleAlert`, "Atenção" |
| Crítico | ≥ limiar (RAM ≥ 80, CPU ≥ 80 na amostra de 5 min, idle in tx ≥ 3, p99 ≥ 200) | `error` filled, `OctagonAlert`, "Acima do limite" |

Cache hit (sem limiar na API): Ok ≥ 99, Atenção 95–99, Crítico < 95 — decisão de tela, constante
em `rules.ts` com comentário. Status sempre ícone + texto (nunca só cor). As cores de status
(`success/warning/error` do tema) são reservadas: nenhuma série de gráfico as usa.

## 7. Gráficos (`MetricChartCard`)

Cartão = `SectionCard` com título, subtítulo de unidade, ação "Ver tabela" (`ToggleButton` com
`Table2`/`ChartLine`, alterna gráfico ↔ tabela; tabela tem as mesmas linhas: horário, média, mín,
máx). Plot: altura 220 (md+) / 180 (xs); margem esquerda só a do eixo.

**Anatomia comum**
- Eixo X tempo (`scaleType: 'time'`), ticks `HH:mm` (1 h–24 h) ou `dd/MM` (7 d), fuso do
  navegador, `pt-BR`. Eixo Y com unidade no subtítulo, não em cada tick; grade só horizontal,
  cor `divider`. Um eixo Y por gráfico (nunca eixo duplo; medidas diferentes = gráficos diferentes).
- Linha 2 px da média; banda mín–máx como área da mesma cor, opacidade 0,14 (claro) / 0,20
  (escuro), sem borda. Sem marcadores, exceto ponto 8 px no último valor.
- Limiar: `ChartsReferenceLine` tracejada 1 px (`strokeDasharray 4 4`), cor `text.secondary`,
  rótulo à direita acima da linha em `caption` ("Limite de alerta 80%"). Neutra de propósito:
  não compete com as séries nem com o chip de status.
- Tooltip `trigger="axis"` (crosshair): horário completo no topo, depois uma linha por série:
  **valor em negrito** + rótulo, com traço da cor da série; para banda: "34% (mín 20 · máx 61)".
- Legenda acima do plot, alinhada à esquerda, sempre que ≥ 2 séries; com ≤ 4 séries também
  rótulo direto no fim da linha (identidade nunca só por cor). 1 série: sem legenda.
- Buraco na série (amostra faltando > 2 baldes): linha interrompida (`connectNulls: false`).
- Domínio Y: % fixo 0–100; cache hit `[min(90, menor valor), 100]`; contagens `[0, max×1,1]`
  incluindo o limiar no domínio para a linha sempre aparecer.

**Cores categóricas** (`chartColors.ts`, por `theme.palette.mode`; validadas com
`dataviz/scripts/validate_palette.js` contra `background.paper` real `#ffffff` / `#1a1d27`):

| Uso | Claro | Escuro |
|---|---|---|
| Série 1 — API / Ativas | `#2a78d6` | `#3987e5` |
| Série 2 — Postgres / Ociosas em transação | `#eb6834` | `#d95926` |
| Série 3 — Ociosas | `#1baf7a` | `#199e70` |

- API×Postgres (2 cores): PASS claro e escuro.
- Empilhado na ordem Ativas → Ociosas → Ociosas em transação (azul, verde-água, laranja): PASS;
  verde-água no claro tem contraste 2,82:1 → obrigatório legenda + rótulo direto + "Ver tabela"
  (já previstos). Gap de 2 px (`stroke` da cor de `background.paper`) entre camadas.
- Recusado: azul + violeta para API×Postgres (falha CVD ΔE 4,5 e visão normal 10,5).
- Cor segue a entidade dentro de cada gráfico; filtro de recurso não repinta a série restante.
- Workers (n séries por worker): até 3 workers no gráfico com as 3 cores acima na ordem de
  `workerId`; acima de 3, gráfico some e fica só a tabela (sem gerar cor nova).

**Estados por cartão**
- Carregando (1ª carga): `Skeleton variant="rounded"` com a altura exata do plot (sem CLS).
- Vazio: `EmptyState` compacto dentro do plot, ícone `ChartLine` `lg`, "Sem amostras neste período".
- Fonte Render ausente (CPU/RAM vazios mas Postgres com dados): vazio com texto específico
  (`renderMissing`, §11).
- Erro: `Alert` error dentro do cartão + botão "Tentar de novo" (falha de um cartão não derruba
  a aba).

## 8. Seção Servidores

Dois cartões lado a lado: **CPU (%)** e **Memória (%)**, séries API e Postgres conforme filtro,
limiar 80. Tooltip da Memória mostra também MB da API (`pct × 2048`). Nota de rodapé `caption`
no CPU: "O alerta dispara quando a média de 5 minutos passa de 80%."

## 9. Seção Banco de dados

1. **Conexões por estado** — área empilhada (`stack: 'total'`, `area: true`): Ativas, Ociosas,
   Ociosas em transação; tooltip mostra também o total (`db_connections`) e "Outras" se
   total > soma (não desenhar "Outras" como camada). Sem limiar.
2. **Ociosas em transação** — linha `db_idle_in_transaction` (máx do balde, pois o limiar é de
   pico), limiar 3; tooltip inclui "mais antiga há {n} s" (`db_idle_in_transaction_max_age_s`).
3. **Cache hit (%)** — linha, referência neutra "Ideal ≥ 99%".
4. **Commits por minuto** — barras por balde (delta do counter ÷ minutos do balde;
   `rules.counterDelta` descarta delta negativo = reinício do Postgres e marca o balde como
   vazio). Barras com cantos 4 px no topo, 2 px de gap.
5. Faixa de contadores do período (texto, não gráfico; volumes baixos): **Rollbacks**,
   **Deadlocks**, **Arquivos temporários** (soma dos deltas; bytes em KB/MB/GB `pt-BR`). Deadlock
   > 0 → chip `warning` com ícone ao lado.

### Consultas que mais consumiram tempo (`TopQueriesTable`)

Fonte: `db_statement_total_ms` (top N por `queryid`, delta no período; `meta.shape` truncado).

| Coluna | Conteúdo | Regra |
|---|---|---|
| # | posição | `tabular-nums`, largura fixa |
| Forma da consulta | `shape` em monospace `body2` | 1 linha, `OverflowTooltipText` (tooltip só se cortada, com o texto inteiro preservando quebras em `pre-wrap`, máx 480 px) |
| Tempo total | ms → "4 min 12 s" / "850 ms" | alinhado à direita, ordenação padrão desc |
| Participação | % do total das N | `LinearProgress` 6 px `primary` + número; `aria-label` "38% do tempo" |
| ID | `queryid` abreviado (8 últimos) | monospace `text.secondary`; botão `Copy` `sm` copia o id inteiro (Tooltip "Copiar ID", depois "Copiado") |

- Até 10 linhas; vazio: "Nenhuma consulta registrada no período" + dica de `pg_stat_statements`
  (§11). Mobile: cards (forma em 2 linhas com `-webkit-line-clamp`, tempo + % em linha abaixo).
- **Privacidade — sem flag de borrar, decisão justificada**: a forma é a consulta *normalizada*
  pelo `pg_stat_statements` (literais trocados por `$1`, `$2`) e truncada no servidor; não carrega
  valor de cliente, tenant, texto de mensagem nem número. É estrutura do schema, igual ao que está
  no repositório, e a tela é só super admin. Por isso não entra em `privacyFlags.ts`. Guarda: o
  front exibe só `meta.shape` (nunca outro campo), e se um dia a API mandar SQL não normalizado
  isso é bug da API (`docs/ops-metricas.md`: "sem SQL bruto"), não caso de borrar.

## 10. Seção Workers

- Há heartbeat (`workers.length > 0` com `rss_mb`/`event_loop_p99_ms` não vazios): dois cartões
  **Memória por worker (MB)** (sem limiar; se `OPS_MEMORY_LIMIT_MB` vier em `latest.thresholds`,
  linha de referência) e **Event loop p99 (ms)** (limiar 200). `node_cpu_pct` não ganha gráfico:
  entra como coluna na tabela do "Ver tabela" do card de memória (evita um 3º gráfico de pouco valor).
- Sem heartbeat: `Alert severity="info"` (mesmo padrão da `LeaseView`), ícone `Server`:
  texto `workers.adoptionOff` + Tooltip com `workers.adoptionOffHint` (cita `WORKER_ADOPTION_ENABLED`
  e `docs/arquitetura-escala.md`). Sem gráfico vazio.

## 11. Coleta desligada

- `samplerActive=false` e **nenhuma amostra** no período: a aba mostra só filtros + `CollectionOffState`
  (EmptyState com ícone `CirclePause` `lg`): título, texto e lista numerada de 3 passos (§12),
  nomes de variável em `<code>` monospace. Sem KPIs/gráficos vazios.
- `samplerActive=false` **com** amostras antigas: `Alert` warning no topo "A coleta está parada.
  Mostrando dados até {data}." e o resto normal (chip do cabeçalho "Coleta desligada").
- Ativa mas amostra mais recente > 15 min: `Alert` warning "A última amostra tem {x}. O coletor
  pode estar travado." (regra pura `rules.isStale`).

## 12. Microcopy (`features/opsMetrics/strings.ts`, pt-BR, sem marca)

```ts
export const opsMetricsStrings = {
  tabs: { occupancy: 'Ocupação', usage: 'Consumo' }, // vai em workersAdminStrings.tabs
  header: {
    collecting: 'Coleta ativa',
    collectingHint: 'Uma amostra a cada 5 minutos. Os dados ficam guardados por 7 dias.',
    notCollecting: 'Coleta desligada',
    notCollectingHint: 'Nenhuma amostra nova está sendo gravada.',
    updatedAt: (rel: string) => `Atualizado ${rel}`,
    refresh: 'Atualizar agora',
    refreshed: 'Dados atualizados',
  },
  filters: {
    range: 'Período', ranges: { '1h': '1 h', '6h': '6 h', '24h': '24 h', '7d': '7 dias' },
    rangeAria: 'Período dos gráficos',
    resource: 'Recurso', resources: { all: 'Todos', api: 'API', postgres: 'Postgres' },
    autoRefresh: 'Atualizar a cada 60 s',
    autoRefreshHint: 'Pausa sozinho quando esta aba do navegador fica em segundo plano.',
  },
  status: { ok: 'Ok', warning: 'Atenção', critical: 'Acima do limite', noData: 'Sem dados' },
  kpi: {
    ramApi: 'RAM · API', cpuApi: 'CPU · API', ramDb: 'RAM · Postgres', cpuDb: 'CPU · Postgres',
    connections: 'Conexões', cacheHit: 'Cache hit',
    ofMb: (used: number, limit: number) => `${used.toLocaleString('pt-BR')} de ${limit.toLocaleString('pt-BR')} MB`,
    avg5min: 'média de 5 min',
    idleInTx: (n: number) => (n === 1 ? '1 ociosa em transação' : `${n} ociosas em transação`),
    cacheIdeal: 'ideal ≥ 99%',
    trendAria: (label: string, min: string, max: string) => `Tendência de ${label} no período: de ${min} a ${max}`,
  },
  sections: { servers: 'Servidores', database: 'Banco de dados', workers: 'Workers' },
  charts: {
    cpu: 'CPU', cpuUnit: '% do limite do serviço',
    cpuNote: 'O alerta dispara quando a média de 5 minutos passa de 80%.',
    memory: 'Memória', memoryUnit: '% do limite do serviço',
    connections: 'Conexões por estado', connectionsUnit: 'conexões abertas no Postgres',
    idleInTx: 'Ociosas em transação', idleInTxUnit: 'pico por intervalo',
    oldestIdle: (s: number) => `mais antiga há ${s} s`,
    cacheHit: 'Cache hit', cacheHitUnit: '% de leituras atendidas pela memória',
    commits: 'Commits por minuto', commitsUnit: 'transações confirmadas',
    workerMemory: 'Memória por worker', workerMemoryUnit: 'MB em uso pelo processo',
    eventLoop: 'Event loop p99', eventLoopUnit: 'milissegundos',
    threshold: (v: string) => `Limite de alerta ${v}`,
    ideal: (v: string) => `Ideal ≥ ${v}`,
    series: { api: 'API', postgres: 'Postgres', active: 'Ativas', idle: 'Ociosas', idleInTx: 'Ociosas em transação', other: 'Outras', total: 'Total' },
    bandTooltip: (avg: string, min: string, max: string) => `${avg} (mín ${min} · máx ${max})`,
    showTable: 'Ver tabela', showChart: 'Ver gráfico',
    tableCols: { time: 'Horário', avg: 'Média', min: 'Mínimo', max: 'Máximo' },
    figureAria: (title: string, avg: string, max: string, limit?: string) =>
      `${title}: média ${avg}, pico ${max}${limit ? `, limite ${limit}` : ''}`,
    empty: 'Sem amostras neste período',
    renderMissing: 'Sem dados de CPU e memória. Confira RENDER_API_KEY e RENDER_RESOURCE_IDS no serviço worker.',
    error: 'Não foi possível carregar este gráfico.',
  },
  counters: {
    rollbacks: 'Rollbacks no período', deadlocks: 'Deadlocks no período', tempFiles: 'Arquivos temporários',
  },
  queries: {
    title: 'Consultas que mais consumiram tempo',
    subtitle: 'Forma normalizada da consulta, sem valores. Soma do tempo de execução no período.',
    cols: { rank: '#', shape: 'Forma da consulta', total: 'Tempo total', share: 'Participação', id: 'ID' },
    shareAria: (pct: number) => `${pct}% do tempo`,
    copyId: 'Copiar ID', copied: 'Copiado',
    empty: 'Nenhuma consulta registrada no período',
    emptyHint: 'Depende da extensão pg_stat_statements no Postgres.',
  },
  workers: {
    adoptionOff: 'Sem batimento de worker: métricas por processo aparecem quando a adoção por capacidade estiver ligada.',
    adoptionOffHint: 'Ligue WORKER_ADOPTION_ENABLED no serviço worker (veja docs/arquitetura-escala.md). Até lá, CPU e RAM do serviço aparecem em Servidores.',
  },
  off: {
    title: 'A coleta de métricas está desligada',
    description: 'Nenhuma amostra foi gravada neste período. Para começar a medir:',
    steps: [
      'No serviço worker da Render, defina RENDER_API_KEY e RENDER_RESOURCE_IDS (ids srv- e dpg-).',
      'Ligue OPS_METRICS_SAMPLER_ENABLED=true no mesmo serviço.',
      'Aguarde cerca de 5 minutos: a primeira amostra aparece aqui.',
    ],
    stopped: (date: string) => `A coleta está parada. Mostrando dados até ${date}.`,
    stale: (rel: string) => `A última amostra é de ${rel}. O coletor pode estar travado.`,
  },
  refreshFailed: 'Não foi possível atualizar. Mostrando os últimos dados recebidos.',
  retry: 'Tentar de novo',
  /** Explicações em linguagem simples (tooltip do ícone Info de cada KPI/gráfico). */
  help: {
    cpu_pct: 'Quanto do processador contratado o serviço está usando. Picos curtos são normais; acima de 80% por vários minutos, as respostas ficam lentas.',
    memory_pct: 'Quanto da memória contratada está em uso. Perto de 100% o serviço é reiniciado pela Render.',
    db_connections: 'Conexões abertas no banco agora. Cada processo da API mantém algumas; muitas de uma vez esgotam o limite do plano.',
    db_active: 'Conexões executando uma consulta neste instante.',
    db_idle: 'Conexões abertas e paradas, prontas para uso. Normal.',
    db_idle_in_transaction: 'Conexões que abriram uma transação e não terminaram. Seguram travas e atrasam outras consultas; 3 ou mais é sinal de problema.',
    db_cache_hit_pct: 'Parte das leituras atendida pela memória do banco, sem ir ao disco. Abaixo de 99% o banco tende a ficar lento.',
    db_xact_commit: 'Transações concluídas com sucesso. Mostra o volume de trabalho do banco.',
    db_xact_rollback: 'Transações desfeitas, por erro ou cancelamento. Alguns são normais; um salto indica falhas.',
    db_deadlocks: 'Duas transações esperando uma pela outra; o banco cancela uma. Qualquer valor acima de zero merece investigação.',
    db_temp_bytes: 'Dados que o banco precisou gravar em disco por falta de memória para ordenar ou agrupar. Muito volume indica consulta pesada.',
    db_statement_total_ms: 'Tempo somado de todas as execuções de cada consulta no período. Mostra onde o banco gasta mais esforço.',
    rss_mb: 'Memória ocupada pelo processo do worker.',
    event_loop_p99_ms: 'Atraso do processo para atender novas tarefas, no pior 1% dos casos. Acima de 200 ms, mensagens e conexões atrasam.',
  },
} as const;
```

## 13. Acessibilidade

- Contraste: texto sempre em `text.primary/secondary` (nunca na cor da série). Chips de status
  usam as variantes do tema, com ícone + texto.
- Cada plot dentro de `<figure role="group" aria-label={figureAria(...)}>`; SVG do gráfico
  `aria-hidden` quando a tabela equivalente existe ("Ver tabela" é o caminho acessível; o
  `aria-label` resume média/pico/limite). Sparkline: `aria-label` com `trendAria`.
- Teclado: abas, toggles, switch, "Ver tabela", copiar ID e ícones `Info` focáveis (Tooltip abre
  no foco, `enterTouchDelay={0}` no toque). Ordem de foco = ordem visual. Anel de foco do tema.
- `ToggleButtonGroup` com `aria-label`; botões de ícone com `aria-label` + Tooltip.
- Não depende só de cor: limiar com rótulo de texto, séries com legenda + rótulo direto, status com
  ícone e palavra, tabela equivalente.
- Alvo de toque ≥ 44 px nos controles no mobile (`ToggleButton` com `minHeight: 44` em `xs`).

## 14. Dados *(contrato esperado — alinhar com a trilha da API)*

- `GET /admin/ops/metrics/latest` → `{ at, samplerActive, thresholds, values: {metric, resource?,
  value, at}[], workers[] }`.
- `GET /admin/ops/metrics/series?metrics=…&range=24h&bucket=15m` → por métrica/recurso:
  `{ points: {t, avg, min, max}[] }`; `db_statement_total_ms` → `{ queryid, shape, totalMs }[]`.
- `useOpsMetrics(filters)` faz `latest` + `series` em paralelo; erro por bloco (servidores,
  banco, consultas, workers) para o §7 "Erro" funcionar por cartão.
- Rótulos de recurso no front: id `srv-…` → "API", `dpg-…` → "Postgres"; id nunca exibido.

## 15. Fora de escopo / não fazer

- Sem gráfico de pizza/gauge circular; sem eixo duplo; sem cor nova além das 3 séries.
- Sem chamada à Render pelo painel; sem `setInterval` sem pausa por aba oculta.
- Sem ícone sparkles/brilho; sem emoji; ícones só Lucide via `AppIcon`.
- Sem persistir dado da API; sem mexer no conteúdo da aba Ocupação.

## 16. Checklist de entrega (para o dev)

- `@mui/x-charts@8.29.3` no `app/package.json`; chunk lazy medido no build.
- Testes: `rules.test.ts` (status por limiar, delta de counter com reset, balde por período,
  `isStale`), teste da aba (coleta desligada, sem heartbeat, render ausente).
- Verificar no agent-browser: claro, escuro, 360 px, 1440 px; foco por teclado; tabela alternativa.
- Atualizar `docs/ops-metricas.md` (trocar "Sem tela" pela aba), CHANGELOG e versão do `app/`.
