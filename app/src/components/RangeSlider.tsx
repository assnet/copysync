import { Box, Slider, Typography } from '@mui/material';
import { keyframes, useTheme } from '@mui/material/styles';
import { energyColor } from './CooldownBar';

export type RangeValue = readonly [number, number];

/** Mantém `[lo, hi]` dentro de `[min, max]`, inteiros no passo, com `lo + minDistance <= hi`. */
export function clampRange(
  next: RangeValue,
  bounds: { min: number; max: number; step?: number; minDistance?: number },
  activeThumb: 0 | 1 = 0,
): [number, number] {
  const step = bounds.step ?? 1;
  const gap = bounds.minDistance ?? 0;
  const snap = (v: number) => Math.min(bounds.max, Math.max(bounds.min, Math.round(v / step) * step));
  let lo = snap(next[0]);
  let hi = snap(next[1]);
  if (hi - lo < gap) {
    // O cursor arrastado manda; o outro cede, até o limite da escala.
    if (activeThumb === 0) {
      lo = Math.min(lo, bounds.max - gap);
      hi = lo + gap;
    } else {
      hi = Math.max(hi, bounds.min + gap);
      lo = hi - gap;
    }
  }
  return [lo, hi];
}

const pop = keyframes`
  from { transform: translateY(4px) scale(0.92); opacity: 0; }
  to { transform: translateY(0) scale(1); opacity: 1; }
`;

const beat = keyframes`
  0%, 100% { box-shadow: 0 0 0 0 currentColor; opacity: 1; }
  50% { box-shadow: 0 0 0 5px transparent; opacity: 0.7; }
`;

const HIGH_RISK_BELOW = 0.25;

export interface RangeSliderStatus {
  /** 0 = pior (vermelho) … 1 = melhor (verde). Colore a faixa, os cursores e o rótulo. */
  score: number;
  /** Texto do rótulo centralizado sobre a barra (ex.: "Risco moderado"). */
  label: string;
  /** Nome do indicador para leitor de tela (ex.: "Nível de risco do intervalo"). */
  ariaLabel: string;
}

export interface RangeSliderProps {
  value: RangeValue;
  onChange: (value: [number, number]) => void;
  /** Limites da escala. */
  min: number;
  max: number;
  step?: number;
  /** Distância mínima entre os cursores (na unidade do valor). */
  minDistance?: number;
  /** Nome acessível do controle; cada cursor vira "<ariaLabel>: <minLabel|maxLabel>". */
  ariaLabel: string;
  /** Rótulos dos extremos. Padrão: Mínimo / Máximo. */
  minLabel?: string;
  maxLabel?: string;
  /** Texto do valor (ex.: `${n} min`). Padrão: o número. */
  formatValue?: (value: number) => string;
  /** Termômetro: cor da faixa e rótulo de status sobre a barra, calculados por quem chama. */
  status?: RangeSliderStatus;
  disabled?: boolean;
  error?: boolean;
}

/**
 * Faixa mínimo–máximo em uma barra com dois cursores arrastáveis. Os valores escolhidos ficam
 * nos extremos e acompanham o arraste; os limites da escala aparecem abaixo. Com `status`,
 * a faixa vira termômetro: cor contínua vermelho → âmbar → verde e rótulo animado no centro.
 * Para qualquer par "entre X e Y" (intervalo de envio, janela de horário, faixa de preço).
 */
