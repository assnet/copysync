import { Chip, Tooltip } from '@mui/material';
import { monitoringStrings } from '../strings';

const t = monitoringStrings.groups;

/** "n/max" do plano (todas as sessões somadas); vermelho quando chega no limite. */
export function GroupUsageChip({ used, max }: { used: number; max: number | null }) {
  const atLimit = max !== null && used >= max;
  return (
    <Tooltip title={t.usageTooltip(used, max)} arrow>
      <Chip
        size="small"
        variant="outlined"
        color={atLimit ? 'error' : 'default'}
        label={t.usage(used, max)}
        sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
      />
    </Tooltip>
  );
}
