import { Box, LinearProgress, Paper, Skeleton, Stack, Tooltip, Typography } from '@mui/material';
import { Info } from 'lucide-react';
import { AppIcon } from '@/components';
import { offerHunterStrings } from '../../strings';
import type { HuntUsage } from '../../types';

const t = offerHunterStrings.usage;

export interface HuntUsageBarProps {
  usage: HuntUsage | null;
  loading: boolean;
  failed: boolean;
}

/** "X de N ofertas garimpadas hoje" (N do entitlement, vindo da API) e as buscas do dia em texto secundário. */
export function HuntUsageBar({ usage, loading, failed }: HuntUsageBarProps) {
  if (!usage) {
    return (
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        {loading ? (
          <Stack spacing={1} role="status" aria-label={t.title}>
            <Skeleton width="45%" />
            <Skeleton variant="rounded" height={8} />
          </Stack>
        ) : (
          failed && <Typography variant="body2" color="text.secondary">{t.loadError}</Typography>
        )}
      </Paper>
    );
  }
  const pct = usage.limit > 0 ? Math.min(100, (usage.used / usage.limit) * 100) : 0;
  const full = usage.remaining <= 0;
  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} flexWrap="wrap" useFlexGap>
        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" fontWeight={700}>{t.finds(usage.used, usage.limit)}</Typography>
          <Tooltip title={`${t.tooltip} ${t.resetHint}`} describeChild enterTouchDelay={0}>
            <Box component="span" tabIndex={0} aria-label={t.tooltip} sx={{ display: 'inline-flex', color: 'text.disabled', cursor: 'help', borderRadius: 1 }}>
              <AppIcon icon={Info} size="sm" />
            </Box>
          </Tooltip>
        </Stack>
        <Typography variant="caption" fontWeight={600} color={full ? 'warning.main' : 'text.secondary'}>
          {t.remaining(Math.max(0, usage.remaining))}
        </Typography>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={pct}
        color={full ? 'warning' : 'primary'}
        aria-label={t.ariaLabel(usage.used, usage.limit)}
        sx={{ my: 1, height: 8, borderRadius: 4 }}
      />
      <Typography variant="caption" color="text.secondary">{t.runs(usage.runsToday, usage.runsMax)}</Typography>
    </Paper>
  );
}
