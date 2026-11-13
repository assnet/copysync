import { Box, ButtonBase, Chip, Typography, alpha, useTheme } from '@mui/material';
import { Play } from 'lucide-react';
import { AppIcon } from '@/components/AppIcon';
import { BrandLogo } from '@/shared/branding/BrandLogo';
import { thumbnailUrl, type Lesson } from '../catalog';
import { formatClock } from '../progress';
import { REDUCED_MOTION, THUMB_FALLBACK, THUMB_SCRIM, accentGradient, heroWash } from '../style';
import { tutorialsStrings as t } from '../strings';

export type FeaturedKind = 'start' | 'resume' | 'next' | 'review';

interface Props {
  lessonCount: number;
  groupCount: number;
  upcoming: number;
  /** Aula em destaque (próxima da trilha, ou a primeira ao concluir tudo). `null` sem aula com vídeo. */
  featured: Lesson | null;
  kind: FeaturedKind;
  resumeAt: number;
  onWatch: () => void;
}

/** Abertura da tela: promessa, números do acervo e a aula em destaque com um clique para assistir. */
export function TrailHero({ lessonCount, groupCount, upcoming, featured, kind, resumeAt, onWatch }: Props) {
  const theme = useTheme();
  const copy = featured ? t.lessons[featured.id as keyof typeof t.lessons] : null;
  const pills: { value: string; label: string }[] = [
    { value: String(lessonCount), label: t.hero.pill.lessons(lessonCount) },
    { value: String(groupCount), label: t.hero.pill.groups },
    { value: '100%', label: t.hero.pill.free },
  ];

  return (
    <Box
      component="header"
      sx={{
        position: 'relative', overflow: 'hidden', mb: 3, borderRadius: '20px', p: { xs: 2.5, sm: 4 },
        border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', backgroundImage: heroWash(theme),
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
        <BrandLogo size={36} />
        <Chip
          size="small"
          label={t.hero.eyebrow}
          sx={{ fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', fontSize: '0.6875rem', color: 'primary.main', bgcolor: alpha(theme.palette.primary.main, 0.12), border: '1px solid', borderColor: alpha(theme.palette.primary.main, 0.35) }}
        />
      </Box>

      <Typography variant="h4" component="h1" sx={{ fontWeight: 800, fontSize: { xs: '1.6rem', sm: '2.1rem' }, maxWidth: 720 }}>
        {t.hero.headline}
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 1, maxWidth: 640 }}>{t.subtitle}</Typography>

      <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0, mt: 2.5, display: 'flex', flexWrap: 'wrap', gap: 1.25 }}>
        {pills.map((p) => (
          <Box
            component="li"
            key={p.label}
            sx={{ display: 'inline-flex', alignItems: 'baseline', gap: 0.75, px: 1.75, py: 0.75, borderRadius: 999, border: '1px solid', borderColor: 'divider', bgcolor: alpha(theme.palette.background.paper, 0.7) }}
          >
            <Typography component="span" sx={{ fontWeight: 800, color: 'primary.main' }}>{p.value}</Typography>
            <Typography component="span" variant="body2" color="text.secondary">{p.label}</Typography>
          </Box>
        ))}
        {upcoming > 0 && (
          <Box component="li" sx={{ display: 'inline-flex', alignItems: 'center', px: 1.75, py: 0.75 }}>
            <Typography variant="caption" color="text.secondary">{t.hero.upcoming(upcoming)}</Typography>
          </Box>
        )}
      </Box>

      {featured && copy?.title && featured.youtubeId && (
        <Box
          sx={{
            mt: 3, display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: { xs: 2, sm: 3 }, p: { xs: 1.5, sm: 2 },
            borderRadius: '16px', border: '1px solid', borderColor: alpha(theme.palette.primary.main, 0.35),
            bgcolor: alpha(theme.palette.background.default, theme.palette.mode === 'dark' ? 0.5 : 0.7),
          }}
        >
          <ButtonBase
            onClick={onWatch}
            aria-label={t.card.play(copy.title)}
            sx={{
              position: 'relative', flexShrink: 0, width: { xs: '100%', sm: 300 }, aspectRatio: '16 / 9', borderRadius: '12px', overflow: 'hidden',
              background: THUMB_FALLBACK, '&:hover .hero-play': { transform: 'translate(-50%, -50%) scale(1.08)' },
              '&.Mui-focusVisible': { outline: '3px solid', outlineColor: 'primary.main', outlineOffset: 2 },
            }}
          >
            <Box component="img" src={thumbnailUrl(featured.youtubeId)} alt="" loading="lazy" decoding="async" sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            <Box sx={{ position: 'absolute', inset: 0, background: THUMB_SCRIM }} />
            <Box
              className="hero-play"
              sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 52, height: 52, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: 'primary.main', color: 'primary.contrastText', boxShadow: '0 8px 24px rgba(0,0,0,.4)', transition: 'transform .2s ease', [REDUCED_MOTION]: { transition: 'none' } }}
            >
              <AppIcon icon={Play} size="lg" fill="currentColor" style={{ marginLeft: 2 }} />
            </Box>
          </ButtonBase>

          <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1, minWidth: 0 }}>
            <Chip size="small" label={t.hero.featured[kind]} sx={{ alignSelf: 'flex-start', fontWeight: 700, textTransform: 'uppercase', fontSize: '0.6875rem', letterSpacing: 0.6, color: 'primary.contrastText', backgroundImage: accentGradient(theme) }} />
            <Typography variant="h6" component="h2" sx={{ fontWeight: 800, lineHeight: 1.25 }}>{copy.title}</Typography>
            <Typography variant="body2" color="text.secondary">{t.lessons[featured.id as keyof typeof t.lessons].description}</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5, mt: 0.5 }}>
              <ButtonBase
                onClick={onWatch}
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, px: 2.25, py: 1.1, borderRadius: '10px', fontWeight: 700, fontSize: '0.9375rem', color: 'primary.contrastText', backgroundImage: accentGradient(theme), boxShadow: `0 8px 20px -10px ${alpha(theme.palette.primary.main, 0.9)}`, '&.Mui-focusVisible': { outline: '3px solid', outlineColor: 'primary.light', outlineOffset: 2 } }}
              >
                <AppIcon icon={Play} size="md" fill="currentColor" />
                {kind === 'resume' ? t.hero.continueCta : kind === 'review' ? t.hero.reviewCta : t.hero.watchNow}
              </ButtonBase>
              {kind === 'resume' && resumeAt > 0 && (
                <Typography variant="caption" color="text.secondary">{t.hero.resumeFrom(formatClock(resumeAt))}</Typography>
              )}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
}
