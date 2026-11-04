import { Chip, Stack, Tooltip } from '@mui/material';
import { ChannelLogo } from '@/features/sessions/components/ChannelLogo';
import { channelLabel } from '@/features/sessions/components/SessionChannelChip';
import { ROTATION_CHANNELS, createLockOf, planUnlockingChannel } from '../channelLimits';
import { linkRotationStrings } from '../strings';
import type { RotationOverview } from '../types';

const t = linkRotationStrings.page;

/**
 * Uso do plano por canal no cabeçalho ("WhatsApp 1/1 · Telegram 0/1"), cada um com o logo do canal.
 * Canal sem vaga fica em destaque; canal fora do plano diz a partir de qual plano ele é liberado.
 */
export function RotationChannelUsage({ overview }: { overview: RotationOverview }) {
  return (
    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" role="list" aria-label={t.channelUsageGroupAria}>
      {ROTATION_CHANNELS.map((channel) => {
        const name = channelLabel(channel);
        const limit = overview.limits[channel].rotations;
        const used = overview.usage[channel].rotations;
        const lock = createLockOf(overview, channel);
        const noPlan = lock?.reason === 'noPlan';
        const plan = lock ? planUnlockingChannel(lock) : null;
        const label = noPlan ? t.channelUnavailable(name, plan) : t.channelUsage(name, used, limit);
        const tooltip = noPlan ? t.channelUnavailableTooltip(name, plan) : t.channelUsageTooltip;
        return (
          <Tooltip key={channel} title={tooltip} arrow describeChild>
            <Chip
              role="listitem"
              size="small"
              variant="outlined"
              tabIndex={0}
              data-testid={`rotation-usage-${channel}`}
              color={lock && !noPlan ? 'warning' : 'default'}
              icon={<ChannelLogo channel={channel} size="sm" />}
              label={label}
              aria-label={noPlan ? label : t.channelUsageAria(name, used, limit)}
              sx={{ fontVariantNumeric: 'tabular-nums', pl: 0.5, ...(noPlan && { color: 'text.secondary', borderStyle: 'dashed' }) }}
            />
          </Tooltip>
        );
      })}
    </Stack>
  );
}
