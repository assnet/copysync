import type { PaletteMode } from '@mui/material';

/**
 * Cores categóricas dos gráficos, por modo do tema. Validadas (CVD e contraste) contra o
 * `background.paper` real (#ffffff / #1a1d27) — ver design da aba Consumo. Não usar as cores de
 * status (success/warning/error): elas são reservadas aos chips. Nunca gerar cor nova: mais de
 * 3 séries vira tabela.
 */
const CHART_COLORS: Record<PaletteMode, readonly [string, string, string]> = {
  light: ['#2a78d6', '#eb6834', '#1baf7a'],
  dark: ['#3987e5', '#d95926', '#199e70'],
};

/**
 * Séries por instância do worker ("Por instância"): começa no verde do Worker e segue em roxo e
 * magenta, sem o azul da API nem o laranja do Postgres (essas cores têm significado na mesma tela).
 * Roxo e magenta passam 3:1 contra o `background.paper` de cada modo. O verde é a cor já existente do
 * Worker e no claro fica em 2,82:1: a série não depende só dela, pois ganha rótulo no fim da linha.
 */
const INSTANCE_COLORS: Record<PaletteMode, readonly [string, string, string]> = {
  light: ['#1baf7a', '#7c4fd6', '#b0367a'],
  dark: ['#199e70', '#9b7af0', '#e06aa8'],
};

/** Opacidade da banda mín–máx. */
export const BAND_OPACITY: Record<PaletteMode, number> = { light: 0.14, dark: 0.2 };

export function chartColors(mode: PaletteMode) {
  const [c1, c2, c3] = CHART_COLORS[mode];
  return {
    /** Série 1 — API / Ativas. */
    api: c1,
    active: c1,
    /** Série 2 — Postgres / Ociosas em transação. */
    postgres: c2,
    idleInTx: c2,
    /** Série 3 — Worker (serviço da Render) / Ociosas. */
    workerService: c3,
    idle: c3,
    /** Ordem para séries por worker (até 3). */
    ordered: [c1, c2, c3] as const,
    /** Ordem para séries por instância do worker (até 3), sem as cores da API e do Postgres. */
    instances: INSTANCE_COLORS[mode],
  };
}
