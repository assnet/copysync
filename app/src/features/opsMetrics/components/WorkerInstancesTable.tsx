import {
  Box, Chip, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip,
} from '@mui/material';
import { OctagonAlert, Server, TriangleAlert } from 'lucide-react';
import { AppIcon, EmptyState, OverflowTooltipText, SectionCard } from '@/components';
import { serverNow } from '@/services/serverClock';
import { formatRelativeTime } from '@/features/linkDomainsAdmin/rules';
import { formatDateTime, formatNumber, formatPct, statusFor } from '../rules';
import { opsMetricsStrings as t } from '../strings';
import type { OpsThresholds, OpsWorkerInstance } from '../types';
import { HelpTip } from './HelpTip';

const mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
/** Ícone do limiar: tom `dark` no claro e `light` no escuro (contraste de elemento gráfico ≥ 3:1). */
const LEVEL = {
  warning: { icon: TriangleAlert, color: (dark: boolean) => (dark ? 'warning.light' : 'warning.dark') },
  critical: { icon: OctagonAlert, color: (dark: boolean) => (dark ? 'error.light' : 'error.dark') },
} as const;
/** Primeira coluna fixa na rolagem horizontal (390 px), com o fundo do card. */
const STICKY = { position: 'sticky', left: 0, zIndex: 1, bgcolor: 'background.paper' } as const;
const dottedHint = { borderBottom: 1, borderColor: 'divider', borderBottomStyle: 'dotted', cursor: 'help' } as const;

type ColKey = keyof typeof t.instances.colHints;

function HeadCell({ col, align = 'right' }: { col: ColKey | 'instance'; align?: 'left' | 'right' }) {
  const label = t.instances.cols[col];
  return (
    <TableCell align={align} sx={{ whiteSpace: 'nowrap', ...(col === 'instance' ? STICKY : {}) }}>
      {col === 'instance' ? label : (
        <Tooltip title={t.instances.colHints[col]} arrow describeChild enterTouchDelay={0}>
          <Box component="span" tabIndex={0} sx={dottedHint}>{label}</Box>
        </Tooltip>
      )}
    </TableCell>
  );
}

/**
 * % com limiar: o número fica na cor do texto (contraste de texto garantido) e o nível acima do "ok"
 * ganha ícone colorido + nome do status para leitor de tela (nunca só cor).
 */
function PctCell({ value, threshold }: { value: number | null; threshold?: number }) {
  const status = threshold == null ? 'noData' : statusFor(value, threshold);
  const level = status === 'warning' || status === 'critical' ? LEVEL[status] : null;
  return (
    <TableCell
      align="right"
      sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: value == null ? 'text.secondary' : 'text.primary' }}
    >
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
        {level && (
          <Box component="span" sx={(th) => ({ display: 'inline-flex', color: level.color(th.palette.mode === 'dark') })}>
            <AppIcon icon={level.icon} label={t.instances.statusAria(t.status[status])} />
          </Box>
        )}
        {formatPct(value)}
      </Box>
    </TableCell>
  );
}

function MissingChip({ label, hint }: { label: string; hint: string }) {
  return (
    <Tooltip title={hint} arrow describeChild enterTouchDelay={0}>
      <Chip size="small" variant="outlined" label={label} tabIndex={0} sx={{ ml: 1 }} />
    </Tooltip>
  );
}

interface Props {
  instances: OpsWorkerInstance[];
  thresholds?: OpsThresholds;
  /** Motivo da lista vazia (`workerInstancesSection`): sem réplica agora × worker não configurado. */
  emptyReason?: 'offline' | 'notConfigured';
}

/**
 * Uma linha por réplica viva do serviço worker (Render × batimento). Dado de infraestrutura: nome
 * curto da instância e números, sem tenant nem cliente, por isso sem flag de borrar.
 */
export function WorkerInstancesTable({ instances, thresholds, emptyReason = 'offline' }: Props) {
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
          title={emptyReason === 'notConfigured' ? t.instances.notConfigured : t.instances.empty}
          description={emptyReason === 'notConfigured' ? t.instances.notConfiguredHint : t.instances.emptyOfflineHint}
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
                    <TableCell sx={{ whiteSpace: 'nowrap', ...STICKY }}>
                      <OverflowTooltipText
                        text={r.resource ?? hb?.workerId ?? r.instance}
                        alwaysShow
                        typographyProps={{ component: 'span', variant: 'body2', sx: { fontFamily: mono, display: 'inline-block', verticalAlign: 'middle' } }}
                      >
                        {r.instance}
                      </OverflowTooltipText>
                      {!hb && <MissingChip label={t.instances.noHeartbeat} hint={t.instances.noHeartbeatHint} />}
                      {!r.resource && <MissingChip label={t.instances.noSample} hint={t.instances.noSampleHint} />}
                    </TableCell>
                    <PctCell value={r.cpuPct} threshold={thresholds?.cpuPct} />
                    <PctCell value={r.memoryPct} threshold={thresholds?.memoryPct} />
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {hb ? (
                        <Tooltip title={t.instances.rss(hb.rssMb)} arrow describeChild enterTouchDelay={0}>
                          <Box component="span" tabIndex={0} sx={dottedHint}>{t.instances.sessions(hb.sessions, hb.maxSessions)}</Box>
                        </Tooltip>
                      ) : '—'}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {hb ? formatNumber(hb.pendingLogins) : '—'}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>
                      {seenIso ? (
                        <Tooltip title={formatDateTime(seenIso)} arrow describeChild enterTouchDelay={0}>
                          <Box component="time" dateTime={seenIso} tabIndex={0} sx={dottedHint}>
                            {formatRelativeTime(seenIso, now, t.header.justNow)}
                          </Box>
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