export function RangeSlider({
  value, onChange, min, max, step = 1, minDistance = 0, ariaLabel,
  minLabel = 'Mínimo', maxLabel = 'Máximo', formatValue = (v) => String(v), status, disabled, error,
}: RangeSliderProps) {
  const theme = useTheme();
  const [lo, hi] = clampRange(value, { min, max, step, minDistance });
  const palette = { full: theme.palette.success.main, mid: theme.palette.warning.main, low: theme.palette.error.main };
  const statusColor = status ? energyColor(status.score, palette) : null;
  const accent = error ? theme.palette.error.main : statusColor;
  const highRisk = status !== undefined && status.score < HIGH_RISK_BELOW;
  const valueColor = error ? 'error.main' : 'text.primary';

  return (
    <Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', columnGap: 2, rowGap: 1, mb: 0.5 }}>
        <Box>
          <Typography variant="caption" color="text.secondary" component="p">{minLabel}</Typography>
          <Typography variant="h6" component="p" aria-hidden sx={{ fontWeight: 700, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums', color: valueColor }}>
            {formatValue(lo)}
          </Typography>
        </Box>

        {status && statusColor && (
          <Box
            role="status"
            aria-live="polite"
            aria-label={status.ariaLabel}
            // Tela estreita: o rótulo sobe para a própria linha, centralizado, e nunca quebra
            sx={{ alignSelf: 'center', display: 'flex', justifyContent: 'center', flex: 1, minWidth: 0, flexBasis: { xs: '100%', sm: 'auto' }, order: { xs: -1, sm: 0 } }}
          >
            <Box
              key={status.label}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.75,
                px: 1.5,
                py: 0.5,
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: 0.2,
                whiteSpace: 'nowrap',
                color: statusColor,
                backgroundColor: `color-mix(in oklab, ${statusColor} 16%, transparent)`,
                border: '1px solid',
                borderColor: `color-mix(in oklab, ${statusColor} 45%, transparent)`,
                transition: 'color 400ms, background-color 400ms, border-color 400ms',
                animation: `${pop} 260ms cubic-bezier(.2,.9,.3,1.2)`,
                '@media (prefers-reduced-motion: reduce)': { animation: 'none', transition: 'none' },
              }}
            >
              <Box
                component="span"
                aria-hidden
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: 'currentColor',
                  animation: highRisk ? `${beat} 1.1s ease-out infinite` : 'none',
                  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
                }}
              />
              {status.label}
            </Box>
          </Box>
        )}

        <Box sx={{ textAlign: 'right' }}>
          <Typography variant="caption" color="text.secondary" component="p">{maxLabel}</Typography>
          <Typography variant="h6" component="p" aria-hidden sx={{ fontWeight: 700, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums', color: valueColor }}>
            {formatValue(hi)}
          </Typography>
        </Box>
      </Box>

      <Slider
        value={[lo, hi]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        disableSwap
        valueLabelDisplay="auto"
        valueLabelFormat={formatValue}
        getAriaLabel={(index) => `${ariaLabel}: ${index === 0 ? minLabel : maxLabel}`}
        getAriaValueText={formatValue}
        onChange={(_e, next, activeThumb) => {
          if (!Array.isArray(next)) return;
          onChange(clampRange([next[0]!, next[1]!], { min, max, step, minDistance }, activeThumb === 1 ? 1 : 0));
        }}
        color={error ? 'error' : 'primary'}
        sx={{
          mx: 1,
          width: 'calc(100% - 16px)',
          height: 6,
          '& .MuiSlider-thumb': { width: 22, height: 22, backgroundColor: '#fff', border: '3px solid currentColor', transition: 'border-color 400ms, box-shadow 150ms' },
          '& .MuiSlider-thumb:hover, & .MuiSlider-thumb.Mui-focusVisible, & .MuiSlider-thumb.Mui-active': {
            boxShadow: `0 0 0 8px color-mix(in oklab, ${accent ?? theme.palette.primary.main} 25%, transparent)`,
          },
          '& .MuiSlider-valueLabel': { backgroundColor: accent ?? undefined },
          ...(accent && {
            color: accent,
            '& .MuiSlider-track': {
              border: 0,
              transition: 'background-color 400ms',
              boxShadow: `0 0 12px 0 color-mix(in oklab, ${accent} 55%, transparent)`,
            },
            '& .MuiSlider-rail': { opacity: 0.28 },
          }),
          '@media (prefers-reduced-motion: reduce)': { '& *': { transition: 'none !important' } },
        }}
      />

      <Box sx={{ display: 'flex', justifyContent: 'space-between' }} aria-hidden>
        <Typography variant="caption" color="text.disabled" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatValue(min)}</Typography>
        <Typography variant="caption" color="text.disabled" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatValue(max)}</Typography>
      </Box>
    </Box>
  );
}
