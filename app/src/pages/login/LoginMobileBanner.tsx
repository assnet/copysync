import { Box, Typography, alpha } from '@mui/material';
import { APP_NAME } from '@/shared/branding/brand';
import { BrandLogo } from '@/shared/branding/BrandLogo';
import { BRAND_NAVY, LOGIN_COPY, LOGIN_IMAGES } from './loginContent';
import { GOLDEN_SPACE, GOLDEN_TYPE, PHI } from './goldenRatio';

/**
 * Faixa superior compacta (xs/sm): foto com overlay navy, logo e headline curta.
 * φ aplicado: altura = 144 × φ ≈ 233 px; headline em 26 px (16 × φ).
 */
export function LoginMobileBanner() {
  return (
    <Box
      component="header"
      sx={{
        position: 'relative', overflow: 'hidden', isolation: 'isolate',
        minHeight: Math.round(144 * PHI), // ≈ 233 px
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        p: `${GOLDEN_SPACE.s3}px`, // 21 px
        color: '#fff', bgcolor: BRAND_NAVY,
      }}
    >
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
          objectFit: 'cover', objectPosition: '62% 35%', zIndex: -2,
        }}
      />
      <Box
        aria-hidden
        sx={{
          position: 'absolute', inset: 0, zIndex: -1,
          background: `linear-gradient(180deg, ${alpha(BRAND_NAVY, 0.45)} 0%, ${alpha(BRAND_NAVY, 0.94)} 100%)`,
        }}
      />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: `${GOLDEN_SPACE.s2}px` }}>
        <BrandLogo size={36} />
        <Typography component="span" sx={{ fontSize: GOLDEN_TYPE.base + 2, fontWeight: 800, letterSpacing: -0.4 }}>
          {APP_NAME}
        </Typography>
      </Box>
      <Typography
        component="h2"
        sx={{
          fontSize: GOLDEN_TYPE.lead, // 26 px
          fontWeight: 800, letterSpacing: -0.6, lineHeight: 1.15,
          textWrap: 'balance', maxWidth: 360, mt: `${GOLDEN_SPACE.s3}px`,
        }}
      >
        {LOGIN_COPY.headlineShort}
      </Typography>
    </Box>
  );
}
