import { useLayoutEffect, useRef, useState } from 'react';
import { Box, CircularProgress, Paper, ToggleButton, ToggleButtonGroup, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import { Monitor, Smartphone, TriangleAlert } from 'lucide-react';
import { AppIcon } from '@/components';
import { Blurred, PRIVACY_SCREENS, usePrivacy } from '@/features/privacy';
import { useStorefrontPreview } from '../hooks/useStorefrontPreview';
import type { StorefrontFormState } from '../storefrontForm';
import type { StorefrontViewport } from '../types';
import { storefrontStrings } from '../strings';

const t = storefrontStrings.preview;

/** Largura real em que a página é desenhada; a moldura escala para caber na coluna. */
export const PREVIEW_WIDTHS: Record<StorefrontViewport, number> = { mobile: 390, desktop: 1280 };
const PREVIEW_HEIGHTS: Record<StorefrontViewport, number> = { mobile: 760, desktop: 800 };

const STOREFRONT_FLAGS = PRIVACY_SCREENS.find((s) => s.id === 'storefront')?.flags.map((f) => f.id) ?? [];

/** Qualquer dado da vitrine borrado → a prévia inteira borra (ela mostra todos juntos). */
function useAnyStorefrontBlur(): boolean {
  const { flags } = usePrivacyOrEmpty();
  return STOREFRONT_FLAGS.some((f) => flags.has(f));
}

// `usePrivacy` lança fora do provider; a prévia segue a regra de `useBlur` (sem provider = sem borrar)
function usePrivacyOrEmpty(): { flags: ReadonlySet<string> } {
  try {
    return usePrivacy();
  } catch {
    return { flags: new Set() };
  }
}

/** Largura disponível na coluna (ResizeObserver); sem suporte (testes), escala 1. */
function useAvailableWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

interface Props {
  draft: StorefrontFormState;
  viewport: StorefrontViewport;
  onViewportChange: (viewport: StorefrontViewport) => void;
  /** `previewRevision` do salvo: muda após upload, publicar, reordenar ou editar publicada. */
  revision?: string;
}

/**
 * Prévia em tempo real da Página de Ofertas. O html vem da API (mesmo renderizador da página
 * pública) e roda num iframe `sandbox=""` — sem script, sem mesma origem, sem formulário.
 */
export function StorefrontPreview({ draft, viewport, onViewportChange, revision }: Props) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const { html, loading, error } = useStorefrontPreview(draft, viewport, revision);
  const blurred = useAnyStorefrontBlur();
  const { ref, width: available } = useAvailableWidth();

  const isMobile = viewport === 'mobile';
  const frameW = PREVIEW_WIDTHS[viewport];
  const frameH = PREVIEW_HEIGHTS[viewport];
  const bezel = isMobile ? 12 : 0;
  const barH = isMobile ? 0 : 32;
  const outerW = frameW + bezel * 2;
  const scale = available ? Math.min(1, available / outerW) : 1;
  const outerH = frameH + bezel * 2 + barH;

  const frame = (
    <Box
      component="iframe"
      title={t.frameTitle}
      sandbox=""
      srcDoc={html ?? ''}
      style={{ width: `${frameW}px`, height: `${frameH}px` }}
      sx={{ display: 'block', border: 0, bgcolor: '#fff' }}
    />
  );

  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, borderRadius: 3, position: { md: 'sticky' }, top: { md: 88 }, minWidth: 0 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1, minWidth: 0 }}>
          <Box
            aria-hidden
            sx={{
              width: 8, height: 8, borderRadius: '50%', bgcolor: 'success.main', flexShrink: 0,
              boxShadow: `0 0 0 3px ${alpha(theme.palette.success.main, 0.2)}`,
            }}
          />
          <Typography variant="subtitle2" fontWeight={700} noWrap>{t.title}</Typography>
          {loading && <CircularProgress size={14} aria-label={t.loading} />}
          {error && !loading && (
            <Tooltip title={t.error}>
              <Box component="span" sx={{ display: 'inline-flex', color: 'warning.main' }}>
                <AppIcon icon={TriangleAlert} size="sm" label={t.error} />
              </Box>
            </Tooltip>
          )}
        </Box>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={viewport}
          onChange={(_, next: StorefrontViewport | null) => { if (next) onViewportChange(next); }}
          aria-label={t.viewportGroup}
          sx={{ '& .MuiToggleButton-root': { textTransform: 'none', gap: 0.75, px: 1.5, fontWeight: 600 } }}
        >
          <ToggleButton value="mobile"><AppIcon icon={Smartphone} />{t.mobile}</ToggleButton>
          <ToggleButton value="desktop"><AppIcon icon={Monitor} />{t.desktop}</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Box ref={ref} sx={{ display: 'flex', justifyContent: 'center', minWidth: 0 }}>
        <Box sx={{ position: 'relative', width: outerW * scale, height: outerH * scale, overflow: 'hidden' }}>
          <Box
            data-testid="storefront-preview-device"
            sx={{
              width: outerW, transform: `scale(${scale})`, transformOrigin: 'top left',
              ...(isMobile
                ? {
                    p: `${bezel}px`, borderRadius: '44px',
                    bgcolor: isDark ? 'grey.800' : 'grey.900',
                    boxShadow: theme.shadows[isDark ? 0 : 6],
                    '& iframe': { borderRadius: '32px' },
                  }
                : {
                    borderRadius: 2, overflow: 'hidden', border: 1, borderColor: 'divider',
                    boxShadow: theme.shadows[isDark ? 0 : 4],
                  }),
            }}
          >
            {!isMobile && (
              <Box
                aria-hidden
                sx={{
                  height: barH, display: 'flex', alignItems: 'center', gap: 0.75, px: 1.5,
                  bgcolor: isDark ? 'grey.900' : 'grey.100', borderBottom: 1, borderColor: 'divider',
                }}
              >
                {['error.main', 'warning.main', 'success.main'].map((c) => (
                  <Box key={c} sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: c, opacity: 0.8 }} />
                ))}
                <Box sx={{ ml: 2, flex: 1, maxWidth: 480, height: 18, borderRadius: 999, bgcolor: isDark ? 'grey.800' : 'common.white' }} />
              </Box>
            )}
            <Blurred when={blurred} radius={14}>{frame}</Blurred>
          </Box>
          {blurred && (
            <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', p: 2, pointerEvents: 'none' }}>
              <Typography
                variant="body2"
                fontWeight={600}
                sx={{ px: 1.5, py: 0.75, borderRadius: 2, bgcolor: 'background.paper', boxShadow: 2, textAlign: 'center' }}
              >
                {t.blurred}
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
    </Paper>
  );
}
