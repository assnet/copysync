import { alpha, darken, lighten, type SxProps, type Theme } from '@mui/material';

/**
 * Estilo da Base de contatos (super admin). Só tokens do tema + `alpha()`: igual em claro, escuro e sistema.
 */
type Sx = Exclude<SxProps<Theme>, ReadonlyArray<unknown> | ((theme: Theme) => unknown)>;

export const PANEL_RADIUS = '16px';
export const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';
export const NUMERIC: Sx = { fontVariantNumeric: 'tabular-nums', fontFeatureSettings: '"tnum"' };

export const VISUALLY_HIDDEN: Sx = {
  position: 'absolute', width: '1px', height: '1px', p: 0, m: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

/** Superfície dos painéis da tela (indicadores, tabela): papel com contorno, sem sombra. */
export function panelSx(theme: Theme): Sx {
  return { bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: PANEL_RADIUS, backgroundImage: 'none', boxShadow: 'none', color: theme.palette.text.primary };
}

export type RegionTone = 'primary' | 'success' | 'warning';

/** Cor de texto do tom com contraste AA no modo atual. */
export function toneText(theme: Theme, tone: RegionTone): string {
  const main = theme.palette[tone].main;
  return theme.palette.mode === 'dark' ? lighten(main, 0.3) : darken(main, 0.35);
}

/** Trilho neutro das barras (distribuição, progresso da lista). */
export function trackColor(theme: Theme): string {
  return alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.12 : 0.08);
}

/** Preenchimento suave do tom (barra de distribuição, selo). */
export function toneFill(theme: Theme, tone: RegionTone, strong = false): string {
  const dark = theme.palette.mode === 'dark';
  return alpha(theme.palette[tone].main, strong ? (dark ? 0.75 : 0.85) : dark ? 0.26 : 0.16);
}

export function focusRingSx(theme: Theme): Sx {
  const ring = { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: '2px' };
  return { '&:focus-visible': ring, '&.Mui-focusVisible': ring };
}

/** Cabeçalho da tabela: rótulo discreto sobre fundo levemente tingido. */
export function tableHeadSx(theme: Theme): Sx {
  return {
    '& th': {
      bgcolor: alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.05 : 0.03),
      color: 'text.secondary', fontSize: '0.75rem', fontWeight: 600, lineHeight: 1.4, py: 1.25, whiteSpace: 'nowrap',
      borderBottomColor: 'divider',
    },
  };
}
