import { Box, alpha } from '@mui/material';
import { APP_NAME, BRAND_ASSETS } from './brand';

interface BrandLogoProps {
  /** Lado do tile em px. */
  size?: number;
}

/**
 * Logo em tile branco com borda sutil: o PNG tem fundo branco, então o tile
 * garante contraste igual sobre gradiente, tema claro e tema escuro.
 */
export function BrandLogo({ size = 44 }: BrandLogoProps) {
  return (
    <Box
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: `${Math.round(size * 0.3)}px`,
        bgcolor: '#fff',
        border: '1px solid',
        // No tema claro o tile fica sobre fundo branco/cinza-claro: borda e sombra
        // sutis delimitam; no escuro o próprio contraste do tile basta.
        borderColor: (theme) =>
          theme.palette.mode === 'light' ? alpha(theme.palette.text.primary, 0.14) : 'transparent',
        boxShadow: (theme) =>
          theme.palette.mode === 'light' ? '0 1px 3px rgba(15, 17, 23, 0.10)' : 'none',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Box
        component="img"
        src={BRAND_ASSETS.logo}
        alt={APP_NAME}
        sx={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
      />
    </Box>
  );
}
