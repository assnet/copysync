import { useEffect, useState, type SyntheticEvent } from 'react';
import { Box, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import { Link as LinkIcon } from 'lucide-react';
import { AppIcon } from '@/components/AppIcon';
import { Blurred, useBlur } from '@/features/privacy';
import type { LinkPreview } from '../../types';
import { chatStrings } from '../../strings';

/** Largura natural mínima para a miniatura ir em cima, 16:9; abaixo disso fica quadrada à esquerda. */
export const LARGE_THUMBNAIL_MIN_WIDTH = 300;
const SQUARE_SIZE = 68;
const IMAGE_BLUR_PX = 12;

/**
 * `pending`: carregando, ocupa o quadrado (layout pequeno) com a imagem invisível.
 * `large`/`small`: decidido no `onLoad` pela largura natural. `none`: sem miniatura ou falhou.
 */
type ThumbMode = 'pending' | 'large' | 'small' | 'none';

interface Props {
  preview: LinkPreview;
  isOut: boolean;
  textColor: string;
}

function parseLink(url: string): { href: string | null; domain: string | null } {
  try {
    const parsed = new URL(url);
    const safe = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    return { href: safe ? parsed.href : null, domain: parsed.hostname || null };
  } catch {
    return { href: null, domain: null };
  }
}

/** Cartão da prévia de link (miniatura, título, descrição e domínio) acima do texto da mensagem. */
export function LinkPreviewCard({ preview, isOut, textColor }: Props) {
  const theme = useTheme();
  const blurImage = useBlur('chat.linkPreviewImages');
  const blurText = useBlur('chat.linkPreviewText');
  const { href, domain } = parseLink(preview.url);
  const thumb = preview.thumbnailUrl;
  const [mode, setMode] = useState<ThumbMode>(thumb ? 'pending' : 'none');

  useEffect(() => {
    setMode(thumb ? 'pending' : 'none');
  }, [thumb]);

  const handleLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    if (mode !== 'pending') return;
    setMode(e.currentTarget.naturalWidth >= LARGE_THUMBNAIL_MIN_WIDTH ? 'large' : 'small');
  };
  const handleError = () => setMode('none');

  const cardBg = isOut
    ? alpha('#000000', 0.16)
    : alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.08 : 0.06);
  const placeholderBg = isOut ? alpha('#ffffff', 0.12) : alpha(theme.palette.text.primary, 0.08);

  const image = thumb && mode !== 'none' && (
    <Box
      component="img"
      src={thumb}
      alt={chatStrings.linkPreview.thumbnailAlt}
      onLoad={handleLoad}
      onError={handleError}
      draggable={false}
      data-thumb-mode={mode}
      sx={{
        display: 'block',
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        opacity: mode === 'pending' ? 0 : 1,
        transition: 'opacity 160ms',
        filter: blurImage ? `blur(${IMAGE_BLUR_PX}px)` : 'none',
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
      }}
    />
  );

  const domainLine = domain && (
    <Tooltip title={blurText ? '' : preview.url} placement="bottom-start" enterDelay={400}>
      <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, opacity: 0.72 }}>
        {mode === 'none' && <AppIcon icon={LinkIcon} size="inline" />}
        <Blurred when={blurText} inline radius={5}>
          <Typography component="span" variant="caption" noWrap sx={{ display: 'block', color: 'inherit' }}>
            {domain}
          </Typography>
        </Blurred>
      </Box>
    </Tooltip>
  );

  const clamp2 = {
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical' as const,
    overflow: 'hidden',
    wordBreak: 'break-word' as const,
  };

  const texts = (
    <Box sx={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 0.25, py: 0.75, px: 1 }}>
      {preview.title && (
        <Blurred when={blurText} radius={5}>
          <Typography variant="body2" sx={{ ...clamp2, fontWeight: 600, lineHeight: 1.3, color: 'inherit' }}>
            {preview.title}
          </Typography>
        </Blurred>
      )}
      {preview.description && (
        <Blurred when={blurText} radius={5}>
          <Typography variant="caption" sx={{ ...clamp2, lineHeight: 1.35, opacity: 0.82, color: 'inherit' }}>
            {preview.description}
          </Typography>
        </Blurred>
      )}
      {domainLine}
    </Box>
  );

  const isLarge = mode === 'large';
  const showSquare = mode === 'pending' || mode === 'small';

  return (
    <Box
      component={href ? 'a' : 'div'}
      {...(href
        ? { href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': chatStrings.linkPreview.openLink(domain) }
        : {})}
      data-testid="link-preview-card"
      sx={{
        display: 'flex',
        flexDirection: isLarge ? 'column' : 'row',
        alignItems: 'stretch',
        // Ocupa a largura da bolha; mínimo só no desktop (no celular a bolha já é estreita).
        width: '100%',
        minWidth: { sm: 260 },
        maxWidth: '100%',
        mb: 0.75,
        borderRadius: 2,
        overflow: 'hidden',
        bgcolor: cardBg,
        color: textColor,
        textDecoration: 'none',
        transition: 'background-color 160ms',
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        ...(href && {
          cursor: 'pointer',
          '&:hover': { bgcolor: alpha(isOut ? '#000000' : theme.palette.text.primary, 0.12) },
          '&:focus-visible': {
            outline: `2px solid ${isOut ? '#ffffff' : theme.palette.primary.main}`,
            outlineOffset: 2,
          },
        }),
      }}
    >
      {isLarge && (
        <Box sx={{ width: '100%', aspectRatio: '16 / 9', overflow: 'hidden', bgcolor: placeholderBg }}>{image}</Box>
      )}
      {showSquare && (
        <Box
          sx={{
            flexShrink: 0,
            width: SQUARE_SIZE,
            alignSelf: 'stretch',
            minHeight: SQUARE_SIZE,
            overflow: 'hidden',
            bgcolor: placeholderBg,
          }}
        >
          {image}
        </Box>
      )}
      {texts}
    </Box>
  );
}
