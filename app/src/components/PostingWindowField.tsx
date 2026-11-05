import { useId } from 'react';
import { Box, IconButton, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Clock, Info, Moon } from 'lucide-react';
import { AppIcon } from './AppIcon';
import { RangeSlider } from './RangeSlider';
import { ToggleOption } from './ToggleOption';
import { postingWindowStrings as t } from './postingWindowStrings';
import { glassPillSx, toneText } from '@/features/monitoring/monitoringStyle';
import {
  DAY_MINUTES, WEEKDAYS, WINDOW_MARKS, WINDOW_STEP, formatMinuteOfDay, isFullDay,
  isWindowValid, maskToWeekdays, weekdaysToMask, type OperatingWindow,
} from '@/features/monitoring/utils/operatingWindow';
import { postingWindowSummary } from './postingWindowSummary';

/** Ao ligar a noturna a partir do dia inteiro: 22:00 → 06:00. */
const OVERNIGHT_DEFAULT = { lo: 360, hi: 1320 };

/** Faixa do dia + dias da semana (`weekdaysMask`: bit 0 = domingo; 127 = todos). */
export interface PostingWindowValue {
  window: OperatingWindow;
  weekdaysMask: number;
}

export interface PostingWindowFieldProps {
  value: PostingWindowValue;
  onChange: (value: PostingWindowValue) => void;
  disabled?: boolean;
}

/**
 * Horário de postagem compartilhado (monitoramento e gerador): slider 00:00–24:00 (passo 15 min,
 * noturna = complemento) + chips de dias. Resumo numa pílula de vidro; a regra completa no tooltip.
 * O último dia marcado não sai (mask 0 é inválido).
 */
export function PostingWindowField({ value, onChange, disabled }: PostingWindowFieldProps) {
  const theme = useTheme();
  const daysLabelId = useId();
  const { window: win, weekdaysMask } = value;
  const valid = isWindowValid(win);
  const full = isFullDay(win);
  const { range, rangeAria, days } = postingWindowSummary(value);
  const selected = maskToWeekdays(weekdaysMask);
  const onlyOne = selected.length === 1;

  const setWindow = (next: OperatingWindow) => onChange({ ...value, window: next });
  const toggleOvernight = (overnight: boolean) => {
    if (overnight && full) setWindow({ ...OVERNIGHT_DEFAULT, overnight });
    else setWindow({ ...win, overnight });
  };
  const changeDays = (next: number[]) => {
    const mask = weekdaysToMask(next);
    if (mask > 0 && mask !== weekdaysMask) onChange({ ...value, weekdaysMask: mask });
  };

  return (
    <Box>
      <Box
        role="status"
        aria-live="polite"
        aria-label={`${rangeAria}. ${days}`}
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
          <AppIcon icon={win.overnight ? Moon : Clock} size="md" />
        </Box>
        <Typography component="span" variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.3, fontVariantNumeric: 'tabular-nums', color: 'inherit' }}>
          <Box component="span" sx={{ whiteSpace: 'nowrap' }}>{range}</Box>{' '}
          <Box component="span" sx={{ fontWeight: 500, color: valid ? 'text.secondary' : 'inherit', whiteSpace: 'nowrap' }}>{`· ${days}`}</Box>
        </Typography>
      </Box>

      <RangeSlider
        value={[win.lo, win.hi]}
        onChange={([lo, hi]) => setWindow({ ...win, lo, hi })}
        min={0}
        max={DAY_MINUTES}
        step={WINDOW_STEP}
        minDistance={WINDOW_STEP}
        ariaLabel={t.sliderAria}
        minLabel={win.overnight ? t.end : t.start}
        maxLabel={win.overnight ? t.start : t.end}
        formatValue={formatMinuteOfDay}
        marks={WINDOW_MARKS}
        disabled={disabled}
        error={!valid}
        inverted={win.overnight}
      />

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, mt: 0.75, mb: 1.5 }}>
        <Typography variant="caption" component="p" sx={{ color: valid ? 'text.secondary' : toneText(theme, 'error') }}>
          {valid ? t.helpShort : t.empty}
        </Typography>
        <Tooltip title={t.help} describeChild arrow enterTouchDelay={0} leaveTouchDelay={4000}>
          <IconButton size="small" aria-label={t.helpAria} sx={{ color: 'text.secondary', flexShrink: 0 }}>
            <AppIcon icon={Info} size="sm" />
          </IconButton>
        </Tooltip>
      </Box>

      <ToggleOption
        checked={win.overnight}
        onChange={toggleOvernight}
        title={t.overnight}
        description={t.overnightHelp}
        disabled={disabled}
      />

      <Typography id={daysLabelId} variant="subtitle2" component="p" sx={{ fontWeight: 600, mt: 2, mb: 0.75 }}>
        {t.daysLabel}
      </Typography>
      <ToggleButtonGroup
        fullWidth
        size="small"
        color="primary"
        value={selected}
        disabled={disabled}
        onChange={(_, next: number[]) => changeDays(next)}
        aria-labelledby={daysLabelId}
        sx={{ '& .MuiToggleButton-root': { textTransform: 'none', fontWeight: 600, px: 0, py: 0.75, minWidth: 0 } }}
      >
        {WEEKDAYS.map((day) => {
          const last = onlyOne && selected[0] === day;
          return (
            <Tooltip key={day} title={last ? t.dayLastTooltip : t.dayFull(day)} describeChild arrow enterTouchDelay={0} leaveTouchDelay={3000}>
              <ToggleButton value={day} aria-label={t.dayFull(day)}>
                {t.dayShort(day)}
              </ToggleButton>
            </Tooltip>
          );
        })}
      </ToggleButtonGroup>
    </Box>
  );
}
