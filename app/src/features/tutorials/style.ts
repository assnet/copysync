import { alpha, type Theme } from '@mui/material/styles';

export const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';

/** Lavagem de marca do hero: só tokens do tema, vale em claro e escuro. */
export const heroWash = (theme: Theme): string =>
  `radial-gradient(60rem 22rem at 8% -20%, ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.3 : 0.16)}, transparent 70%),` +
  `radial-gradient(40rem 18rem at 100% 120%, ${alpha(theme.palette.secondary.main, theme.palette.mode === 'dark' ? 0.22 : 0.1)}, transparent 70%)`;

/** Gradiente de realce (botão principal, barra): primário → secundário, como o Story de Oferta. */
export const accentGradient = (theme: Theme): string =>
  `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`;

/** Véu sobre a capa do vídeo: precisa ser escuro nos dois temas para o texto/ícone branco ler. */
export const THUMB_SCRIM = 'linear-gradient(180deg, rgba(8,12,30,.35) 0%, rgba(8,12,30,0) 40%, rgba(8,12,30,.6) 100%)';
export const THUMB_FALLBACK = 'linear-gradient(135deg, #0b1230 0%, #2b4ccb 100%)';
