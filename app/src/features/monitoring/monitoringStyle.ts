import { alpha, darken, keyframes, lighten, type SxProps, type Theme } from '@mui/material';

/**
 * Linguagem visual do Monitoramento ("radar / sinal"). Só tokens do tema + `alpha()`, para
 * funcionar igual em claro, escuro e sistema. Sem React, sem estado.
 */
export type MonitorTone = 'neutral' | 'primary' | 'info' | 'success' | 'warning' | 'error';
/** = `SystemStyleObject<Theme>` (`@mui/system` não é dependência direta do painel). */
type Sx = Exclude<SxProps<Theme>, ReadonlyArray<unknown> | ((theme: Theme) => unknown)>;

/** Media query sem o `@media` (para `useMediaQuery`: Collapse/Snackbar com timeout 0). */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
export const REDUCED_MOTION = `@media ${REDUCED_MOTION_QUERY}`;
export const CARD_RADIUS = '20px';
export const INNER_RADIUS = '14px';

/** Texto só para leitor de tela. */
export const VISUALLY_HIDDEN: Sx = {
  position: 'absolute', width: '1px', height: '1px', p: 0, m: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

/**
 * Anel de foco por teclado (2 px primary, offset 2) para botões, chips e cards do Monitoramento.
 * Local da feature: o tema global não muda. `Mui-focusVisible` cobre ButtonBase/Button/IconButton.
 */
export function focusRingSx(theme: Theme): Sx {
  const ring = { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: '2px' };
  return { '&:focus-visible': ring, '&.Mui-focusVisible': ring };
}

/** Mesmo anel aplicado a todo botão/elemento focável DENTRO do container (card, diálogo, hero). */
export function focusRingScopeSx(theme: Theme): Sx {
  const ring = { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: '2px' };
  return { '& .MuiButtonBase-root.Mui-focusVisible, & [tabindex="0"]:focus-visible': ring };
}

/** Anel de radar: conic-gradient primary → info → success → primary. */
export function radarGradient(theme: Theme): string {
  const { primary, info, success } = theme.palette;
  return `conic-gradient(from 210deg, ${primary.main}, ${info.main}, ${success.main}, ${primary.main})`;
}

/** Fundo do hero: radiais translúcidos de primary/info/success (k = .16 escuro, .10 claro). */
export function radarWash(theme: Theme): string {
  const k = theme.palette.mode === 'dark' ? 0.16 : 0.1;
  const { primary, info, success } = theme.palette;
  return [
    `radial-gradient(120% 140% at 100% 0%, ${alpha(info.main, k * 1.3)} 0%, transparent 55%)`,
    `radial-gradient(90% 120% at 0% 100%, ${alpha(primary.main, k)} 0%, transparent 60%)`,
    `radial-gradient(60% 80% at 70% 100%, ${alpha(success.main, k * 0.7)} 0%, transparent 60%)`,
  ].join(', ');
}

/** Sombra de cartão flutuante (mesma regra de storyStyle.floatShadow). */
export function floatShadow(theme: Theme, lifted = false): string {
  return theme.palette.mode === 'dark'
    ? `0 ${lifted ? 18 : 10}px ${lifted ? 36 : 24}px -12px ${alpha(theme.palette.common.black, 0.85)}`
    : `0 ${lifted ? 18 : 10}px ${lifted ? 36 : 24}px -14px ${alpha(theme.palette.text.primary, lifted ? 0.32 : 0.22)}`;
}

/** Cor principal do tom (neutral = text.secondary). */
export function toneMain(theme: Theme, tone: MonitorTone): string {
  return tone === 'neutral' ? theme.palette.text.secondary : theme.palette[tone].main;
}

/** Cor de TEXTO com contraste AA no modo atual (escuro: lighten .25; claro: darken .4). */
export function toneText(theme: Theme, tone: MonitorTone): string {
  if (tone === 'neutral') return theme.palette.text.secondary;
  const main = theme.palette[tone].main;
  return theme.palette.mode === 'dark' ? lighten(main, 0.25) : darken(main, 0.4);
}

/** Fundo + borda + texto tintados (chips, callouts, linhas de alerta). */
export function toneSurface(theme: Theme, tone: MonitorTone): { color: string; backgroundColor: string; borderColor: string } {
  const dark = theme.palette.mode === 'dark';
  const base = tone === 'neutral' ? theme.palette.text.primary : theme.palette[tone].main;
  return {
    color: toneText(theme, tone),
    backgroundColor: alpha(base, tone === 'neutral' ? (dark ? 0.08 : 0.05) : dark ? 0.16 : 0.1),
    borderColor: alpha(base, tone === 'neutral' ? 0.12 : dark ? 0.34 : 0.28),
  };
}

/** Card sem borda: paper, raio CARD_RADIUS, floatShadow; interactive = hover sobe 2 px; tone = filete 3 px à esquerda. */
export function surfaceSx(theme: Theme, opts: { interactive?: boolean; tone?: MonitorTone; selected?: boolean } = {}): Sx {
  const { interactive, tone, selected } = opts;
  const dark = theme.palette.mode === 'dark';
  const ring = selected ? `inset 0 0 0 2px ${theme.palette.primary.main}` : null;
  const edge = tone ? `inset 3px 0 0 ${toneMain(theme, tone)}` : null;
  const join = (shadow: string) => [edge, ring, shadow].filter(Boolean).join(', ');
  return {
    position: 'relative',
    bgcolor: 'background.paper',
    backgroundImage: 'none',
    borderRadius: CARD_RADIUS,
    border: '1px solid',
    borderColor: dark ? alpha(theme.palette.text.primary, 0.06) : 'transparent',
    boxShadow: join(floatShadow(theme)),
    ...(interactive && {
      transition: theme.transitions.create(['transform', 'box-shadow'], { duration: 200 }),
      '&:hover': { transform: 'translateY(-2px)', boxShadow: join(floatShadow(theme, true)) },
      [REDUCED_MOTION]: { transition: 'none', '&:hover': { transform: 'none' } },
    }),
  };
}

/** Pílula de vidro (status, contador, resumo da janela). */
export function glassPillSx(theme: Theme): Sx {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 0.75,
    px: 1.25,
    py: 0.5,
    borderRadius: 999,
    bgcolor: alpha(theme.palette.background.paper, 0.72),
    backdropFilter: 'blur(8px)',
    border: '1px solid',
    borderColor: alpha(theme.palette.text.primary, 0.08),
    typography: 'caption',
    fontWeight: 600,
    color: 'text.primary',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  };
}

/** Quadrado de ícone tintado (36 px padrão, raio 12). */
export function iconTileSx(theme: Theme, tone: MonitorTone = 'primary', size = 36): Sx {
  const s = toneSurface(theme, tone);
  return {
    width: size,
    height: size,
    flexShrink: 0,
    display: 'grid',
    placeItems: 'center',
    borderRadius: '12px',
    color: s.color,
    bgcolor: s.backgroundColor,
  };
}

/** Pulso do ponto "ao vivo" (opacidade 1 → .35 → 1). Usar com REDUCED_MOTION: animation none. */
export const livePulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
`;
