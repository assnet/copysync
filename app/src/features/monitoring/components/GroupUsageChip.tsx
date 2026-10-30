import { Box, Tooltip, useTheme } from '@mui/material';
import { focusRingSx, glassPillSx, toneMain, type MonitorTone } from '../monitoringStyle';
import { monitoringStrings } from '../strings';

const t = monitoringStrings.groups;

/** Pílula "n/max no plano" do plano (todas as sessões somadas) com mini barra de uso; aviso a 80 %, erro no limite. */
export function GroupUsageChip({ used, max }: { used: number; max: number | null }) {
  const theme = useTheme();
  const ratio = max === null || max <= 0 ? 0 : Math.min(1, used / max);
  const tone: MonitorTone = max === null ? 'neutral' : used >= max ? 'error' : ratio >= 0.8 ? 'warning' : 'primary';
  return (
    <Tooltip title={t.usageTooltip(used, max)} arrow describeChild enterTouchDelay={0} leaveTouchDelay={4000}>
      <Box
        component="span"
        tabIndex={0}
        role="img"
        aria-label={monitoringStrings.usage.aria(used, max)}
        sx={{
          ...glassPillSx(theme),
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: 0.5,
          py: 0.5,
          minWidth: 56,
          color: tone === 'error' ? 'error.main' : 'text.primary',
          ...focusRingSx(theme),
        }}
      >
        <Box component="span" aria-hidden sx={{ textAlign: 'center', lineHeight: 1.2 }}>{t.usage(used, max)}</Box>
        {max !== null && (
          <Box component="span" aria-hidden sx={{ display: 'block', height: 4, borderRadius: 2, bgcolor: 'action.hover', overflow: 'hidden' }}>
            <Box component="span" sx={{ display: 'block', height: '100%', width: `${Math.round(ratio * 100)}%`, borderRadius: 2, bgcolor: toneMain(theme, tone) }} />
          </Box>
        )}
      </Box>
    </Tooltip>
  );
}
