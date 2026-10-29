import { useId } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, Stack, Typography, useMediaQuery } from '@mui/material';
import { alpha, keyframes, useTheme } from '@mui/material/styles';
import { ArrowRight, Check, Rocket, Sparkles } from 'lucide-react';
import { Link as RouterLink } from 'react-router-dom';
import { AppIcon } from '@/components';
import { nextPlanFor, type PlanLimitKind } from '../planUpsell';
import { linkRotationStrings } from '../strings';

const t = linkRotationStrings.upgrade;

export interface PlanLimitBannerProps {
  /** Aviso visível. */
  open: boolean;
  /** Dispensar ("Agora não"). */
  onClose: () => void;
  /** Qual limite foi atingido: rodízios do tenant ou grupos por rodízio. */
  kind: PlanLimitKind;
  /** Limite atual do plano para o `kind` (número, nunca ilimitado: sem limite não há aviso). */
  limit: number;
}

const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';

const rise = keyframes`
  from { opacity: 0; transform: translateY(12px) scale(0.96); }
  to { opacity: 1; transform: none; }
`;
const launch = keyframes`
  0% { transform: translateY(14px) scale(0.6) rotate(-12deg); opacity: 0; }
  60% { transform: translateY(-4px) scale(1.08) rotate(4deg); opacity: 1; }
  100% { transform: none; opacity: 1; }
`;
const twinkle = keyframes`
  0%, 100% { opacity: 0.4; transform: scale(0.85) rotate(0deg); }
  50% { opacity: 1; transform: scale(1.15) rotate(18deg); }
`;
const burst = keyframes`
  0% { opacity: 0; transform: translate(0, 0) rotate(0deg) scale(0.4); }
  15% { opacity: 1; }
  100% { opacity: 0; transform: translate(var(--dx), var(--dy)) rotate(var(--rot)) scale(1); }
`;
const shine = keyframes`
  from { transform: translateX(-120%) skewX(-20deg); }
  to { transform: translateX(220%) skewX(-20deg); }
`;

/** Confete fixo (posição/direção determinísticas: sem `Math.random` no render). */
const CONFETTI = [
  [-110, -40, 200], [-80, -70, -160], [-50, -90, 120], [-20, -60, -90], [20, -95, 140], [55, -70, -200],
  [85, -50, 170], [115, -30, -120], [-95, 20, 90], [-40, 35, -60], [45, 40, 110], [100, 25, -150],
] as const;

/**
 * Aviso de upgrade quando o plano não comporta mais rodízios/grupos, com CTA para `/plans`.
 * O próximo plano e seu limite vêm do catálogo da vitrine; no maior plano o texto não oferece
 * upgrade. Com `prefers-reduced-motion`, nada se move (sem confete, sem entrada animada).
 */
