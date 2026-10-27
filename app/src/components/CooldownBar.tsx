import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import { alpha, keyframes, useTheme } from '@mui/material/styles';
import { serverNow } from '@/services/serverClock';

export type CooldownTime = number | string | Date;

const toMs = (value: CooldownTime): number => (typeof value === 'number' ? value : new Date(value).getTime());

/** Carga restante: 1 = cheia, 0 = vazia. Janela vazia ou inválida = 0. */
export function cooldownFraction(startMs: number, endMs: number, nowMs: number): number {
  const total = endMs - startMs;
  if (!(total > 0)) return 0;
  return Math.min(1, Math.max(0, (endMs - nowMs) / total));
}

/** Segundos inteiros restantes, arredondados para cima (mostra "1 s" até o fim). */
export function cooldownRemainingSeconds(endMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((endMs - nowMs) / 1000));
}

export interface EnergyPalette {
  full: string;
  mid: string;
  low: string;
}

/** Cor contínua da carga: cheia → `full`, metade → `mid`, vazia → `low`. */
export function energyColor(fraction: number, palette: EnergyPalette): string {
  if (fraction >= 0.5) {
    return `color-mix(in oklab, ${palette.full} ${Math.round((fraction - 0.5) * 200)}%, ${palette.mid})`;
  }
  return `color-mix(in oklab, ${palette.mid} ${Math.round(fraction * 200)}%, ${palette.low})`;
}

const shine = keyframes`
  from { transform: translateX(-120%); }
  to { transform: translateX(320%); }
`;

const lowPulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
`;

const LOW_FRACTION = 0.2;

export interface CooldownBarProps {
  /** Início e fim da espera no relógio do servidor (ms, ISO ou Date). */
  startAt: CooldownTime;
  endAt: CooldownTime;
  /** Nome acessível da barra. */
  ariaLabel: string;
  /** Texto à esquerda, acima da barra. */
  label?: ReactNode;
  /** Texto do tempo restante. Padrão: "12 s". */
  formatRemaining?: (seconds: number) => string;
  /** Mostrado no lugar do tempo quando zera. */
  doneLabel?: string;
  /** Tooltip sobre a barra (ex.: horário do próximo evento). */
  tooltip?: ReactNode;
  /** Relógio; padrão `serverNow` (corrige o relógio local pelo do servidor). */
  now?: () => number;
  /** Chamado uma vez quando a carga zera. */
  onComplete?: () => void;
  size?: 'small' | 'medium';
  /** Células da barra. Padrão: uma por segundo da janela (entre 4 e 30). */
  segments?: number;
}

/**
 * Barra de energia que esvazia até zerar — para qualquer cooldown com horário de fim conhecido.
 *
 * Precisão: cada quadro recalcula a carga pelo relógio (não acumula ticks); aba em segundo plano
 * retoma no ponto certo. O quadro escreve `transform` direto no DOM; o React só renderiza quando
 * o segundo exibido muda.
 */
export function CooldownBar({
  startAt, endAt, ariaLabel, label, formatRemaining = (s) => `${s} s`, doneLabel, tooltip,
  now, onComplete, size = 'medium', segments,
}: CooldownBarProps) {
  const theme = useTheme();
  const startMs = toMs(startAt);
  const endMs = toMs(endAt);
  const clockRef = useRef(now ?? serverNow);
  clockRef.current = now ?? serverNow;
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const fillRef = useRef<HTMLDivElement>(null);
  const [remaining, setRemaining] = useState(() => cooldownRemainingSeconds(endMs, clockRef.current()));
  const [low, setLow] = useState(false);

  const { full, mid, low: lowColor } = {
    full: theme.palette.success.main,
    mid: theme.palette.warning.main,
    low: theme.palette.error.main,
  };

  useLayoutEffect(() => {
    const raf = window.requestAnimationFrame?.bind(window) ?? ((cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16));
    const cancel = window.cancelAnimationFrame?.bind(window) ?? window.clearTimeout.bind(window);
    let frame = 0;
    let shownSecond = -1;
    let completed = false;

    const paint = () => {
      const nowMs = clockRef.current();
      const fraction = cooldownFraction(startMs, endMs, nowMs);
      const el = fillRef.current;
      if (el) {
        const color = energyColor(fraction, { full, mid, low: lowColor });
        el.style.transform = `scaleX(${fraction})`;
        el.style.backgroundColor = color;
        el.style.color = color;
      }
      const second = cooldownRemainingSeconds(endMs, nowMs);
      if (second !== shownSecond) {
        shownSecond = second;
        setRemaining(second);
        setLow(fraction > 0 && fraction <= LOW_FRACTION);
      }
      if (fraction <= 0) {
        if (!completed) {
          completed = true;
          onCompleteRef.current?.();
        }
        return;
      }
      frame = raf(paint);
    };

    paint();
    return () => cancel(frame);
  }, [startMs, endMs, full, mid, lowColor]);

  const totalSeconds = Math.max(0, Math.round((endMs - startMs) / 1000));
  const cells = segments ?? Math.min(30, Math.max(4, totalSeconds));
  const height = size === 'small' ? 8 : 14;
  const done = remaining === 0;
  const valueText = done && doneLabel ? doneLabel : formatRemaining(remaining);

  const bar = (
    <Box
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={totalSeconds}
      aria-valuenow={remaining}
      aria-valuetext={valueText}
      sx={{
        position: 'relative',
        height,
        borderRadius: 999,
        overflow: 'hidden',
        bgcolor: alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.1 : 0.07),
        border: 1,
        borderColor: alpha(theme.palette.text.primary, 0.12),
      }}
    >
      <Box
        ref={fillRef}
        sx={{
          position: 'absolute',
          inset: 0,
          transformOrigin: 'left center',
          willChange: 'transform',
          borderRadius: 'inherit',
          overflow: 'hidden',
          // Volume: brilho no topo + aura na cor da carga (currentColor = cor atual)
          backgroundImage: `linear-gradient(180deg, ${alpha('#fff', 0.35)} 0%, ${alpha('#fff', 0)} 65%)`,
          boxShadow: '0 0 12px 0 currentColor',
          animation: low ? `${lowPulse} 0.9s ease-in-out infinite` : 'none',
          '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        }}
      >
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            width: '30%',
            background: `linear-gradient(90deg, transparent, ${alpha('#fff', 0.45)}, transparent)`,
            animation: done ? 'none' : `${shine} 2.2s linear infinite`,
            '@media (prefers-reduced-motion: reduce)': { display: 'none' },
          }}
        />
      </Box>
      {/* Células de energia: frestas na cor do fundo por cima da carga */}
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          backgroundImage: `linear-gradient(90deg, transparent calc(100% - 2px), ${theme.palette.background.paper} 0)`,
          backgroundSize: `calc(100% / ${cells}) 100%`,
        }}
      />
    </Box>
  );

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, mb: 0.75 }}>
        <Typography variant="body2" color="text.secondary" noWrap sx={{ minWidth: 0 }}>{label}</Typography>
        <Typography
          variant="body2"
          fontWeight={700}
          aria-hidden
          sx={{ fontVariantNumeric: 'tabular-nums', color: done ? 'text.secondary' : low ? 'error.main' : 'text.primary', flexShrink: 0 }}
        >
          {valueText}
        </Typography>
      </Box>
      {tooltip ? <Tooltip title={tooltip} arrow placement="top">{bar}</Tooltip> : bar}
    </Box>
  );
}
