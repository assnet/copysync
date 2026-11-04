import { Box, Chip } from '@mui/material';
import { ChannelLogo } from '@/features/sessions/components/ChannelLogo';
import type { LimitChannel } from '@/types/api.types';

interface Props {
  /** Canais exibidos, na ordem (só os que têm sessão na tela). */
  channels: readonly LimitChannel[];
  count: Record<LimitChannel, number>;
  limits: Record<LimitChannel, number | null>;
  label: (channel: LimitChannel, n: number, limit: number | null) => string;
  ariaLabel: (channel: LimitChannel, n: number, limit: number | null) => string;
}

/** Contadores "WhatsApp 1/1 · Telegram 0/1" com o logo de cada canal; aviso no limite. */
export function ChannelCounterChips({ channels, count, limits, label, ariaLabel }: Props) {
  return (
    <Box role="status" aria-live="polite" aria-atomic="true" sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
      {channels.map((ch) => {
        const n = count[ch];
        const limit = limits[ch];
        const full = limit != null && n >= limit;
        return (
          <Chip
            key={ch}
            icon={<ChannelLogo channel={ch} size="sm" />}
            aria-label={ariaLabel(ch, n, limit)}
            color={limit != null && n > limit ? 'error' : full ? 'warning' : n > 0 ? 'primary' : 'default'}
            variant={n > 0 ? 'filled' : 'outlined'}
            label={label(ch, n, limit)}
            sx={{
              fontWeight: 600, fontVariantNumeric: 'tabular-nums',
              // Logo em fundo cheio: chip colorido usa a cor do texto para não sumir
              '& .MuiChip-icon': { ml: 0.75, ...(n > 0 && { '& span': { color: 'inherit' } }) },
            }}
          />
        );
      })}
    </Box>
  );
}
