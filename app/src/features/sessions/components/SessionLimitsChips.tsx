import { Box, Chip, Tooltip } from '@mui/material';
import { AppIcon } from '@/components';
import type { SessionLimitsResponse } from '@/types/api.types';
import { sessionStrings } from '../strings';
import type { SessionChannel } from '../utils';
import { CHANNEL_ICON, channelLabel } from './SessionChannelChip';

const t = sessionStrings.channel;

/** Contadores "WhatsApp 1/1" e "Telegram 0/1" do cabeçalho, com tooltip do limite do plano. */
export function SessionLimitsChips({ limits }: { limits: SessionLimitsResponse | null }) {
  if (!limits) return null;
  const items: { channel: SessionChannel; used: number; limit: number | null; unavailable?: boolean }[] = [
    { channel: 'whatsapp', used: limits.whatsapp.used, limit: limits.whatsapp.limit },
    { channel: 'telegram', used: limits.telegram.used, limit: limits.telegram.limit, unavailable: !limits.telegram.enabled },
  ];
  return (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
      {items.map(({ channel, used, limit, unavailable }) => {
        const full = limit !== null && used >= limit;
        const name = channelLabel(channel);
        return (
          <Tooltip key={channel} title={unavailable ? sessionStrings.picker.unavailableTooltip : t.counterTooltip(name, used, limit)}>
            <Chip
              size="small"
              variant="outlined"
              color={unavailable ? 'default' : full ? 'warning' : 'default'}
              icon={<AppIcon icon={CHANNEL_ICON[channel]} size="sm" />}
              label={unavailable ? `${name} · ${sessionStrings.picker.unavailable}` : `${name} ${t.counter(used, limit)}`}
              sx={{ fontVariantNumeric: 'tabular-nums', opacity: unavailable ? 0.7 : 1, '& .MuiChip-icon': { ml: 0.75 } }}
            />
          </Tooltip>
        );
      })}
    </Box>
  );
}
