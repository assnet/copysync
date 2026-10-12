import { Box, Tooltip, Typography, alpha } from '@mui/material';
import { APP_NAME } from '@/shared/branding/brand';
import { BrandLogo } from '@/shared/branding/BrandLogo';
import { BRAND_NAVY, LOGIN_BENEFITS, LOGIN_COPY, LOGIN_IMAGES } from './loginContent';
import { GOLDEN_LINE, GOLDEN_SPACE, GOLDEN_TYPE, PHI } from './goldenRatio';
import { LoginAmbientVideo } from './LoginAmbientVideo';
import {
  REVEAL_ITEMS_DELAY_MS, REVEAL_ITEM_STAGGER_MS, REVEAL_KEYFRAMES, REVEAL_SUBTITLE_DELAY_MS,
  REVEAL_WORD_STAGGER_MS, revealSx,
} from './loginReveal';

/** Fio de 1px entre os passos (branco α 0,14 sobre o overlay navy). */
const HAIRLINE = alpha('#fff', 0.14);

/** Palavras da headline, para o reveal escalonado. */
const HEADLINE_WORDS = LOGIN_COPY.headline.split(' ');

/** Texto só para leitor de tela (padrão sr-only), sem dependência extra. */
const SR_ONLY = {
  position: 'absolute', width: 1, height: 1, p: 0, m: -1, overflow: 'hidden',
  clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
} as const;

/**
 * Painel visual (desktop, md+): vídeo ambiente de equipe (poster + loop) com overlay navy da marca,
 * logo, headline, índice numerado dos passos do produto e faixa de prova social.
 *
 * φ aplicado: a grade vertical divide o painel na linha áurea superior (38,2%):
 * o logo vive acima dela e a headline nasce exatamente nela. A largura máxima
 * do texto é 26 × 16 ≈ 420 px (GOLDEN_TYPE.lead × base), e os espaçamentos
 * seguem GOLDEN_SPACE (8 × φⁿ).
 */
