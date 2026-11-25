import { useRef, type KeyboardEvent } from 'react';
import { Box, ButtonBase, Tooltip } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { WATERMARK_POSITIONS } from '../rules';
import { offerWatermarkStrings } from '../strings';
import type { WatermarkPosition } from '../types';

const t = offerWatermarkStrings.position;

/** Célula de cada posição numa grade 3 × 3 (os 4 cantos e o centro). */
const CELL: Record<WatermarkPosition, { row: number; col: number }> = {
  TOP_LEFT: { row: 1, col: 1 },
  TOP_RIGHT: { row: 1, col: 3 },
  CENTER: { row: 2, col: 2 },
  BOTTOM_LEFT: { row: 3, col: 1 },
  BOTTOM_RIGHT: { row: 3, col: 3 },
};

interface Props {
  value: WatermarkPosition;
  onChange: (value: WatermarkPosition) => void;
  disabled?: boolean;
  labelledBy: string;
}

/**
 * Grade de 5 posições como radiogroup (WAI-ARIA): setas circulam, Home/End vão às pontas, só a escolhida
 * entra no Tab. Cada alvo tem 44 px e tooltip com o nome da posição.
 */
export function PositionPicker({ value, onChange, disabled, labelledBy }: Props) {
  const refs = useRef<Partial<Record<WatermarkPosition, HTMLButtonElement | null>>>({});

  const onKey = (e: KeyboardEvent) => {
    const n = WATERMARK_POSITIONS.length;
    const i = WATERMARK_POSITIONS.indexOf(value);
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? WATERMARK_POSITIONS[(i + 1) % n]
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? WATERMARK_POSITIONS[(i - 1 + n) % n]
        : e.key === 'Home' ? WATERMARK_POSITIONS[0]
          : e.key === 'End' ? WATERMARK_POSITIONS[n - 1]
            : null;
    if (!next || disabled) return;
    e.preventDefault();
    onChange(next);
    refs.current[next]?.focus();
  };

  return (
    <Box
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-disabled={disabled || undefined}
      onKeyDown={onKey}
      sx={(theme) => ({
        display: 'grid', gridTemplateColumns: 'repeat(3, 44px)', gridTemplateRows: 'repeat(3, 44px)', gap: 0.75, p: 1,
        width: 'fit-content', borderRadius: 2, border: '1px solid', borderColor: 'divider',
        bgcolor: alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.04 : 0.02),
      })}
    >
      {WATERMARK_POSITIONS.map((pos) => {
        const checked = pos === value;
        return (
          <Tooltip key={pos} title={t.options[pos]} arrow describeChild>
            {/* span: o tooltip segue funcionando com o botão desabilitado (somente leitura) */}
            <Box component="span" sx={{ gridRow: CELL[pos].row, gridColumn: CELL[pos].col, display: 'flex' }}>
              <ButtonBase
                ref={(el) => { refs.current[pos] = el; }}
                role="radio"
                aria-checked={checked}
                aria-label={t.options[pos]}
                tabIndex={checked ? 0 : -1}
                disabled={disabled}
                onClick={() => onChange(pos)}
                sx={(theme) => ({
                  flex: 1, borderRadius: 1.5,
                  border: '1.5px solid', borderColor: checked ? 'primary.main' : 'divider',
                  bgcolor: checked ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.22 : 0.12) : 'background.paper',
                  transition: 'background-color 150ms, border-color 150ms',
                  '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                  '&:hover': { borderColor: 'primary.main' },
                  '&.Mui-focusVisible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
                  '&.Mui-disabled': { opacity: 0.6 },
                })}
              >
                <Box
                  aria-hidden
                  sx={{ width: 14, height: 14, borderRadius: 0.75, bgcolor: checked ? 'primary.main' : 'text.disabled' }}
                />
              </ButtonBase>
            </Box>
          </Tooltip>
        );
      })}
    </Box>
  );
}
