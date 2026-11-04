/**
 * Tokens visuais dos assistentes de sessão (casca, seletor de canal, conexão, pronto).
 * Cor sempre derivada do tema + `brandColor` do canal: funciona em claro, escuro e sistema.
 * Sem React: só funções de estilo e keyframes. Ver docs/sessoes-conexao.md.
 */
import { alpha, keyframes, type Theme } from '@mui/material/styles';
import { brandColor } from '@/components';
import type { SessionChannel } from './utils';

/** Cor da marca do canal para o modo atual do tema. */
export const brand = (theme: Theme, channel: SessionChannel) => brandColor(channel, theme.palette.mode);

/** Cor de texto/ícone legível sobre `brand`. */
export const onBrand = (theme: Theme, channel: SessionChannel) =>
  theme.palette.getContrastText(brand(theme, channel));

/** Fundo suave da marca a partir do canto superior esquerdo (`scale` reduz a intensidade). */
export const brandWash = (theme: Theme, channel: SessionChannel, scale = 1) => {
  const k = (theme.palette.mode === 'dark' ? 0.18 : 0.1) * scale;
  return `radial-gradient(120% 140% at 0% 0%, ${alpha(brand(theme, channel), k)} 0%, transparent 60%)`;
};

/** Halo de destaque (passo ativo, item em foco). */
export const brandRing = (theme: Theme, channel: SessionChannel) =>
  `0 0 0 4px ${alpha(brand(theme, channel), 0.16)}`;

export const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';

/** Contorno de foco visível na cor do canal (usar em `&:focus-visible`). */
export const focusRing = (theme: Theme, channel: SessionChannel) => ({
  outline: `2px solid ${brand(theme, channel)}`,
  outlineOffset: 2,
});

/** Entrada de cada passo: 220ms cubic-bezier(.2,.8,.2,1). */
export const STEP_IN_EASING = 'cubic-bezier(.2,.8,.2,1)';
export const stepIn = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
`;

/** Tracejado "fluindo" (SVG com `strokeDasharray: '4 4'`): 1.2s linear infinite. */
export const dashFlow = keyframes`
  from { stroke-dashoffset: 12; }
  to { stroke-dashoffset: 0; }
`;

/** Anel que expande e some (Pronto): 900ms, 2 iterações. */
export const ring = keyframes`
  from { transform: scale(.7); opacity: .45; }
  to { transform: scale(1.7); opacity: 0; }
`;