export function LoginShowcasePanel() {
  return (
    <Box
      component="aside"
      aria-label="Apresentação do produto"
      sx={{
        position: 'relative',
        overflow: 'hidden',
        height: '100%',
        minHeight: '100vh',
        display: 'grid',
        // φ: linha áurea em 38,2% — logo acima, headline a partir dela.
        gridTemplateRows: `minmax(min-content, ${GOLDEN_LINE.upper}) auto`,
        p: `${GOLDEN_SPACE.s5}px`, // 55 px
        color: '#fff',
        bgcolor: BRAND_NAVY,
        isolation: 'isolate',
        ...REVEAL_KEYFRAMES,
      }}
    >
      {/* Fundo: poster (primeiro frame) + vídeo ambiente em loop, atrás do overlay.
          Sem vídeo em movimento reduzido / Save-Data / 2g — fica só o poster. */}
      <LoginAmbientVideo
        poster={LOGIN_IMAGES.ambientPoster}
        webmSrc={LOGIN_IMAGES.ambientWebm}
        mp4Src={LOGIN_IMAGES.ambientMp4}
        objectPosition="50% 40%"
      />
      {/* Overlay navy: mais denso onde o texto fica (esquerda/baixo) para contraste ≥ 4.5:1. */}
      <Box
        aria-hidden
        sx={{
          position: 'absolute', inset: 0, zIndex: -1,
          background: `
            linear-gradient(200deg, ${alpha(BRAND_NAVY, 0.38)} 0%, ${alpha(BRAND_NAVY, 0.82)} 45%, ${alpha(BRAND_NAVY, 0.96)} 100%),
            linear-gradient(90deg, ${alpha(BRAND_NAVY, 0.55)} 0%, transparent 60%)
          `,
        }}
      />

      {/* Logo — ocupa a faixa acima da linha áurea */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: `${GOLDEN_SPACE.s2}px`, alignSelf: 'start' }}>
        <BrandLogo size={44} />
        <Typography component="span" sx={{ fontSize: GOLDEN_TYPE.lead, fontWeight: 800, letterSpacing: -0.5, lineHeight: 1 }}>
          {APP_NAME}
        </Typography>
      </Box>

      {/* Headline + provas + prova social — nascem na linha áurea */}
      <Box
        sx={{
          maxWidth: GOLDEN_TYPE.lead * 16, // ≈ 416 px
          display: 'flex', flexDirection: 'column',
        }}
      >
        <Typography
          component="h2"
          sx={{
            fontSize: GOLDEN_TYPE.display, // 42 px
            fontWeight: 800, letterSpacing: -1, lineHeight: 1.1,
            textWrap: 'balance',
            mb: `${GOLDEN_SPACE.s3}px`,
          }}
        >
          {/* Reveal palavra a palavra (stagger 70 ms); os espaços entre spans
              preservam as quebras naturais de linha. */}
          {HEADLINE_WORDS.map((word, i) => (
            <Box
              key={`${word}-${i}`}
              component="span"
              sx={{ display: 'inline-block', ...revealSx(i * REVEAL_WORD_STAGGER_MS) }}
            >
              {word}
            </Box>
          )).flatMap((node, i) => (i === 0 ? [node] : [' ', node]))}
        </Typography>
        <Typography
          sx={{
            fontSize: GOLDEN_TYPE.base, lineHeight: PHI, // 16 px, altura de linha φ
            color: alpha('#fff', 0.84),
            mb: `${GOLDEN_SPACE.s4}px`,
            ...revealSx(REVEAL_SUBTITLE_DELAY_MS),
          }}
        >
          {LOGIN_COPY.subtitle}
        </Typography>

        {/* Índice do produto: passos numerados em ordem, fios de 1px, sem fundo.
            Não focável (não é interativo); a hint vai no tooltip (mouse) e em
            texto só-para-leitor-de-tela. */}
        <Box
          component="ol"
          aria-label="Como o produto funciona, em ordem"
          sx={{
            m: 0, p: 0, listStyle: 'none',
            mb: `${GOLDEN_SPACE.s3}px`,
            borderTop: `1px solid ${HAIRLINE}`,
          }}
        >
          {LOGIN_BENEFITS.map(({ label, hint }, i) => (
            <Tooltip key={label} title={hint} placement="right" enterDelay={200} describeChild>
              <Box
                component="li"
                sx={{
                  position: 'relative',
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr',
                  alignItems: 'baseline',
                  columnGap: `${GOLDEN_SPACE.s2}px`,
                  py: `${GOLDEN_SPACE.s1}px`,
                  borderBottom: `1px solid ${HAIRLINE}`,
                  cursor: 'default',
                  ...revealSx(REVEAL_ITEMS_DELAY_MS + i * REVEAL_ITEM_STAGGER_MS),
                  // Fio que cresce da esquerda no hover, sobre a hairline.
                  '&::after': {
                    content: '""',
                    position: 'absolute', left: 0, right: 0, bottom: '-1px', height: '1px',
                    bgcolor: 'primary.light',
                    transform: 'scaleX(0)', transformOrigin: 'left center',
                    transition: 'transform 240ms cubic-bezier(.2,.7,.2,1)',
                  },
                  '&:hover::after': { transform: 'scaleX(1)' },
                  '&:hover .login-step-index': { color: 'primary.light' },
                  // Mescla com a regra de reduced-motion do revealSx (mesma chave).
                  '@media (prefers-reduced-motion: reduce)': {
                    animation: 'none', willChange: 'auto',
                    '&::after, & .login-step-index': { transition: 'none' },
                  },
                }}
              >
                <Typography
                  component="span"
                  className="login-step-index"
                  aria-hidden
                  sx={{
                    fontSize: GOLDEN_TYPE.caption, fontWeight: 500, lineHeight: 1,
                    fontVariantNumeric: 'tabular-nums', letterSpacing: 0.6,
                    color: alpha('#fff', 0.55),
                    transition: 'color 240ms ease',
                    minWidth: '2ch',
                  }}
                >
                  {String(i + 1).padStart(2, '0')}
                </Typography>
                <Typography
                  component="span"
                  sx={{ fontSize: GOLDEN_TYPE.base, fontWeight: 600, lineHeight: 1.25, letterSpacing: -0.2 }}
                >
                  {label}
                  <Box component="span" sx={SR_ONLY}>{`. ${hint}`}</Box>
                </Typography>
              </Box>
            </Tooltip>
          ))}
        </Box>

        {/* Prova social: avatares recortados das fotos (sem números inventados) */}
        <Box
          sx={{
            display: 'flex', alignItems: 'center', gap: `${GOLDEN_SPACE.s2}px`,
            ...revealSx(REVEAL_ITEMS_DELAY_MS + LOGIN_BENEFITS.length * REVEAL_ITEM_STAGGER_MS),
          }}
        >
          <Box sx={{ display: 'flex', flexShrink: 0 }}>
            {LOGIN_IMAGES.avatars.map((avatar, i) => (
              <Box
                key={avatar.src}
                component="img"
                src={avatar.src}
                alt={avatar.alt}
                width={40}
                height={40}
                loading="lazy"
                decoding="async"
                sx={{
                  width: 40, height: 40, borderRadius: '50%', objectFit: 'cover',
                  border: `2px solid ${BRAND_NAVY}`,
                  ml: i === 0 ? 0 : `-${GOLDEN_SPACE.s2}px`,
                  boxShadow: `0 2px 8px ${alpha('#000', 0.35)}`,
                }}
              />
            ))}
          </Box>
          <Typography sx={{ fontSize: GOLDEN_TYPE.caption, lineHeight: 1.45, color: alpha('#fff', 0.84) }}>
            {LOGIN_COPY.socialProof}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
