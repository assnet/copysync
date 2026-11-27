import { useState, type ReactNode } from 'react';
import { Box } from '@mui/material';
import { Blurred, useBlur } from '@/features/privacy';
import { TEXT_FONT_PX, computeWatermarkPlacement, measureWatermarkText, textMarkDimensions, type Dimensions } from '../rules';
import type { WatermarkKind, WatermarkPosition, WatermarkSize } from '../types';

export interface WatermarkOverlayMark {
  kind: WatermarkKind;
  text: string | null;
  position: WatermarkPosition;
  size: WatermarkSize;
  /** 20–100 (%). */
  opacity: number;
}

interface Props {
  mark: WatermarkOverlayMark;
  /** URL do logo (tipo `IMAGE`); null = sem logo. */
  logoUrl: string | null;
  /** Dimensões da foto em que a marca cai; a camada ocupa a caixa do pai (`position: relative`) inteira. */
  photo: Dimensions;
  /** Sem marca do tipo escolhido: mostra isto no lugar dela; sem isto, nada é desenhado. */
  placeholder?: ReactNode;
  /** Texto usado para medir o lugar do `placeholder` no tipo texto. */
  placeholderText?: string;
}

/**
 * Camada da marca d'água sobre uma foto: lugar e tamanho de `computeWatermarkPlacement` (cópia da regra da API;
 * logo pela largura, texto pela altura das letras) em % da foto, com a mesma opacidade. Logo esticado no retângulo
 * calculado, como o `resize(fit: fill)` do servidor; texto Inter 800 branco com sombra, como o render do servidor.
 */
export function WatermarkOverlay({ mark, logoUrl, photo, placeholder, placeholderText = ' ' }: Props) {
  const blur = useBlur('offerWatermark.logo');
  const [logoDims, setLogoDims] = useState<{ url: string; dims: Dimensions } | null>(null);

  const isImage = mark.kind === 'IMAGE';
  const text = (mark.text ?? '').trim();
  const hasMark = isImage ? Boolean(logoUrl) : text !== '';
  if (!hasMark && !placeholder) return null;

  // Texto medido pela caixa das letras (sem sombra) e posto pela altura, como o servidor (modo `height`)
  const ink = textMarkDimensions(text || placeholderText, measureWatermarkText);
  const markDims: Dimensions = isImage
    ? (logoDims && logoDims.url === logoUrl ? logoDims.dims : { width: 1, height: 1 })
    : ink;
  const place = computeWatermarkPlacement(photo, markDims, mark.position, mark.size, isImage ? 'width' : 'height');
  const pctX = (px: number) => `${(px / Math.max(1, photo.width)) * 100}%`;
  const pctY = (px: number) => `${(px / Math.max(1, photo.height)) * 100}%`;

  return (
    <Box
      data-testid="watermark-mark"
      data-position={mark.position}
      aria-hidden={hasMark ? true : undefined}
      sx={{
        position: 'absolute',
        left: pctX(place.left), top: pctY(place.top), width: pctX(place.width), height: pctY(place.height),
        opacity: mark.opacity / 100,
        pointerEvents: 'none',
        transition: 'left 180ms ease-out, top 180ms ease-out, width 180ms ease-out, height 180ms ease-out',
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
      }}
    >
      {hasMark ? (
        <Blurred when={blur} radius={8} sx={{ width: '100%', height: '100%' }}>
          {isImage ? (
            <Box
              component="img"
              src={logoUrl ?? undefined}
              alt=""
              onLoad={(e) => {
                const img = e.currentTarget as HTMLImageElement;
                if (logoUrl && img.naturalWidth > 0) setLogoDims({ url: logoUrl, dims: { width: img.naturalWidth, height: img.naturalHeight } });
              }}
              sx={{ display: 'block', width: '100%', height: '100%', objectFit: 'fill' }}
            />
          ) : (
            <svg
              viewBox={`${ink.x} ${ink.y} ${ink.width} ${ink.height}`}
              width="100%"
              height="100%"
              aria-hidden
              style={{ display: 'block', overflow: 'visible', filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.9)) drop-shadow(0 1px 3px rgba(0,0,0,0.7))' }}
            >
              <text
                x={0}
                y={0}
                dominantBaseline="alphabetic"
                textAnchor="start"
                fill="#FFFFFF"
                fontSize={TEXT_FONT_PX}
                fontWeight={800}
                fontFamily="Inter, system-ui, sans-serif"
              >
                {text}
              </text>
            </svg>
          )}
        </Blurred>
      ) : placeholder}
    </Box>
  );
}
