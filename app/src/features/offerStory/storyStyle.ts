import { alpha, keyframes, type Theme } from '@mui/material';

/**
 * Gradiente "anel de story" montado só com tokens do tema (âmbar → vermelho → violeta → azul),
 * para funcionar igual em claro, escuro e sistema e acompanhar troca de paleta.
 */
export const storyGradient = (theme: Theme, angle = 45) => {
  const { warning, error, secondary, primary } = theme.palette;
  return `linear-gradient(${angle}deg, ${warning.main} 0%, ${error.main} 35%, ${secondary.main} 70%, ${primary.main} 100%)`;
};

/** Lavagem suave para fundos (hero, prévia): mesmas cores, translúcidas. */
export const storyWash = (theme: Theme) => {
  const k = theme.palette.mode === 'dark' ? 0.16 : 0.1;
  const { warning, error, secondary, primary } = theme.palette;
  return [
    `radial-gradient(120% 140% at 100% 0%, ${alpha(secondary.main, k * 1.4)} 0%, transparent 55%)`,
    `radial-gradient(90% 120% at 0% 100%, ${alpha(primary.main, k)} 0%, transparent 60%)`,
    `radial-gradient(60% 80% at 75% 100%, ${alpha(error.main, k * 0.6)} 0%, transparent 60%)`,
    `radial-gradient(50% 60% at 20% 0%, ${alpha(warning.main, k * 0.6)} 0%, transparent 60%)`,
  ].join(', ');
};

/** Sombra suave de "cartão flutuante"; mais profunda no escuro, onde sombra clara some. */
export const floatShadow = (theme: Theme, lifted = false) =>
  theme.palette.mode === 'dark'
    ? `0 ${lifted ? 18 : 10}px ${lifted ? 36 : 24}px -12px ${alpha(theme.palette.common.black, 0.85)}`
    : `0 ${lifted ? 18 : 10}px ${lifted ? 36 : 24}px -14px ${alpha(theme.palette.text.primary, lifted ? 0.32 : 0.22)}`;

export const popIn = keyframes`
  0% { transform: scale(0.6); opacity: 0; }
  70% { transform: scale(1.08); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
`;

export const riseIn = keyframes`
  from { transform: translateY(12px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
`;

export const shimmer = keyframes`
  from { background-position: 0% 0; }
  to { background-position: 200% 0; }
`;

export const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';

/** Texto só para leitor de tela. */
export const VISUALLY_HIDDEN = {
  position: 'absolute', width: '1px', height: '1px', p: 0, m: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
} as const;
