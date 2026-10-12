import { Box, Stack, Tooltip, Typography, alpha } from '@mui/material';
import { APP_NAME } from '@/shared/branding/brand';
import { BrandLogo } from '@/shared/branding/BrandLogo';
import { BRAND_NAVY, LOGIN_BENEFITS, LOGIN_COPY, LOGIN_IMAGES } from './loginContent';
import { GOLDEN_LINE, GOLDEN_SPACE, GOLDEN_TYPE, PHI } from './goldenRatio';

/**
 * Painel visual (desktop, md+): foto real de equipe com overlay navy da marca,
 * logo, headline, provas com tooltip e faixa de prova social.
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
      }}
    >
      {/* Foto de fundo (LCP): carregada com prioridade, dimensões reservadas. */}
      <Box
        component="img"
        src={LOGIN_IMAGES.hero}
        alt=""
        width={1600}
        height={1067}
        fetchPriority="high"
        decoding="async"
        sx={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          objectFit: 'cover', objectPosition: '62% 40%', zIndex: -2,
        }}
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
          animation: 'loginReveal 700ms cubic-bezier(.2,.7,.2,1) both',
          '@keyframes loginReveal': {
            from: { opacity: 0, transform: `translateY(${GOLDEN_SPACE.s3}px)` },
            to: { opacity: 1, transform: 'none' },
          },
          '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
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
          {LOGIN_COPY.headline}
        </Typography>
        <Typography
          sx={{
            fontSize: GOLDEN_TYPE.base, lineHeight: PHI, // 16 px, altura de linha φ
            color: alpha('#fff', 0.84),
            mb: `${GOLDEN_SPACE.s4}px`,
          }}
        >
          {LOGIN_COPY.subtitle}
        </Typography>

        {/* Provas: chips focáveis com tooltip descritivo */}
        <Stack
          component="ul"
          direction="row"
          useFlexGap
          flexWrap="wrap"
          spacing={`${GOLDEN_SPACE.s1}px`}
          sx={{ m: 0, p: 0, listStyle: 'none', mb: `${GOLDEN_SPACE.s4}px` }}
        >
          {LOGIN_BENEFITS.map(({ label, hint, Icon }) => (
            <Tooltip key={label} title={hint} placement="top" arrow enterDelay={250} describeChild>
              <Box
                component="li"
                tabIndex={0}
                sx={{
                  display: 'inline-flex', alignItems: 'center', gap: `${GOLDEN_SPACE.s1}px`,
                  px: `${GOLDEN_SPACE.s2}px`, py: `${GOLDEN_SPACE.s1}px`,
                  borderRadius: 999, cursor: 'default',
                  fontSize: GOLDEN_TYPE.caption, fontWeight: 600,
                  color: '#fff',
                  bgcolor: alpha('#fff', 0.1),
                  border: `1px solid ${alpha('#fff', 0.18)}`,
                  backdropFilter: 'blur(8px)',
                  transition: 'background-color 160ms ease, border-color 160ms ease',
                  '&:hover, &:focus-visible': { bgcolor: alpha('#fff', 0.18), borderColor: alpha('#fff', 0.4) },
                  '&:focus-visible': { outline: `2px solid ${alpha('#fff', 0.9)}`, outlineOffset: 2 },
                  '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                }}
              >
                <Icon aria-hidden sx={{ fontSize: 16 }} />
                {label}
              </Box>
            </Tooltip>
          ))}
        </Stack>

        {/* Prova social: avatares recortados das fotos (sem números inventados) */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: `${GOLDEN_SPACE.s2}px` }}>
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
