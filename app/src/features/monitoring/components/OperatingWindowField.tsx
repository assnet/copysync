import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Clock, Info, Moon } from 'lucide-react';
import { AppIcon, RangeSlider, ToggleOption } from '@/components';
import { formatDuration, monitoringStrings } from '../strings';
import { glassPillSx, toneText } from '../monitoringStyle';
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
 * Resumo numa pílula de vidro (relógio de dia, lua de noite); a regra completa fica no tooltip.
 */
export function OperatingWindowField({ value, onChange, disabled }: Props) {
  const theme = useTheme();
  const valid = isWindowValid(value);
  const full = isFullDay(value);
  const { start, end } = windowBounds(value);
  const duration = formatDuration(activeMinutes(value));
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
          ...glassPillSx(theme),
          gap: 1,
          px: 1.75,
          py: 0.875,
          mb: 2.5,
          maxWidth: '100%',
          whiteSpace: 'normal',
          color: valid ? 'text.primary' : toneText(theme, 'error'),
          borderColor: valid ? undefined : 'error.main',
        }}
      >
        <Box component="span" sx={{ display: 'inline-flex', color: valid ? 'primary.main' : 'inherit' }}>
          <AppIcon icon={value.overnight ? Moon : Clock} size="md" />
        </Box>
        <Typography component="span" variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.3, fontVariantNumeric: 'tabular-nums', color: 'inherit' }}>
          {summary}
        </Typography>
      </Box>

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

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, mt: 0.75, mb: 1.5 }}>
        <Typography variant="caption" component="p" sx={{ color: valid ? 'text.secondary' : toneText(theme, 'error') }}>
          {valid ? t.windowHelpShort : t.windowEmpty}
        </Typography>
        <Tooltip title={t.windowHelp} describeChild arrow enterTouchDelay={0} leaveTouchDelay={4000}>
          <IconButton size="small" aria-label={t.windowHelpAria} sx={{ color: 'text.secondary', flexShrink: 0 }}>
            <AppIcon icon={Info} size="sm" />
          </IconButton>
        </Tooltip>
      </Box>

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
