import { Alert, Box, Button, Chip, CircularProgress, Stack, Typography } from '@mui/material';
import { History } from 'lucide-react';
import { AppIcon, EmptyState } from '@/components';
import type { HuntPagedList } from '../../hooks';
import type { HuntRun, OfferHuntRunStatus } from '../../types';
import { offerHunterStrings as t } from '../../strings';
import { formatDateTime } from '../../format';

const r = t.runs;
const d = t.detail;

const STATUS_COLOR: Record<OfferHuntRunStatus, 'default' | 'success' | 'error' | 'info'> = {
  RUNNING: 'info', SUCCEEDED: 'success', FAILED: 'error', SKIPPED: 'default',
};

/** Histórico de execuções por cursor: gatilho, estado, contadores, IA e horários. */
export function HuntRunsTab({ runs }: { runs: HuntPagedList<HuntRun> }) {
  if (runs.loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={28} /></Box>;
  if (runs.errorCode && runs.items.length === 0) {
    return <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void runs.reload()}>{t.page.retry}</Button>}>{d.listError}</Alert>;
  }
  if (runs.items.length === 0) return <EmptyState icon={<AppIcon icon={History} size="lg" />} title={r.emptyTitle} description={r.emptyHint} />;

  return (
    <Box>
      <Stack component="ul" aria-label={d.runsListLabel} spacing={1} sx={{ m: 0, p: 0, listStyle: 'none' }}>
        {runs.items.map((run) => {
          const started = formatDateTime(run.startedAt);
          const finished = formatDateTime(run.finishedAt);
          return (
            <Box component="li" key={run.id} data-testid="hunt-run" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                <Chip size="small" color={STATUS_COLOR[run.status]} variant={run.status === 'SUCCEEDED' ? 'outlined' : 'filled'} label={t.runStatus[run.status]} />
                <Chip size="small" variant="outlined" label={t.runTrigger[run.trigger]} />
                {run.aiUsed && !run.aiFallback && <Chip size="small" variant="outlined" color="primary" label={r.aiUsed} />}
                {run.aiFallback && <Chip size="small" variant="outlined" color="warning" label={r.aiFallback} />}
                <Typography variant="caption" color="text.secondary" sx={{ ml: { sm: 'auto' }, fontVariantNumeric: 'tabular-nums' }}>
                  {`${r.startedAt}: ${started ?? d.noValue} · ${r.finishedAt}: ${finished ?? d.stillRunning}`}
                </Typography>
              </Box>
              <Typography variant="body2" sx={{ mt: 1, fontVariantNumeric: 'tabular-nums' }}>
                {r.counts(run.seenCount, run.matchedCount, run.chosenCount, run.sentCount)}
              </Typography>
              {run.errorCode && (
                <Typography variant="caption" color="error" component="p" sx={{ mt: 0.5 }}>
                  {`${r.error}: ${t.errors[run.errorCode] ?? d.unknownError(run.errorCode)}`}
                </Typography>
              )}
            </Box>
          );
        })}
      </Stack>
      {runs.errorCode && <Alert severity="error" sx={{ mt: 1.5 }}>{d.loadMoreError}</Alert>}
      {runs.hasMore && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
          <Button onClick={() => void runs.loadMore()} disabled={runs.loadingMore}>
            {runs.loadingMore ? <CircularProgress size={18} /> : r.loadMore}
          </Button>
        </Box>
      )}
    </Box>
  );
}
