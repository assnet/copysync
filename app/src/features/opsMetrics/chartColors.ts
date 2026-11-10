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
    /** Série 3 — Ociosas. */
    idle: c3,
    /** Ordem para séries por worker (até 3). */
    ordered: [c1, c2, c3] as const,
  };
}
