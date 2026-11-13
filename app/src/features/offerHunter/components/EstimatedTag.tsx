import { Chip, Tooltip } from '@mui/material';
import { offerHunterStrings as t } from '../strings';

/** Selo "estimada" na comissão calculada pelo percentual da loja (ML), com a explicação no Tooltip. */
export function EstimatedTag() {
  return (
    <Tooltip title={t.finds.estimatedTip} arrow describeChild enterTouchDelay={0} leaveTouchDelay={4000}>
      <Chip size="small" variant="outlined" label={t.finds.estimated} tabIndex={0} data-testid="commission-estimated" sx={{ height: 18, fontSize: '0.6875rem', fontWeight: 600 }} />
    </Tooltip>
  );
}
