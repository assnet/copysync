import { Box, Typography } from '@mui/material';
import { Headphones } from 'lucide-react';
import { AppIcon } from '@/components';
import type { Dimensions } from '../rules';
import { offerWatermarkStrings } from '../strings';
import type { WatermarkDraft } from '../types';
import { WatermarkOverlay } from './WatermarkOverlay';

const t = offerWatermarkStrings.preview;

/** Foto de exemplo (quadrada, como a foto de 600 px das ofertas): a conta é feita nesta escala. */
const PHOTO: Dimensions = { width: 600, height: 600 };

interface Props {
  value: WatermarkDraft;
  imageUrl: string | null;
}

/**
 * Prévia ao vivo: foto de exemplo gerada (fundo neutro + produto em ícone) e a marca por cima (`WatermarkOverlay`,
 * a mesma camada da prévia da oferta no gerador). Sem logo/texto: contorno tracejado no lugar da marca.
 */
export function WatermarkPreview({ value, imageUrl }: Props) {
  return (
    <Box>
      <Box
        role="img"
        aria-label={t.photoAlt}
        data-testid="watermark-preview"
        sx={{
          position: 'relative', width: '100%', aspectRatio: '1 / 1', overflow: 'hidden', borderRadius: 3,
          // Foto de produto: fundo claro de estúdio nos dois temas (é a foto, não a interface)
          background: 'radial-gradient(circle at 50% 40%, #ffffff 0%, #eef1f5 55%, #d9dee6 100%)',
          border: '1px solid', borderColor: 'divider',
        }}
      >
        <Box aria-hidden sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3b4252' }}>
          <AppIcon icon={Headphones} style={{ width: '46%', height: '46%' }} strokeWidth={1.25} />
        </Box>

        <WatermarkOverlay
          mark={value}
          logoUrl={imageUrl}
          photo={PHOTO}
          placeholderText={t.emptyText}
          placeholder={(
            <Box
              sx={{
                width: '100%', height: '100%', borderRadius: 1, border: '1.5px dashed rgba(59,66,82,0.6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', p: 0.25,
              }}
            >
              <Typography component="span" sx={{ fontSize: 10, lineHeight: 1.1, textAlign: 'center', color: '#3b4252', fontWeight: 600 }}>
                {value.kind === 'IMAGE' ? t.emptyLogo : t.emptyText}
              </Typography>
            </Box>
          )}
        />
      </Box>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1, lineHeight: 1.45 }}>
        {value.enabled ? t.subtitle : t.off}
      </Typography>
    </Box>
  );
}
