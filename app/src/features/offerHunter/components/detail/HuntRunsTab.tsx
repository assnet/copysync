import { Alert, Box, Button, Chip, CircularProgress, Collapse, Stack, Typography } from '@mui/material';
import { ChevronDown, ChevronUp, History } from 'lucide-react';
import { AppIcon, EmptyState } from '@/components';
import { useEffect } from 'react';
import type { HuntPagedList, RunRankings } from '../../hooks';
import type { HuntRun, OfferHuntRunStatus } from '../../types';
import { offerHunterStrings as t } from '../../strings';
import { formatDateTime } from '../../format';
import { RejectionNote } from '../RejectionNote';
import { RankingTable } from '../RankingTable';

const r = t.runs;
const d = t.detail;

const STATUS_COLOR: Record<OfferHuntRunStatus, 'default' | 'success' | 'error' | 'info'> = {
  RUNNING: 'info', SUCCEEDED: 'success', FAILED: 'error', SKIPPED: 'default',
};

interface Props {
  runs: HuntPagedList<HuntRun>;
  /** Execução com o ranking aberto (persistido pela página). */
  openRunId: string | null;
  onToggleRun: (runId: string) => void;
  /** Ranking sob demanda (cache por execução na página). */
  rankings: RunRankings;
}

/** Conteúdo do ranking aberto: busca ao montar (Collapse com `unmountOnExit`), com carregando e erro com retry. */
function RunRankingPanel({ run, rankings }: { run: HuntRun; rankings: RunRankings }) {
  const inline = run.ranking !== undefined ? run.ranking : undefined;
  const need = inline === undefined && run.hasRanking;
  useEffect(() => { if (need) rankings.load(run.id); }, [need, rankings, run.id]);
  if (inline) return <RankingTable items={inline} />;
  if (!need) return <Typography variant="body2" color="text.secondary">{r.rankingMissing}</Typography>;
  const entry = rankings.get(run.id);
  if (!entry || entry.state === 'loading') {
    return (
      <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
        <CircularProgress size={18} aria-hidden />
        <Typography variant="body2" color="text.secondary">{r.rankingLoading}</Typography>
      </Box>
    );
  }
  if (entry.state === 'error') {
    return (
      <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => rankings.retry(run.id)}>{t.page.retry}</Button>}>
        {r.rankingError}
      </Alert>
    );
  }
  return entry.items ? <RankingTable items={entry.items} /> : <Typography variant="body2" color="text.secondary">{r.rankingMissing}</Typography>;
}

/** Histórico de execuções por cursor: gatilho, estado, contadores, recusas por filtro, IA, horários e ranking guardado. */
export function HuntRunsTab({ runs, openRunId, onToggleRun, rankings }: Props) {
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
          const open = openRunId === run.id;
          const rankingId = `run-${run.id}-ranking`;
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
              <Box sx={{ mt: 0.5 }}><RejectionNote rejectedBy={run.rejectedBy} matchedCount={run.matchedCount} provider={run.provider} /></Box>
              {run.errorCode && (
                <Typography variant="caption" color="error" component="p" sx={{ mt: 0.5 }}>
                  {`${r.error}: ${t.errors[run.errorCode] ?? d.unknownError(run.errorCode)}`}
                </Typography>
              )}
              {run.status === 'RUNNING' && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} data-testid="hunt-run-running">{r.running}</Typography>
              )}
              {run.status !== 'SKIPPED' && run.status !== 'RUNNING' && (
                <>
                  <Button
                    size="small"
                    color="inherit"
                    onClick={() => onToggleRun(run.id)}
                    aria-expanded={open}
                    aria-controls={rankingId}
                    endIcon={<AppIcon icon={open ? ChevronUp : ChevronDown} size="sm" />}
                    sx={{ mt: 0.5, ml: -0.5 }}
                  >
                    {open ? r.hideRanking : r.showRanking}
                  </Button>
                  <Collapse in={open} unmountOnExit>
                    <Box id={rankingId} sx={{ mt: 1 }}>
                      <RunRankingPanel run={run} rankings={rankings} />
                    </Box>
                  </Collapse>
                </>
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
