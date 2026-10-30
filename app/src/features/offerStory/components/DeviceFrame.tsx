import type { ReactNode } from 'react';
import { Box, alpha } from '@mui/material';
import { floatShadow } from '../storyStyle';

interface Props {
  children: ReactNode;
  /** Largura máxima da moldura (responsiva). */
  maxWidth?: string | number | Partial<Record<'xs' | 'sm' | 'md' | 'lg' | 'xl', string | number>>;
  /** Abaixo de `md`, limita a altura da tela a N% da viewport (`vh`, trocado por `dvh` onde houver). */
  fitViewportHeight?: number;
}

/** Largura que dá à tela 9:16 a altura `n` (unidade vh/dvh), mais o bezel lateral (2 × 6px). */
const widthForHeight = (n: number, unit: 'vh' | 'dvh') => `min(calc(${n}${unit} * 9 / 16 + 12px), 100%)`;

/**
 * Celular 9:16 de bezel fino. A "ilha" fica na faixa do bezel, acima da tela: nunca cobre a arte.
 * Bezel escuro nos dois modos (é um aparelho), com filete claro para destacar do fundo escuro.
 */
export function DeviceFrame({ children, maxWidth = 300, fitViewportHeight }: Props) {
  return (
    <Box
      sx={(th) => ({
        position: 'relative', width: '100%', mx: 'auto', maxWidth,
        p: '6px', pt: '22px', pb: '10px', borderRadius: '34px',
        bgcolor: th.palette.grey[900],
        boxShadow: `${floatShadow(th, true)}, inset 0 0 0 1px ${alpha(th.palette.common.white, th.palette.mode === 'dark' ? 0.14 : 0.08)}`,
        ...(fitViewportHeight && {
          [th.breakpoints.down('md')]: { maxWidth: widthForHeight(fitViewportHeight, 'vh') },
          '@supports (height: 1dvh)': { [th.breakpoints.down('md')]: { maxWidth: widthForHeight(fitViewportHeight, 'dvh') } },
        }),
      })}
    >
      <Box
        aria-hidden
        sx={(th) => ({
          position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
          width: 54, height: 7, borderRadius: 999, bgcolor: alpha(th.palette.common.white, 0.16),
        })}
      />
      <Box sx={{ aspectRatio: '9 / 16', borderRadius: '28px', overflow: 'hidden', bgcolor: 'grey.800' }}>{children}</Box>
    </Box>
  );
}
