import { useState } from 'react';
import {
  Box, IconButton, LinearProgress, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip,
  Typography, useMediaQuery, useTheme,
} from '@mui/material';
import { Copy, DatabaseZap } from 'lucide-react';
import { AppIcon, EmptyState, OverflowTooltipText, SectionCard } from '@/components';
import { formatDuration, querySharePct, shortQueryId } from '../rules';
import { opsMetricsStrings as t } from '../strings';
import type { OpsTopQuery } from '../types';
import { HelpTip } from './HelpTip';

const MAX_ROWS = 10;
const mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/**
 * Só a forma normalizada (`shape`) do pg_stat_statements: sem valores de cliente, por isso sem
 * flag de borrar (decisão no design da aba Consumo). Nunca exibir outro campo de texto da consulta.
 */
function CopyIdButton({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Tooltip title={copied ? t.queries.copied : t.queries.copyId}>
      <IconButton size="small" aria-label={t.queries.copyId} onClick={() => void copy()}>
        <AppIcon icon={Copy} size="sm" />
      </IconButton>
    </Tooltip>
  );
}

function ShareBar({ pct }: { pct: number }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 120 }}>
      <LinearProgress
        variant="determinate"
        value={pct}
        aria-label={t.queries.shareAria(pct)}
        sx={{ height: 6, borderRadius: 3, flex: 1 }}
      />
      <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', minWidth: 36, textAlign: 'right' }}>{pct}%</Typography>
    </Stack>
  );
}

interface Props {
  queries: OpsTopQuery[];
  snapshotLabel?: string;
}

export function TopQueriesTable({ queries, snapshotLabel }: Props) {
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('sm'));
  const rows = [...queries].sort((a, b) => b.totalMs - a.totalMs).slice(0, MAX_ROWS);
  const shares = querySharePct(rows);


  return (
    <SectionCard
      title={t.queries.title}
      subtitle={snapshotLabel ? `${t.queries.subtitle} ${snapshotLabel}.` : t.queries.subtitle}
      action={<HelpTip label={t.queries.title} text={t.help.db_statement_total_ms} />}
      noPadding={rows.length > 0}
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<AppIcon icon={DatabaseZap} size="lg" />}
          title={t.queries.empty}
          description={t.queries.emptyHint}
          sx={{ py: 4 }}
        />
      ) : compact ? (
        <Stack divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}>
          {rows.map((q, i) => (
            <Box key={q.queryid} sx={{ px: 2, py: 1.5 }}>
              <Typography
                variant="body2"
                sx={{
                  fontFamily: mono, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  overflow: 'hidden', wordBreak: 'break-all',
                }}
              >
                <Box component="span" sx={{ color: 'text.secondary', mr: 1 }}>{i + 1}</Box>
                {q.shape ?? '—'}
              </Typography>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mt: 0.75 }}>
                <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  {formatDuration(q.totalMs)}
                </Typography>
                <Box sx={{ flex: 1 }}><ShareBar pct={shares[i]} /></Box>
                <CopyIdButton id={q.queryid} />
              </Stack>
            </Box>
          ))}
        </Stack>
      ) : (
        <TableContainer>
          <Table size="small" aria-label={t.queries.title}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 40 }}>{t.queries.cols.rank}</TableCell>
                <TableCell>{t.queries.cols.shape}</TableCell>
                <TableCell align="right">{t.queries.cols.total}</TableCell>
                <TableCell>{t.queries.cols.share}</TableCell>
                <TableCell>{t.queries.cols.id}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((q, i) => (
                <TableRow key={q.queryid}>
                  <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>{i + 1}</TableCell>
                  <TableCell sx={{ maxWidth: 0, width: '50%' }}>
                    <OverflowTooltipText
                      text={q.shape ?? '—'}
                      typographyProps={{ variant: 'body2', sx: { fontFamily: mono } }}
                    />
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    {formatDuration(q.totalMs)}
                  </TableCell>
                  <TableCell><ShareBar pct={shares[i]} /></TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    <Typography component="span" variant="body2" sx={{ fontFamily: mono, color: 'text.secondary' }}>
                      {shortQueryId(q.queryid)}
                    </Typography>
                    <CopyIdButton id={q.queryid} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </SectionCard>
  );
}
