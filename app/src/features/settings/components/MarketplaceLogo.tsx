import { Box, type SxProps, type Theme } from '@mui/material';

interface Props {
  src: string;
  size?: number;
  round?: boolean;
  sx?: SxProps<Theme>;
}

/**
 * Logo de marketplace em bloco de fundo branco nos dois temas: a logo tem cores próprias
 * e some sobre o fundo escuro. Decorativa — o nome do marketplace vem sempre ao lado.
 */
export function MarketplaceLogo({ src, size = 40, round, sx }: Props) {
  return (
    <Box
      aria-hidden
      sx={[
        {
          width: size, height: size, p: size >= 36 ? 0.875 : 0.5, flexShrink: 0,
          borderRadius: round ? '50%' : 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          bgcolor: 'common.white', border: 1, borderColor: 'divider',
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <Box component="img" src={src} alt="" sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
    </Box>
  );
}
