import { Box, Tooltip } from '@mui/material';
import { MarketplaceLogo } from '@/features/settings/components/MarketplaceLogo';
import type { HuntProvider } from '../types';
import { huntBrandName } from '../strings';
import { huntProviderBrand } from '../providers';

/**
 * Logo da loja (Tooltip e leitor de tela com o nome). A logo é decorativa: o nome vai no texto oculto.
 * Medidas do texto oculto em px (no `sx`, `width: 1` = 100% e estourava a largura da página).
 */
export function ProviderBadge({ provider, size = 24 }: { provider: HuntProvider; size?: number }) {
  const name = huntBrandName(provider);
  return (
    <Tooltip title={name} arrow describeChild enterTouchDelay={0}>
      <Box component="span" tabIndex={0} data-testid={`provider-badge-${provider}`} sx={{ display: 'inline-flex', flexShrink: 0, borderRadius: 1 }}>
        <MarketplaceLogo src={huntProviderBrand(provider).logo} size={size} />
        <Box component="span" sx={visuallyHidden}>{name}</Box>
      </Box>
    </Tooltip>
  );
}

const visuallyHidden = {
  position: 'absolute', width: '1px', height: '1px', p: 0, m: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
} as const;
