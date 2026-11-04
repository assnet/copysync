import { Box, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Check, Smartphone } from 'lucide-react';
import { AppIcon } from '@/components';
import type { SessionChannel } from '../utils';
import { REDUCED_MOTION, brand, dashFlow, onBrand } from '../sessionWizardStyle';
import { CHANNEL_ICON } from './SessionChannelChip';

export type ChannelBridgeState = 'idle' | 'waiting' | 'done';

interface Props {
  channel: SessionChannel;
  /** idle = tracejado parado; waiting = tracejado fluindo; done = linha cheia com check. */
  state: ChannelBridgeState;
  size?: 'sm' | 'md';
}

const DIMS = {
  sm: { tile: 44, radius: '12px', line: 48 },
  md: { tile: 56, radius: '16px', line: 72 },
} as const;

/**
 * "Ponte" celular ↔ canal dos assistentes de sessão. Puramente decorativa (`aria-hidden`):
 * o estado é sempre dito em texto ao lado. Em reduced-motion o tracejado fica parado.
 */
export function ChannelBridge({ channel, state, size = 'md' }: Props) {
  const theme = useTheme();
  const { tile, radius, line } = DIMS[size];
  const color = brand(theme, channel);
  const tileSx = {
    width: tile, height: tile, borderRadius: radius, flexShrink: 0,
    display: 'grid', placeItems: 'center',
  } as const;
  const stroke = state === 'idle' ? theme.palette.text.disabled : color;

  return (
    <Box aria-hidden sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
      <Box sx={{ ...tileSx, bgcolor: 'action.hover', color: 'text.secondary' }}>
        <AppIcon icon={Smartphone} size="lg" />
      </Box>

      <Box sx={{ position: 'relative', width: line, height: 22, display: 'grid', placeItems: 'center' }}>
        <Box
          component="svg"
          width={line}
          height={4}
          viewBox={`0 0 ${line} 4`}
          sx={{
            display: 'block', overflow: 'visible',
            '& line': state === 'waiting'
              ? { animation: `${dashFlow} 1.2s linear infinite`, [REDUCED_MOTION]: { animation: 'none' } }
              : undefined,
          }}
        >
          <line
            x1={0} y1={2} x2={line} y2={2}
            stroke={stroke}
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray={state === 'done' ? undefined : '4 4'}
          />
        </Box>
        {state === 'done' && (
          <Box
            sx={{
              position: 'absolute', inset: 0, m: 'auto', width: 22, height: 22, borderRadius: '50%',
              display: 'grid', placeItems: 'center', bgcolor: color, color: onBrand(theme, channel),
              boxShadow: `0 0 0 3px ${theme.palette.background.paper}`,
            }}
          >
            <AppIcon icon={Check} size="sm" strokeWidth={3} />
          </Box>
        )}
      </Box>

      <Box sx={{ ...tileSx, bgcolor: alpha(color, 0.14), color }}>
        <AppIcon icon={CHANNEL_ICON[channel]} size="lg" />
      </Box>
    </Box>
  );
}