export function PlanLimitBanner({ open, onClose, kind, limit }: PlanLimitBannerProps) {
  const theme = useTheme();
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)', { noSsr: true });
  const titleId = useId();
  const bodyId = useId();
  const next = nextPlanFor(kind, limit);
  const dark = theme.palette.mode === 'dark';
  const from = dark ? theme.palette.primary.dark : theme.palette.primary.main;
  const to = dark ? theme.palette.secondary.dark : theme.palette.secondary.main;
  const onGradient = theme.palette.primary.contrastText;
  const confettiColors = [theme.palette.primary.light, theme.palette.secondary.light, theme.palette.warning.light, theme.palette.success.light, onGradient];
  const motion = (value: string) => (reduced ? 'none' : value);

  const title = next ? (kind === 'rotations' ? t.rotationsTitle : t.groupsTitle) : t.topPlanTitle;
  const body = next ? (kind === 'rotations' ? t.rotationsBody(limit) : t.groupsBody(limit)) : t.topPlanBody(limit, kind);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      PaperProps={{
        sx: {
          overflow: 'hidden',
          borderRadius: 3,
          animation: motion(`${rise} 320ms cubic-bezier(.2,.9,.3,1.1)`),
          [REDUCED_MOTION]: { animation: 'none' },
        },
      }}
    >
      <Box
        data-motion={reduced ? 'reduced' : 'full'}
        sx={{
          position: 'relative',
          overflow: 'hidden',
          height: 148,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: onGradient,
          backgroundImage: `radial-gradient(circle at 20% 15%, ${alpha(onGradient, 0.22)}, transparent 45%), linear-gradient(135deg, ${from}, ${to})`,
        }}
      >
        {!reduced && (
          <>
            <Box
              aria-hidden
              data-testid="plan-limit-shine"
              sx={{
                position: 'absolute', inset: 0, width: '40%',
                background: `linear-gradient(90deg, transparent, ${alpha(onGradient, 0.25)}, transparent)`,
                animation: `${shine} 1.6s ease-out 300ms 1 both`,
                [REDUCED_MOTION]: { display: 'none' },
              }}
            />
            {CONFETTI.map(([dx, dy, rot], i) => (
              <Box
                key={i}
                aria-hidden
                data-testid="plan-limit-confetti"
                sx={{
                  position: 'absolute', top: '50%', left: '50%',
                  width: i % 3 === 0 ? 6 : 8, height: i % 3 === 0 ? 6 : 4,
                  borderRadius: i % 3 === 0 ? '50%' : 0.5,
                  backgroundColor: confettiColors[i % confettiColors.length],
                  opacity: 0,
                  '--dx': `${dx}px`, '--dy': `${dy}px`, '--rot': `${rot}deg`,
                  animation: `${burst} 1.1s cubic-bezier(.15,.7,.3,1) ${120 + i * 35}ms 1 both`,
                  [REDUCED_MOTION]: { display: 'none' },
                }}
              />
            ))}
          </>
        )}
        <Box
          sx={{
            position: 'relative',
            width: 76, height: 76, borderRadius: '50%',
            display: 'grid', placeItems: 'center',
            backgroundColor: alpha(onGradient, 0.18),
            border: `1px solid ${alpha(onGradient, 0.35)}`,
            boxShadow: `0 10px 30px ${alpha(theme.palette.common.black, 0.25)}`,
            animation: motion(`${launch} 600ms cubic-bezier(.2,.9,.3,1.2) 80ms both`),
            [REDUCED_MOTION]: { animation: 'none' },
            '& svg': { width: 36, height: 36 },
          }}
        >
          <AppIcon icon={next ? Rocket : Sparkles} size="lg" />
          <Box
            aria-hidden
            sx={{
              position: 'absolute', top: -6, right: -8, display: 'flex',
              animation: motion(`${twinkle} 2.4s ease-in-out infinite`),
              [REDUCED_MOTION]: { animation: 'none' },
              '& svg': { width: 20, height: 20 },
            }}
          >
            <AppIcon icon={Sparkles} size="md" />
          </Box>
        </Box>
      </Box>

      <DialogContent sx={{ pt: 3 }}>
        <Typography variant="overline" color="primary" sx={{ fontWeight: 700, letterSpacing: 1 }}>{t.eyebrow}</Typography>
        <Typography id={titleId} variant="h5" component="h2" sx={{ fontWeight: 800, lineHeight: 1.25, mb: 1 }}>{title}</Typography>
        <Typography id={bodyId} variant="body2" color="text.secondary">{body}</Typography>

        {next && (
          <>
            <Stack
              direction="row"
              alignItems="stretch"
              spacing={1.5}
              role="img"
              aria-label={t.compareAria(limit, next.name, next.limit, kind)}
              sx={{ mt: 2.5 }}
            >
              <Box sx={{ flex: 1, p: 1.5, borderRadius: 2, border: 1, borderColor: 'divider', textAlign: 'center' }}>
                <Typography variant="caption" color="text.secondary" component="p">{t.compareNow}</Typography>
                <Typography variant="h5" component="p" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{limit}</Typography>
                <Typography variant="caption" color="text.secondary" component="p">{t.unit(limit, kind)}</Typography>
              </Box>
              <Box aria-hidden sx={{ display: 'grid', placeItems: 'center', color: 'text.secondary' }}>
                <AppIcon icon={ArrowRight} size="md" />
              </Box>
              <Box
                sx={{
                  flex: 1, p: 1.5, borderRadius: 2, textAlign: 'center', position: 'relative',
                  border: '2px solid transparent',
                  background: `linear-gradient(${theme.palette.background.paper}, ${theme.palette.background.paper}) padding-box, linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main}) border-box`,
                }}
              >
                <Typography variant="caption" color="primary" component="p" sx={{ fontWeight: 700 }}>{next.name}</Typography>
                <Typography
                  variant="h5"
                  component="p"
                  sx={{
                    fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                    backgroundImage: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
                    backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent',
                  }}
                >
                  {next.limit}
                </Typography>
                <Typography variant="caption" color="text.secondary" component="p">{t.unit(next.limit, kind)}</Typography>
              </Box>
            </Stack>
            <Typography variant="body2" sx={{ mt: 2, fontWeight: 600 }}>{t.nextPlan(next.name, next.limit, kind)}</Typography>
            <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ mt: 0.75, color: 'success.main' }}>
              <AppIcon icon={Check} style={{ marginTop: 2 }} />
              <Typography variant="body2" color="text.secondary">{kind === 'rotations' ? t.rotationsBenefit : t.groupsBenefit}</Typography>
            </Stack>
          </>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        {next ? (
          <>
            <Button onClick={onClose} color="inherit">{t.dismiss}</Button>
            <Button
              variant="contained"
              component={RouterLink}
              to="/plans"
              onClick={onClose}
              endIcon={<AppIcon icon={ArrowRight} />}
              sx={{
                fontWeight: 700,
                color: onGradient,
                backgroundImage: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
                boxShadow: `0 6px 18px ${alpha(theme.palette.primary.main, 0.35)}`,
                transition: 'transform 150ms, box-shadow 150ms',
                '&:hover': { transform: 'translateY(-1px)', boxShadow: `0 8px 22px ${alpha(theme.palette.primary.main, 0.45)}` },
                [REDUCED_MOTION]: { transition: 'none', '&:hover': { transform: 'none' } },
              }}
            >
              {t.cta}
            </Button>
          </>
        ) : (
          <Button variant="contained" onClick={onClose}>{t.topPlanDismiss}</Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
