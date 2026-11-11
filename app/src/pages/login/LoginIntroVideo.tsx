import { useId, useState, type SyntheticEvent } from 'react';
import {
  Box, ButtonBase, Dialog, IconButton, Link, Tooltip, Typography, alpha, useMediaQuery,
  type SxProps, type Theme,
} from '@mui/material';
import { ExternalLink, Play, X } from 'lucide-react';
import { AppIcon } from '@/components/AppIcon';
import { APP_NAME } from '@/shared/branding/brand';
import {
  INTRO_VIDEO_EMBED_URL, INTRO_VIDEO_POSTERS, INTRO_VIDEO_WATCH_URL,
} from '@/features/platformLinks/links';
import { BRAND_NAVY, LOGIN_COPY } from './loginContent';
import { GOLDEN_SPACE, GOLDEN_TYPE } from './goldenRatio';

const COPY = LOGIN_COPY.introVideo;

/** Sem capa em alta, o YouTube devolve um cinza de 120 px em vez de erro: trata como falha. */
const POSTER_PLACEHOLDER_MAX_WIDTH = 120;

const FOCUS_RING = {
  '&:focus-visible': { outline: '3px solid #fff', outlineOffset: 3 },
} as const;

const NO_MOTION = '@media (prefers-reduced-motion: reduce)';

/** Capa do vídeo: tenta a de alta resolução e cai na que sempre existe. */
function useIntroPoster() {
  const [index, setIndex] = useState(0);
  const fallback = () => setIndex((i) => Math.min(i + 1, INTRO_VIDEO_POSTERS.length - 1));
  return {
    src: INTRO_VIDEO_POSTERS[index],
    onError: fallback,
    onLoad: (e: SyntheticEvent<HTMLImageElement>) => {
      const { naturalWidth } = e.currentTarget;
      if (index === 0 && naturalWidth > 0 && naturalWidth <= POSTER_PLACEHOLDER_MAX_WIDTH) fallback();
    },
  };
}

function PlayBadge({ diameter }: { diameter: number }) {
  return (
    <Box
      className="intro-video-play"
      aria-hidden
      sx={{
        width: diameter, height: diameter, borderRadius: '50%',
        display: 'grid', placeItems: 'center', flexShrink: 0,
        bgcolor: '#fff', color: BRAND_NAVY,
        boxShadow: `0 6px 24px ${alpha('#000', 0.45)}`,
        transition: 'transform 200ms cubic-bezier(.2,.7,.2,1)',
        // Compensa o peso óptico do triângulo (parece deslocado à esquerda).
        '& svg': { transform: 'translateX(1px)' },
        [NO_MOTION]: { transition: 'none' },
      }}
    >
      <AppIcon icon={Play} size={diameter >= 55 ? 'lg' : 'sm'} fill="currentColor" />
    </Box>
  );
}

export interface LoginIntroVideoProps {
  /** `card`: capa 16:9 com moldura (painel desktop). `compact`: linha com miniatura (faixa mobile). */
  variant: 'card' | 'compact';
  sx?: SxProps<Theme>;
}

/**
 * Fachada leve do vídeo de apresentação: mostra só a capa e o botão de play. O player
 * (iframe) é montado apenas depois do clique, dentro de uma janela 16:9 — nenhum script
 * do provedor de vídeo é carregado e, antes do clique, só a imagem de capa sai da página.
 * Fechar a janela desmonta o iframe (o vídeo para). Estado efêmero: nada é persistido.
 */
