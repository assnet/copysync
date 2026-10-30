import type { ReactNode } from 'react';
import { Box } from '@mui/material';

/** Moldura de celular 9:16 para a arte. Só tokens do tema (claro/escuro). */
export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        position: 'relative', width: '100%', mx: 'auto', p: 1.25, borderRadius: 6,
        // xs: altura ~45vh para título e ações do passo 3 caberem sem rolar (largura 9:16 + padding).
        // `vh` como fallback; `dvh` (barra do navegador móvel) só onde há suporte.
        maxWidth: { xs: 'calc(45vh * 9 / 16 + 20px)', md: 320 },
        '@supports (height: 1dvh)': { maxWidth: { xs: 'calc(45dvh * 9 / 16 + 20px)', md: 320 } },
        bgcolor: 'background.paper', border: '1px solid', boxShadow: 6,
        borderColor: (th) => (th.palette.mode === 'dark' ? th.palette.grey[700] : th.palette.divider),
        outline: (th) => (th.palette.mode === 'dark' ? `1px solid ${th.palette.divider}` : 'none'),
        outlineOffset: 2,
      }}
    >
      <Box
        aria-hidden
        sx={{ position: 'absolute', top: 18, left: '50%', transform: 'translateX(-50%)', width: 72, height: 18, borderRadius: 999, bgcolor: 'common.black', opacity: 0.85, zIndex: 1 }}
      />
      <Box sx={{ aspectRatio: '9 / 16', borderRadius: 4.5, overflow: 'hidden', bgcolor: 'action.hover' }}>{children}</Box>
    </Box>
  );
}
