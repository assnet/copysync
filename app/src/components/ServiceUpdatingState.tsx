import { useEffect, useState } from 'react';
import { Box, Button, LinearProgress, Stack, Tooltip, Typography, alpha, useMediaQuery, useTheme } from '@mui/material';
import { RefreshCw } from 'lucide-react';
import { AppIcon } from './AppIcon';
import { serviceUpdatingStrings as t } from './serviceUpdatingStrings';
import { useAutoRetry } from '@/hooks/useAutoRetry';

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export interface ServiceUpdatingStateProps {
  /** Recarrega a tela. Quando der certo, quem chama deixa de renderizar este estado. */
  onRetry: () => unknown;
  /** Versão menor (dentro de cartão/seção, não a aba inteira). */
  compact?: boolean;
}

/** Contorno de engrenagem: `teeth` dentes retos entre `inner` e `outer`. */
function gearPath(cx: number, cy: number, outer: number, inner: number, teeth: number): string {
  const step = (Math.PI * 2) / teeth;
  const pts: string[] = [];
  for (let i = 0; i < teeth; i += 1) {
    const a = i * step;
    const angles: [number, number][] = [
      [a, inner], [a + step * 0.12, outer], [a + step * 0.42, outer], [a + step * 0.54, inner],
    ];
    for (const [ang, r] of angles) pts.push(`${(cx + r * Math.cos(ang)).toFixed(2)} ${(cy + r * Math.sin(ang)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

const BIG_GEAR = gearPath(150, 92, 30, 24, 10);
const SMALL_GEAR = gearPath(186, 58, 18, 13.5, 8);

/**
 * Cena leve em SVG próprio: rack de servidor com luzes de status piscando em sequência e duas
 * engrenagens engatadas girando (o "ajuste" em andamento). Cores do tema (claro/escuro), sem
 * arquivo externo. `prefers-reduced-motion` = cena parada.
 */
function UpdatingIllustration({ animate, size }: { animate: boolean; size: number }) {
  const theme = useTheme();
  const p = theme.palette;
  const rack = p.mode === 'dark' ? alpha(p.common.white, 0.06) : alpha(p.primary.main, 0.05);
  const line = p.mode === 'dark' ? alpha(p.common.white, 0.28) : alpha(p.text.primary, 0.32);
  const spin = (dir: 1 | -1, secs: number) => (animate
    ? { animation: `${dir === 1 ? 'svcGearCw' : 'svcGearCcw'} ${secs}s linear infinite`, transformBox: 'fill-box', transformOrigin: 'center' }
    : {});
  const led = (delay: number) => (animate ? { animation: `svcLed 2.4s ${delay}s ease-in-out infinite` } : {});

  return (
    <Box
      component="svg"
      viewBox="0 0 220 140"
      role="img"
      aria-label={t.illustrationLabel}
      data-motion={animate ? 'on' : 'off'}
      sx={{
        width: size,
        height: 'auto',
        display: 'block',
        '@keyframes svcGearCw': { to: { transform: 'rotate(360deg)' } },
        '@keyframes svcGearCcw': { to: { transform: 'rotate(-360deg)' } },
        '@keyframes svcLed': { '0%, 100%': { opacity: 0.25 }, '40%': { opacity: 1 } },
      }}
    >
      {/* Rack com três gavetas */}
      <rect x="28" y="20" width="96" height="104" rx="10" fill={rack} stroke={line} strokeWidth="2" />
      {[34, 64, 94].map((y, i) => (
        <g key={y}>
          <rect x="38" y={y} width="76" height="22" rx="5" fill={p.background.paper} stroke={line} strokeWidth="1.5" />
          <line x1="48" y1={y + 11} x2="78" y2={y + 11} stroke={line} strokeWidth="2" strokeLinecap="round" />
          <Box component="circle" cx="100" cy={y + 11} r="3.5" fill={p.success.main} sx={led(i * 0.4)} />
        </g>
      ))}
      {/* Engrenagens engatadas */}
      <Box component="g" sx={spin(1, 9)}>
        <path d={BIG_GEAR} fill={p.primary.main} />
        <circle cx="150" cy="92" r="9" fill={p.background.paper} />
      </Box>
      <Box component="g" sx={spin(-1, 6)}>
        <path d={SMALL_GEAR} fill={p.mode === 'dark' ? p.primary.light : p.primary.dark} opacity="0.85" />
        <circle cx="186" cy="58" r="5.5" fill={p.background.paper} />
      </Box>
      <line x1="20" y1="128" x2="204" y2="128" stroke={line} strokeWidth="2" strokeLinecap="round" />
    </Box>
  );
}

/**
 * Estado amigável de "serviço temporariamente indisponível" (deploy/reinício da API): ilustração,
 * texto curto, contagem até a próxima tentativa automática e "Tentar agora". Use só quando
 * `isServiceUnavailable(err)`; os demais erros continuam no alerta da tela.
 */
export function ServiceUpdatingState({ onRetry, compact = false }: ServiceUpdatingStateProps) {
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);
  const r = useAutoRetry(onRetry);
  const [announce, setAnnounce] = useState('');

  // Anúncio só ao falhar de novo (não a cada segundo da contagem).
  useEffect(() => {
    if (r.attempts > 0) setAnnounce(t.stillUpdating);
  }, [r.attempts]);

  const status = r.retrying ? t.retrying : r.paused ? t.paused : t.nextAttempt(r.secondsLeft ?? 0);

  return (
    <Stack
      alignItems="center"
      textAlign="center"
      spacing={compact ? 1.5 : 2}
      sx={{ py: compact ? 3 : { xs: 4, sm: 6 }, px: 2, maxWidth: 440, mx: 'auto' }}
    >
      <UpdatingIllustration animate={!reducedMotion} size={compact ? 140 : 200} />
      <Box aria-live="polite">
        <Typography component="h2" variant={compact ? 'subtitle1' : 'h6'} sx={{ fontWeight: 600 }}>
          {t.title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {t.description}
        </Typography>
        <Box component="span" sx={visuallyHidden}>{announce}</Box>
      </Box>
      <Stack spacing={1} alignItems="center" sx={{ width: '100%', maxWidth: 260 }}>
        <Typography
          variant="caption"
          color="text.secondary"
          data-testid="service-updating-status"
          sx={{ fontVariantNumeric: 'tabular-nums', minHeight: '1.5em' }}
        >
          {status}
        </Typography>
        {r.retrying && <LinearProgress sx={{ width: '100%', borderRadius: 2 }} aria-hidden />}
        <Tooltip title={t.retryNowHint} arrow describeChild>
          <span>
            <Button
              variant="outlined"
              size="small"
              onClick={r.retryNow}
              disabled={r.retrying}
              startIcon={<AppIcon icon={RefreshCw} size="inline" />}
            >
              {t.retryNow}
            </Button>
          </span>
        </Tooltip>
      </Stack>
    </Stack>
  );
}

const visuallyHidden = {
  position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap',
} as const;
