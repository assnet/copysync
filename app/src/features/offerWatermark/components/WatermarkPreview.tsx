import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { Headphones } from 'lucide-react';
import { AppIcon } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { computeWatermarkPlacement, measureWatermarkText, textMarkDimensions, type Dimensions } from '../rules';
import { offerWatermarkStrings } from '../strings';
import type { WatermarkDraft } from '../types';

const t = offerWatermarkStrings.preview;

/** Foto de exemplo (quadrada, como a foto de 600 px das ofertas): a conta é feita nesta escala. */
const PHOTO: Dimensions = { width: 600, height: 600 };
const pct = (px: number) => `${(px / PHOTO.width) * 100}%`;

interface Props {
  value: WatermarkDraft;
  imageUrl: string | null;
}

/**
 * Prévia ao vivo: foto de exemplo gerada (fundo neutro + produto em ícone) e a marca por cima, com
 * lugar e tamanho de `computeWatermarkPlacement` (cópia da regra da API) em % da foto e a mesma
 * opacidade. Logo esticado no retângulo calculado, como o `resize(fit: fill)` do servidor.
 */
export function WatermarkPreview({ value, imageUrl }: Props) {
  const blur = useBlur('offerWatermark.logo');
  const [logoDims, setLogoDims] = useState<{ url: string; dims: Dimensions } | null>(null);

  const isImage = value.kind === 'IMAGE';
  const text = value.text.trim();
  const hasMark = isImage ? Boolean(imageUrl) : text !== '';
  const markDims: Dimensions = isImage
    ? (logoDims && logoDims.url === imageUrl ? logoDims.dims : { width: 1, height: 1 })
    : textMarkDimensions(text || t.emptyText, measureWatermarkText);
  const place = computeWatermarkPlacement(PHOTO, markDims, value.position, value.size);

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

        <Box
          data-testid="watermark-mark"
          data-position={value.position}
          sx={{
            position: 'absolute',
            left: pct(place.left), top: pct(place.top), width: pct(place.width), height: pct(place.height),
            opacity: value.opacity / 100,
            transition: 'left 180ms ease-out, top 180ms ease-out, width 180ms ease-out, height 180ms ease-out',
            '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
          }}
        >
          {hasMark ? (
            <Blurred when={blur} radius={8} sx={{ width: '100%', height: '100%' }}>
              {isImage ? (
                <Box
                  component="img"
                  src={imageUrl ?? undefined}
                  alt=""
                  onLoad={(e) => {
                    const img = e.currentTarget as HTMLImageElement;
                    if (imageUrl && img.naturalWidth > 0) setLogoDims({ url: imageUrl, dims: { width: img.naturalWidth, height: img.naturalHeight } });
                  }}
                  sx={{ display: 'block', width: '100%', height: '100%', objectFit: 'fill' }}
                />
              ) : (
                <svg
                  viewBox={`0 0 ${markDims.width} ${markDims.height}`}
                  width="100%"
                  height="100%"
                  aria-hidden
                  style={{ display: 'block', overflow: 'visible', filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.9)) drop-shadow(0 1px 3px rgba(0,0,0,0.7))' }}
                >
                  <text
                    x="50%"
                    y="50%"
                    dominantBaseline="central"
                    textAnchor="middle"
                    fill="#FFFFFF"
                    fontSize={120}
                    fontWeight={800}
                    fontFamily="Inter, system-ui, sans-serif"
                  >
                    {text}
                  </text>
                </svg>
              )}
            </Blurred>
          ) : (
            <Box
              sx={{
                width: '100%', height: '100%', borderRadius: 1, border: '1.5px dashed rgba(59,66,82,0.6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', p: 0.25,
              }}
            >
              <Typography component="span" sx={{ fontSize: 10, lineHeight: 1.1, textAlign: 'center', color: '#3b4252', fontWeight: 600 }}>
                {isImage ? t.emptyLogo : t.emptyText}
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1, lineHeight: 1.45 }}>
        {value.enabled ? t.subtitle : t.off}
      </Typography>
    </Box>
  );
}
