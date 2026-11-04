import { Box, Tooltip, useTheme } from '@mui/material';
import { ChannelLogo } from '@/features/sessions/components/ChannelLogo';
import { channelLabel } from '@/features/sessions/components/SessionChannelChip';
import type { SessionChannel } from '@/features/sessions/utils';
import { focusRingSx, glassPillSx, toneMain, type MonitorTone } from '../monitoringStyle';
import { monitoringStrings } from '../strings';

const t = monitoringStrings.groups;

export interface ChannelUsageItem {
  channel: SessionChannel;
  used: number;
  max: number | null;
}

/**
 * Pílula "n/max no plano" (todas as sessões somadas) com mini barra de uso; aviso a 80 %, erro no
 * limite. Com `channel`, mostra o logo do canal e o uso só daquele canal.
 */
export function GroupUsageChip({ used, max, channel }: { used: number; max: number | null; channel?: SessionChannel }) {
  const theme = useTheme();
  const ratio = max === null || max <= 0 ? 0 : Math.min(1, used / max);
  const tone: MonitorTone = max === null ? 'neutral' : used >= max ? 'error' : ratio >= 0.8 ? 'warning' : 'primary';
  const name = channel ? channelLabel(channel) : null;
  return (
    <Tooltip title={name ? t.channelUsageTooltip(name, used, max) : t.usageTooltip(used, max)} arrow describeChild enterTouchDelay={0} leaveTouchDelay={4000}>
      <Box
        component="span"
        tabIndex={0}
        role="img"
        aria-label={name ? monitoringStrings.usage.channelAria(name, used, max) : monitoringStrings.usage.aria(used, max)}
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
        <Box component="span" aria-hidden sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>
          {channel && <ChannelLogo channel={channel} />}
          {channel ? t.channelUsage(used, max) : t.usage(used, max)}
        </Box>
        {max !== null && (
          <Box component="span" aria-hidden sx={{ display: 'block', height: 4, borderRadius: 2, bgcolor: 'action.hover', overflow: 'hidden' }}>
            <Box component="span" sx={{ display: 'block', height: '100%', width: `${Math.round(ratio * 100)}%`, borderRadius: 2, bgcolor: toneMain(theme, tone) }} />
          </Box>
        )}
      </Box>
    </Tooltip>
  );
}

/** Uma pílula por canal ("WhatsApp 3/10 · Telegram 1/10"), lado a lado. */
export function ChannelUsageChips({ items }: { items: readonly ChannelUsageItem[] }) {
  return (
    <Box role="group" aria-label={monitoringStrings.usage.groupAria} sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {items.map((it) => <GroupUsageChip key={it.channel} used={it.used} max={it.max} channel={it.channel} />)}
    </Box>
  );
}
