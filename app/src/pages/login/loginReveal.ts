import type { SxProps, Theme } from '@mui/material';

/** Nome do keyframe de entrada (sobe 14 px, fade e blur 6 px → 0). */
export const REVEAL_KEYFRAME = 'loginRise';
/** Duração de cada entrada (ms). */
export const REVEAL_MS = 520;
/** Stagger por palavra da headline (ms). */
export const REVEAL_WORD_STAGGER_MS = 70;
/** Stagger por item do índice / prova social (ms). */
export const REVEAL_ITEM_STAGGER_MS = 60;
/** Atraso do subtítulo (ms); os itens do índice começam logo depois. */
export const REVEAL_SUBTITLE_DELAY_MS = 420;
export const REVEAL_ITEMS_DELAY_MS = 600;

const EASE = 'cubic-bezier(.2,.7,.2,1)';

/**
 * Keyframes do reveal — declarar uma vez no container (Emotion registra o
 * `@keyframes` global a partir do `sx`). O estado final é o estado natural
 * do elemento: sem a animação o texto fica visível (nada tem opacidade 0 fora
 * do keyframe).
 */
export const REVEAL_KEYFRAMES: SxProps<Theme> = {
  [`@keyframes ${REVEAL_KEYFRAME}`]: {
    from: { opacity: 0, transform: 'translateY(14px)', filter: 'blur(6px)' },
    to: { opacity: 1, transform: 'none', filter: 'blur(0)' },
  },
};

/**
 * Estilo de entrada com atraso em ms. `both` mantém o `from` durante o atraso
 * (sequência) e o `to` ao final. Desligado em `prefers-reduced-motion: reduce`:
 * conteúdo aparece direto.
 */
export function revealSx(delayMs: number): SxProps<Theme> {
  return {
    animation: `${REVEAL_KEYFRAME} ${REVEAL_MS}ms ${EASE} both`,
    animationDelay: `${delayMs}ms`,
    willChange: 'opacity, transform, filter',
    '@media (prefers-reduced-motion: reduce)': { animation: 'none', willChange: 'auto' },
  };
}
