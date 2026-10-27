import { Box, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { Clock, MoonStar } from 'lucide-react';
import { AppIcon, RangeSlider, ToggleOption } from '@/components';
import { formatDuration, monitoringStrings } from '../strings';
import {
  DAY_MINUTES, WINDOW_MARKS, WINDOW_STEP, activeMinutes, formatMinuteOfDay, isFullDay, isWindowValid, windowBounds,
  type OperatingWindow,
} from '../utils/operatingWindow';

const t = monitoringStrings.form;

/** Ao ligar a noturna a partir do dia inteiro: 22:00 → 06:00. */
const OVERNIGHT_DEFAULT = { lo: 360, hi: 1320 };

interface Props {
  value: OperatingWindow;
  onChange: (value: OperatingWindow) => void;
  disabled?: boolean;
}

/**
 * Janela de operação só por slider (00:00–24:00, passo 15 min). O slider sempre recebe `lo <= hi`;
 * com a noturna ligada a janela ativa é o complemento — a faixa colorida inverte para mostrar isso.
 */
export function OperatingWindowField({ value, onChange, disabled }: Props) {
  const theme = useTheme();
  const valid = isWindowValid(value);
  const full = isFullDay(value);
  const { start, end } = windowBounds(value);
  const duration = formatDuration(activeMinutes(value));
  const accent = valid ? theme.palette.primary.main : theme.palette.error.main;
  const summary = full ? t.windowFullDay : t.windowRange(formatMinuteOfDay(start), formatMinuteOfDay(end), duration);
  const summaryAria = full ? t.windowFullDay : t.windowRangeAria(formatMinuteOfDay(start), formatMinuteOfDay(end), duration);

  const toggleOvernight = (overnight: boolean) => {
    if (overnight && full) onChange({ ...OVERNIGHT_DEFAULT, overnight });
    else onChange({ ...value, overnight });
  };

  return (
    <Box>
      <Box
        role="status"
        aria-live="polite"
        aria-label={summaryAria}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          px: 2,
          py: 1.25,
          mb: 2,
          borderRadius: 2,
          color: accent,
          backgroundColor: alpha(accent, theme.palette.mode === 'dark' ? 0.16 : 0.08),
          border: '1px solid',
          borderColor: alpha(accent, 0.35),
        }}
      >
        <AppIcon icon={value.overnight ? MoonStar : Clock} size="md" />
        <Typography component="span" sx={{ fontWeight: 700, fontSize: { xs: 16, sm: 18 }, fontVariantNumeric: 'tabular-nums', color: 'inherit' }}>
          {summary}
        </Typography>
      </Box>

      <Box>
        <RangeSlider
          value={[value.lo, value.hi]}
          onChange={([lo, hi]) => onChange({ ...value, lo, hi })}
          min={0}
          max={DAY_MINUTES}
          step={WINDOW_STEP}
          minDistance={WINDOW_STEP}
          ariaLabel={t.windowAria}
          minLabel={value.overnight ? t.windowEnd : t.windowStart}
          maxLabel={value.overnight ? t.windowStart : t.windowEnd}
          formatValue={formatMinuteOfDay}
          marks={WINDOW_MARKS}
          disabled={disabled}
          error={!valid}
          inverted={value.overnight}
        />
      </Box>
      <Typography variant="caption" color={valid ? 'text.secondary' : 'error'} component="p" sx={{ mt: 1, mb: 1.5 }}>
        {valid ? t.windowHelp : t.windowEmpty}
      </Typography>

      <ToggleOption
        checked={value.overnight}
        onChange={toggleOvernight}
        title={t.windowOvernight}
        description={t.windowOvernightHelp}
        disabled={disabled}
      />
    </Box>
  );
}