export function LoginIntroVideo({ variant, sx }: LoginIntroVideoProps) {
  const [open, setOpen] = useState(false);
  const poster = useIntroPoster();
  const titleId = useId();
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  const posterImg = (
    <Box
      component="img"
      src={poster.src}
      onError={poster.onError}
      onLoad={poster.onLoad}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
    />
  );

  return (
    <>
      {variant === 'card' ? (
        <ButtonBase
          onClick={() => setOpen(true)}
          aria-label={COPY.playLabel}
          aria-haspopup="dialog"
          sx={[
            {
              display: 'block', width: '100%', textAlign: 'left',
              p: `${GOLDEN_SPACE.s1}px`,
              borderRadius: `${GOLDEN_SPACE.s3}px`,
              bgcolor: alpha('#fff', 0.1),
              border: `1px solid ${alpha('#fff', 0.22)}`,
              backdropFilter: 'blur(14px)',
              boxShadow: `0 ${GOLDEN_SPACE.s3}px ${GOLDEN_SPACE.s5}px ${alpha('#000', 0.35)}`,
              transition: 'border-color 200ms ease, background-color 200ms ease',
              '&:hover': { bgcolor: alpha('#fff', 0.16), borderColor: alpha('#fff', 0.4) },
              '&:hover .intro-video-play': { transform: 'scale(1.08)' },
              [NO_MOTION]: { transition: 'none', '&:hover .intro-video-play': { transform: 'none' } },
              ...FOCUS_RING,
            },
            ...(Array.isArray(sx) ? sx : [sx]),
          ]}
        >
          <Box
            sx={{
              position: 'relative', overflow: 'hidden', aspectRatio: '16 / 9',
              borderRadius: `${GOLDEN_SPACE.s2}px`, bgcolor: BRAND_NAVY,
              display: 'grid', placeItems: 'center',
            }}
          >
            {posterImg}
            <Box aria-hidden sx={{ position: 'absolute', inset: 0, bgcolor: alpha(BRAND_NAVY, 0.28) }} />
            <Box sx={{ position: 'relative' }}><PlayBadge diameter={GOLDEN_SPACE.s5 + GOLDEN_SPACE.s1} /></Box>
          </Box>
          {/* Legenda fora da capa: a arte do vídeo já tem texto próprio. */}
          <Box
            sx={{
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap',
              columnGap: `${GOLDEN_SPACE.s2}px`, color: '#fff',
              px: `${GOLDEN_SPACE.s1}px`, pt: `${GOLDEN_SPACE.s1}px`, pb: '2px',
            }}
          >
            <Typography component="span" sx={{ fontSize: GOLDEN_TYPE.base, fontWeight: 700, lineHeight: 1.3, letterSpacing: -0.2 }}>
              {COPY.title}
            </Typography>
            <Typography component="span" sx={{ fontSize: GOLDEN_TYPE.caption, lineHeight: 1.4, color: alpha('#fff', 0.84) }}>
              {COPY.hint}
            </Typography>
          </Box>
        </ButtonBase>
      ) : (
        <ButtonBase
          onClick={() => setOpen(true)}
          aria-label={COPY.playLabel}
          aria-haspopup="dialog"
          sx={[
            {
              display: 'flex', alignItems: 'center', justifyContent: 'flex-start', width: '100%',
              gap: `${GOLDEN_SPACE.s2}px`, textAlign: 'left',
              minHeight: GOLDEN_SPACE.s5, // 55 px — alvo de toque
              p: `${GOLDEN_SPACE.s1 - 2}px`, pr: `${GOLDEN_SPACE.s2}px`,
              borderRadius: `${GOLDEN_SPACE.s2}px`,
              color: '#fff',
              bgcolor: alpha('#fff', 0.12),
              border: `1px solid ${alpha('#fff', 0.24)}`,
              backdropFilter: 'blur(12px)',
              '&:active': { bgcolor: alpha('#fff', 0.2) },
              ...FOCUS_RING,
            },
            ...(Array.isArray(sx) ? sx : [sx]),
          ]}
        >
          <Box
            sx={{
              position: 'relative', overflow: 'hidden', flexShrink: 0,
              width: GOLDEN_SPACE.s6, aspectRatio: '16 / 9', // 89 × 50
              borderRadius: `${GOLDEN_SPACE.s1}px`, bgcolor: BRAND_NAVY,
              display: 'grid', placeItems: 'center',
            }}
          >
            {posterImg}
            <Box aria-hidden sx={{ position: 'absolute', inset: 0, bgcolor: alpha(BRAND_NAVY, 0.35) }} />
            <Box sx={{ position: 'relative' }}><PlayBadge diameter={GOLDEN_SPACE.s4} /></Box>
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography component="span" sx={{ display: 'block', fontSize: GOLDEN_TYPE.base, fontWeight: 700, lineHeight: 1.25 }}>
              {COPY.title}
            </Typography>
            <Typography component="span" sx={{ display: 'block', fontSize: GOLDEN_TYPE.caption, lineHeight: 1.4, color: alpha('#fff', 0.84) }}>
              {COPY.hint}
            </Typography>
          </Box>
        </ButtonBase>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        fullWidth
        maxWidth="lg"
        aria-labelledby={titleId}
        transitionDuration={reduceMotion ? 0 : undefined}
        slotProps={{ backdrop: { sx: { bgcolor: alpha('#030816', 0.82) } } }}
        PaperProps={{
          sx: {
            m: { xs: `${GOLDEN_SPACE.s1}px`, sm: `${GOLDEN_SPACE.s3}px` },
            // Largura limitada pela altura da janela: o 16:9 inteiro sempre cabe na tela.
            width: {
              xs: `min(calc(100% - ${GOLDEN_SPACE.s1 * 2}px), calc((100dvh - 120px) * 16 / 9))`,
              sm: `min(calc(100% - ${GOLDEN_SPACE.s3 * 2}px), calc((100dvh - 140px) * 16 / 9))`,
            },
            color: '#fff', bgcolor: BRAND_NAVY, backgroundImage: 'none',
            border: `1px solid ${alpha('#fff', 0.14)}`,
            borderRadius: `${GOLDEN_SPACE.s2}px`,
            overflow: 'hidden',
          },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: `${GOLDEN_SPACE.s1}px`, pl: `${GOLDEN_SPACE.s3}px`, pr: `${GOLDEN_SPACE.s1}px`, minHeight: GOLDEN_SPACE.s5 }}>
          <Typography id={titleId} component="h2" sx={{ flex: 1, minWidth: 0, fontSize: GOLDEN_TYPE.base, fontWeight: 700 }} noWrap>
            {COPY.dialogTitle}
          </Typography>
          <Tooltip title={COPY.watchExternalTooltip} describeChild>
            <Link
              href={INTRO_VIDEO_WATCH_URL}
              target="_blank"
              rel="noopener noreferrer"
              underline="hover"
              sx={{
                display: 'inline-flex', alignItems: 'center', gap: 0.75, minHeight: 44, px: 1,
                fontSize: GOLDEN_TYPE.caption, fontWeight: 600, color: alpha('#fff', 0.84),
                borderRadius: 1, whiteSpace: 'nowrap',
                '&:hover': { color: '#fff' },
                '&:focus-visible': { outline: '2px solid #fff', outlineOffset: 2 },
              }}
            >
              <AppIcon icon={ExternalLink} />
              {COPY.watchExternal}
            </Link>
          </Tooltip>
          <Tooltip title={COPY.close}>
            <IconButton
              onClick={() => setOpen(false)}
              aria-label={COPY.close}
              sx={{ width: 44, height: 44, color: '#fff', '&:hover': { bgcolor: alpha('#fff', 0.12) }, '&:focus-visible': { outline: '2px solid #fff' } }}
            >
              <AppIcon icon={X} size="md" />
            </IconButton>
          </Tooltip>
        </Box>
        <Box sx={{ position: 'relative', aspectRatio: '16 / 9', bgcolor: '#000' }}>
          <Box
            component="iframe"
            src={INTRO_VIDEO_EMBED_URL}
            title={COPY.frameTitle(APP_NAME)}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, display: 'block' }}
          />
        </Box>
      </Dialog>
    </>
  );
}
