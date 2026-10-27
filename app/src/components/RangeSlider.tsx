import { Box, Slider, Typography } from '@mui/material';

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
  /** Texto do valor (ex.: `${n} s`). Padrão: o número. */
  formatValue?: (value: number) => string;
  disabled?: boolean;
  error?: boolean;
}

/**
 * Faixa mínimo–máximo em uma barra com dois cursores arrastáveis. Os valores escolhidos ficam
 * nos extremos e acompanham o arraste; os limites da escala aparecem abaixo. Para qualquer
 * par "entre X e Y" (intervalo de envio, janela de horário, faixa de preço).
 */
export function RangeSlider({
  value, onChange, min, max, step = 1, minDistance = 0, ariaLabel,
  minLabel = 'Mínimo', maxLabel = 'Máximo', formatValue = (v) => String(v), disabled, error,
}: RangeSliderProps) {
  const [lo, hi] = clampRange(value, { min, max, step, minDistance });
  const color = error ? 'error.main' : 'text.primary';

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 2, mb: 0.5 }}>
        <Box>
          <Typography variant="caption" color="text.secondary" component="p">{minLabel}</Typography>
          <Typography variant="h6" component="p" aria-hidden sx={{ fontWeight: 700, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums', color }}>
            {formatValue(lo)}
          </Typography>
        </Box>
        <Box sx={{ textAlign: 'right' }}>
          <Typography variant="caption" color="text.secondary" component="p">{maxLabel}</Typography>
          <Typography variant="h6" component="p" aria-hidden sx={{ fontWeight: 700, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums', color }}>
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
        sx={{ mx: 1, width: 'calc(100% - 16px)', '& .MuiSlider-thumb': { width: 20, height: 20 } }}
      />

      <Box sx={{ display: 'flex', justifyContent: 'space-between' }} aria-hidden>
        <Typography variant="caption" color="text.disabled" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatValue(min)}</Typography>
        <Typography variant="caption" color="text.disabled" sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatValue(max)}</Typography>
      </Box>
    </Box>
  );
}
