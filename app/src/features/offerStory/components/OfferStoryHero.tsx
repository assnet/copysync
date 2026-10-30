import { Box, Typography, alpha, useTheme } from '@mui/material';
import { Check } from 'lucide-react';
import { AppIcon } from '@/components';
import { MODULE_ICONS } from '@/pages/modules';
import { offerStoryStrings } from '../strings';
import { REDUCED_MOTION, VISUALLY_HIDDEN, floatShadow, storyGradient, storyWash } from '../storyStyle';
import { templateThumbnail } from '../types';

const t = offerStoryStrings.page;

interface Props {
  step: 0 | 1 | 2;
  /** Até 3 ids para o leque decorativo de prévias (md+). */
  showcaseIds: string[];
}

/** Cabeçalho da tela: título, promessa e indicador das 3 etapas (lista ordenada acessível). */
export function OfferStoryHero({ step, showcaseIds }: Props) {
  const theme = useTheme();
  const fan = showcaseIds.slice(0, 3);

  return (
    <Box
      component="header"
      sx={{
        position: 'relative', overflow: 'hidden', mb: { xs: 2, sm: 3 }, borderRadius: '20px',
        px: { xs: 2, sm: 4 }, py: { xs: 2, sm: 3.5 },
        border: '1px solid', borderColor: 'divider',
        bgcolor: 'background.paper', backgroundImage: storyWash(theme),
      }}
    >
      <Box sx={{ position: 'relative', zIndex: 1, maxWidth: { md: 'calc(100% - 240px)' } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {/* Ícone dentro do anel de story: o elemento de marca da tela. */}
          <Box aria-hidden sx={{ p: '3px', borderRadius: '50%', backgroundImage: storyGradient(theme), flexShrink: 0 }}>
            <Box
              sx={{
                width: { xs: 44, sm: 52 }, height: { xs: 44, sm: 52 }, borderRadius: '50%', display: 'grid', placeItems: 'center',
                bgcolor: 'background.paper', color: 'text.primary', border: '2px solid', borderColor: 'background.paper',
              }}
            >
              <AppIcon icon={MODULE_ICONS.offerStory} size="md" />
            </Box>
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h5" component="h1" sx={{ fontWeight: 800, letterSpacing: '-0.02em', fontSize: { xs: '1.35rem', sm: '1.6rem' } }}>
              {t.title}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, maxWidth: 560, display: { xs: step === 0 ? 'block' : 'none', sm: 'block' } }}>
              {t.subtitle}
            </Typography>
          </Box>
        </Box>

        <Box
          component="ol"
          aria-label={t.stepsLabel}
          sx={{ listStyle: 'none', p: 0, m: 0, mt: { xs: 2, sm: 2.5 }, display: 'flex', alignItems: 'center', gap: { xs: 0.75, sm: 1 }, flexWrap: 'wrap' }}
        >
          {t.steps.map((label, i) => {
            const done = i < step;
            const current = i === step;
            return (
              <Box component="li" key={label} sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.75, sm: 1 } }}>
                {i > 0 && (
                  <Box aria-hidden sx={{ width: { xs: 12, sm: 24 }, height: 2, borderRadius: 1, bgcolor: done || current ? 'primary.main' : 'divider' }} />
                )}
                <Box
                  aria-current={current ? 'step' : undefined}
                  sx={{
                    display: 'inline-flex', alignItems: 'center', gap: 0.75, pl: 0.5, pr: current ? 1.25 : { xs: 0.5, sm: 1.25 }, py: 0.5, borderRadius: 999,
                    fontSize: '0.8125rem', fontWeight: 700, whiteSpace: 'nowrap',
                    color: current ? 'primary.contrastText' : done ? 'text.primary' : 'text.secondary',
                    bgcolor: current ? 'primary.main' : done ? alpha(theme.palette.primary.main, 0.12) : alpha(theme.palette.text.primary, 0.05),
                    backgroundImage: current ? `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})` : 'none',
                    boxShadow: current ? `0 6px 16px -8px ${alpha(theme.palette.secondary.main, 0.9)}` : 'none',
                  }}
                >
                  <Box
                    aria-hidden
                    sx={{
                      width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: '0.75rem',
                      bgcolor: current ? alpha(theme.palette.common.white, 0.22) : done ? 'primary.main' : 'transparent',
                      color: done ? 'primary.contrastText' : 'inherit',
                      border: !done && !current ? '1.5px solid' : 'none', borderColor: 'divider',
                    }}
                  >
                    {done ? <AppIcon icon={Check} size="sm" strokeWidth={3} /> : i + 1}
                  </Box>
                  {/* xs: só a etapa atual mostra o nome; as outras viram número/check (nome fica para leitor de tela). */}
                  <Box component="span" sx={current ? undefined : (th) => ({ [th.breakpoints.down('sm')]: VISUALLY_HIDDEN })}>
                    {label}
                  </Box>
                  {done && <Box component="span" sx={VISUALLY_HIDDEN}>{` (${t.stepDone})`}</Box>}
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* Leque de prévias (decorativo, só md+): mostra o que a tela entrega. */}
      {fan.length === 3 && (
        <Box aria-hidden sx={{ display: { xs: 'none', md: 'block' }, position: 'absolute', right: 32, top: '50%', width: 200, height: 128, transform: 'translateY(-50%)' }}>
          {fan.map((id, i) => (
            <Box
              key={id}
              component="img"
              src={templateThumbnail(id)}
              alt=""
              loading="lazy"
              draggable={false}
              sx={{
                position: 'absolute', top: i === 1 ? 0 : 10, left: 24 + i * 48, width: 64, aspectRatio: '9 / 16', objectFit: 'cover',
                borderRadius: '12px', boxShadow: floatShadow(theme, true), zIndex: i === 1 ? 2 : 1,
                transform: `rotate(${(i - 1) * 9}deg)`,
                outline: `2px solid ${alpha(theme.palette.background.paper, 0.9)}`,
                transition: theme.transitions.create('transform', { duration: 250 }),
                [REDUCED_MOTION]: { transition: 'none' },
              }}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}
