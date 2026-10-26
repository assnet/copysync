import { Chip, Tooltip } from '@mui/material';
import BoltOutlinedIcon from '@mui/icons-material/BoltOutlined';
import type { OfferUsage } from '@/types/api.types';
import { offerStrings } from '../strings';

const t = offerStrings.usage;

/** Ofertas geradas hoje × limite do plano. Plano ilimitado (ou uso indisponível) não mostra nada. */
export function OfferUsageChip({ usage }: { usage: OfferUsage | null }) {
  if (!usage || usage.limit == null) return null;
  const remaining = Math.max(usage.limit - usage.used, 0);
  const color = remaining === 0 ? 'error' : remaining <= Math.ceil(usage.limit * 0.2) ? 'warning' : 'default';
  return (
    <Tooltip title={t.tooltip(remaining)} arrow>
      <Chip
        size="small"
        variant="outlined"
        color={color}
        icon={<BoltOutlinedIcon />}
        label={t.chip(usage.used, usage.limit)}
        aria-label={t.ariaLabel(usage.used, usage.limit)}
        role="status"
        tabIndex={0}
      />
    </Tooltip>
  );
}
