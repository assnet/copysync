import { Box, Tooltip, Typography } from '@mui/material';
import { Filter } from 'lucide-react';
import { AppIcon } from '@/components';
import { offerHunterStrings as t } from '../strings';
import { rejectionSummary } from '../runRejections';
import type { HuntRejectionCounts } from '../types';

/** Por que "0 no filtro": quantos cada filtro barrou + dica. Execução sem `rejectedBy` não mostra nada. */
export function RejectionNote({ rejectedBy, matchedCount }: { rejectedBy: HuntRejectionCounts | null | undefined; matchedCount: number }) {
  const summary = rejectionSummary(rejectedBy, matchedCount);
  if (!summary) return null;
  return (
    <Box data-testid="hunt-rejections" sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-start', color: matchedCount === 0 ? 'warning.main' : 'text.secondary' }}>
      <Box component="span" sx={{ display: 'inline-flex', mt: '2px' }}><AppIcon icon={Filter} size="inline" /></Box>
      <Box sx={{ minWidth: 0 }}>
        <Tooltip title={t.rejections.tooltip} arrow describeChild enterTouchDelay={0} leaveTouchDelay={4000}>
          <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{summary.line}</Typography>
        </Tooltip>
        {summary.hint && <Typography variant="caption" color="text.secondary" component="p">{t.rejections.hint}</Typography>}
      </Box>
    </Box>
  );
}
