import { keyframes } from '@mui/material/styles';

/**
 * Animações da vitrine de planos. Só `transform`/`opacity`/`background-position` (sem reflow) e
 * todas desligadas em `prefers-reduced-motion` via `REDUCED_MOTION`. Sem brilhos/estrelas: o
 * destaque vem de luz e movimento, não de ícone.
 */

/** Entrada do card: sobe e aparece. O atraso escalonado vem do índice do card. */
export const cardEnter = keyframes`
  from { opacity: 0; transform: translateY(18px); }
  to { opacity: 1; transform: translateY(0); }
`;

/** Troca de preço ao mudar mensal/anual: o número novo desce para o lugar. */
export const priceSwap = keyframes`
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
`;

/** Gradiente da moldura do recomendado fluindo devagar (fundo com 200% de largura). */
export const gradientFlow = keyframes`
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
`;

/** Faixa de luz que atravessa o bloco em destaque e some; pausa longa entre passagens. */
export const sheenSweep = keyframes`
  0% { transform: translateX(-120%) skewX(-18deg); opacity: 0; }
  8% { opacity: 1; }
  38% { transform: translateX(320%) skewX(-18deg); opacity: 0; }
  100% { transform: translateX(320%) skewX(-18deg); opacity: 0; }
`;

/** Anel que se expande a partir do logo, como um aviso discreto de novidade. */
export const haloPulse = keyframes`
  0% { transform: scale(1); opacity: 0.55; }
  70% { transform: scale(1.75); opacity: 0; }
  100% { transform: scale(1.75); opacity: 0; }
`;

export const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';

/** Atraso de entrada por posição do card (ms). */
export const enterDelay = (index: number) => `${120 + index * 110}ms`;
