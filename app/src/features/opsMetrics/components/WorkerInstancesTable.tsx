import {
  Box, Chip, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material';
import { Server } from 'lucide-react';
import { AppIcon, EmptyState, SectionCard } from '@/components';
import { serverNow } from '@/services/serverClock';
import { formatRelativeTime } from '@/features/linkDomainsAdmin/rules';
import { formatNumber, formatPct, statusFor } from '../rules';
import { opsMetricsStrings as t } from '../strings';
import type { OpsStatus, OpsThresholds, OpsWorkerInstance } from '../types';
import { HelpTip } from './HelpTip';

const mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const STATUS_COLOR: Record<OpsStatus, string> = {
  ok: 'text.primary', warning: 'warning.main', critical: 'error.main', noData: 'text.secondary',
};

type ColKey = keyof typeof t.instances.colHints;

function HeadCell({ col, align = 'right' }: { col: ColKey | 'instance'; align?: 'left' | 'right' }) {
  const label = t.instances.cols[col];
  return (
    <TableCell align={align} sx={{ whiteSpace: 'nowrap' }}>
      {col === 'instance' ? label : (
        <Tooltip title={t.instances.colHints[col]} enterTouchDelay={0}>
          <Box component="span" tabIndex={0} sx={{ borderBottom: 1, borderColor: 'divider', borderBottomStyle: 'dotted', cursor: 'help' }}>
            {label}
          </Box>
        </Tooltip>
      )}
    </TableCell>
  );
}

function PctCell({ value, threshold }: { value: number | null; threshold?: number }) {
  const status = threshold == null ? 'noData' : statusFor(value, threshold);
  return (
    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: value == null ? 'text.secondary' : STATUS_COLOR[status] }}>
      {formatPct(value)}
    </TableCell>
  );
}

function MissingChip({ label, hint }: { label: string; hint: string }) {
  return (
    <Tooltip title={hint} enterTouchDelay={0}>
      <Chip size="small" variant="outlined" label={label} tabIndex={0} sx={{ ml: 1 }} />
    </Tooltip>
  );
}

interface Props {
  instances: OpsWorkerInstance[];
  thresholds?: OpsThresholds;
}

/**
 * Uma linha por réplica viva do serviço worker (Render × batimento). Dado de infraestrutura: nome
 * curto da instância e números, sem tenant nem cliente, por isso sem flag de borrar.
 */
export function WorkerInstancesTable({ instances, thresholds }: Props) {
  const now = serverNow();
  return (
    <SectionCard
      title={t.instances.title}
      subtitle={t.instances.subtitle}
      action={<HelpTip label={t.instances.title} text={t.instances.help} />}
      noPadding={instances.length > 0}
    >
      {instances.length === 0 ? (
        <EmptyState
          icon={<AppIcon icon={Server} size="lg" />}
          title={t.instances.empty}
          description={t.instances.emptyHint}
          sx={{ py: 4 }}
        />
      ) : (
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label={t.instances.tableAria}>
            <TableHead>
              <TableRow>
                <HeadCell col="instance" align="left" />
                <HeadCell col="cpu" />
                <HeadCell col="memory" />
                <HeadCell col="sessions" />
                <HeadCell col="logins" />
                <HeadCell col="seen" />
              </TableRow>
            </TableHead>
            <TableBody>
              {instances.map((r) => {
                const hb = r.heartbeat;
                const seenIso = hb?.seenAt ?? r.sampledAt;
                return (
                  <TableRow key={r.resource ?? `hb:${r.instance}`}>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Tooltip title={r.resource ?? hb?.workerId ?? r.instance}>
                        <Typography component="span" variant="body2" sx={{ fontFamily: mono }}>{r.instance}</Typography>
                      </Tooltip>
                      {!hb && <MissingChip label={t.instances.noHeartbeat} hint={t.instances.noHeartbeatHint} />}
                      {!r.resource && <MissingChip label={t.instances.noSample} hint={t.instances.noSampleHint} />}
                    </TableCell>
                    <PctCell value={r.cpuPct} threshold={thresholds?.cpuPct} />
                    <PctCell value={r.memoryPct} threshold={thresholds?.memoryPct} />
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {hb ? (
                        <Tooltip title={t.instances.rss(hb.rssMb)}>
                          <span>{t.instances.sessions(hb.sessions, hb.maxSessions)}</span>
                        </Tooltip>
                      ) : '—'}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {hb ? formatNumber(hb.pendingLogins) : '—'}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>
                      {seenIso ? (
                        <Tooltip title={new Date(seenIso).toLocaleString('pt-BR')}>
                          <time dateTime={seenIso}>{formatRelativeTime(seenIso, now, t.header.justNow)}</time>
                        </Tooltip>
                      ) : '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </SectionCard>
  );
}
