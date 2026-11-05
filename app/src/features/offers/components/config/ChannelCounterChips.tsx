import { Box, Chip, Link, Tooltip, useTheme } from '@mui/material';
import { brandColor } from '@/components';
import { Link as RouterLink, useInRouterContext } from 'react-router-dom';
import { ChannelLogo } from '@/features/sessions/components/ChannelLogo';
import type { LimitChannel } from '@/types/api.types';
import { offerStrings } from '../../strings';

const hint = offerStrings.wizard.groups.sharedLimit;
const BROADCAST_GROUPS_PATH = '/broadcast-groups';

interface Props {
  /** Canais exibidos, na ordem (só os que têm sessão na tela). */
  channels: readonly LimitChannel[];
  count: Record<LimitChannel, number>;
  limits: Record<LimitChannel, number | null>;
  label: (channel: LimitChannel, n: number, limit: number | null) => string;
  ariaLabel: (channel: LimitChannel, n: number, limit: number | null) => string;
  /** Chips de grupos: dica de que o limite soma gerador e monitoramento, com link para a tela. */
  sharedLimitHint?: boolean;
}

/** Texto da dica + link para `/broadcast-groups` (SPA quando há roteador). */
function SharedLimitTooltip() {
  const inRouter = useInRouterContext();
  const linkProps = inRouter ? { component: RouterLink, to: BROADCAST_GROUPS_PATH } : { href: BROADCAST_GROUPS_PATH };
  return (
    <Box component="span" sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <span>{hint.tooltip}</span>
      <Link {...linkProps} color="inherit" underline="always" sx={{ fontWeight: 600 }}>{hint.link}</Link>
    </Box>
  );
}

/** Contadores "WhatsApp 1/1 · Telegram 0/1" com o logo de cada canal; aviso no limite. */
export function ChannelCounterChips({ channels, count, limits, label, ariaLabel, sharedLimitHint = false }: Props) {
  const { palette } = useTheme();
  return (
    <Box role="status" aria-live="polite" aria-atomic="true" sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
      {channels.map((ch) => {
        const n = count[ch];
        const limit = limits[ch];
        const full = limit != null && n >= limit;
        const chip = (
          <Chip
            key={ch}
            tabIndex={sharedLimitHint ? 0 : undefined}
            icon={<ChannelLogo channel={ch} size="sm" />}
            aria-label={ariaLabel(ch, n, limit)}
            color={limit != null && n > limit ? 'error' : full ? 'warning' : n > 0 ? 'primary' : 'default'}
            variant={n > 0 ? 'filled' : 'outlined'}
            label={label(ch, n, limit)}
            sx={{
              fontWeight: 600, fontVariantNumeric: 'tabular-nums',
              // Logo em fundo cheio usa a cor do texto para não sumir; contorno mantém a cor da marca
              '& .MuiChip-icon': { ml: 0.75, color: n > 0 ? 'inherit' : brandColor(ch, palette.mode) },
            }}
          />
        );
        return sharedLimitHint ? (
          <Tooltip key={ch} title={<SharedLimitTooltip />} arrow describeChild enterTouchDelay={0} leaveTouchDelay={4000}>
            {chip}
          </Tooltip>
        ) : chip;
      })}
    </Box>
  );
}
