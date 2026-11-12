import { useState, type ReactNode } from 'react';
import {
  Alert, Box, Button, Card, Chip, Divider, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Tooltip, Typography, alpha, type Theme,
} from '@mui/material';
import { CircleDashed, HeartOff, OctagonAlert, Server, TriangleAlert, type LucideIcon } from 'lucide-react';
import { AppIcon, EmptyState, OverflowTooltipText } from '@/components';
import { serverNow } from '@/services/serverClock';
import { formatRelativeTime } from '@/features/linkDomainsAdmin/rules';
import {
  formatFullDateTime, formatNumber, formatPct, instanceSeenAt, statusFor, type WorkerInstancesSection,
} from '../rules';
import { opsMetricsStrings as t } from '../strings';
import type { OpsThresholds } from '../types';
import { HelpTip } from './HelpTip';

const mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
/** Ícone do limiar: tom `dark` no claro e `light` no escuro (contraste de elemento gráfico ≥ 3:1). */
const LEVEL = {
  warning: { icon: TriangleAlert, color: (dark: boolean) => (dark ? 'warning.light' : 'warning.dark') },
  critical: { icon: OctagonAlert, color: (dark: boolean) => (dark ? 'error.light' : 'error.dark') },
} as const;
/**
 * Primeira coluna fixa na rolagem horizontal (390 px), com o fundo do card. A separação (borda + sombra)
 * só aparece quando a tabela está rolada, para não pesar no desktop.
 */
const sticky = (scrolled: boolean) => (th: Theme) => ({
  position: 'sticky', left: 0, zIndex: 1, bgcolor: 'background.paper',
  boxShadow: scrolled
    ? `inset -1px 0 0 ${alpha(th.palette.text.primary, 0.24)}, 6px 0 8px -6px ${alpha(th.palette.common.black, th.palette.mode === 'dark' ? 0.6 : 0.25)}`
    : 'none',
} as const);
const dottedHint = { borderBottom: 1, borderBottomColor: 'text.secondary', borderBottomStyle: 'dotted', cursor: 'help' } as const;
/** Rótulo só para leitor de tela (no `xs` o chip fica só com o ícone). */
const srOnly = {
  position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
} as const;
const DASH = <Box component="span" sx={{ color: 'text.secondary' }}>—</Box>;

type ColKey = keyof typeof t.instances.colHints;

function HeadCell({ col, align = 'right', scrolled = false }: { col: ColKey | 'instance'; align?: 'left' | 'right'; scrolled?: boolean }) {
  const label = t.instances.cols[col];
  return (
    <TableCell align={align} sx={[{ whiteSpace: 'nowrap' }, col === 'instance' && sticky(scrolled)]}>
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
      sx={{
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', verticalAlign: 'middle',
        color: value == null ? 'text.secondary' : 'text.primary',
      }}
    >
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, verticalAlign: 'middle' }}>
        {level && (
          <Box component="span" sx={(th) => ({ display: 'inline-flex', lineHeight: 0, color: level.color(th.palette.mode === 'dark') })}>
            <AppIcon icon={level.icon} size="inline" label={t.instances.statusAria(t.status[status])} />
          </Box>
        )}
        {formatPct(value)}
      </Box>
    </TableCell>
  );
}

/** Falta de batimento/amostra: ícone + palavra; no `xs` só o ícone (palavra fica para leitor de tela). */
function MissingChip({ label, hint, icon }: { label: string; hint: string; icon: LucideIcon }) {
  return (
    <Tooltip title={hint} arrow describeChild enterTouchDelay={0}>
      <Chip
        size="small"
        variant="outlined"
        icon={<AppIcon icon={icon} size="sm" />}
        label={label}
        tabIndex={0}
        sx={(th) => ({
          ml: 1,
          [th.breakpoints.down('sm')]: {
            '& .MuiChip-label': srOnly,
            '& .MuiChip-icon': { mx: 0.5 },
            // Alvo de toque ≥ 44 px sem aumentar a linha: área invisível em volta do chip (24 px + 2 × 10).
            position: 'relative',
            '&::after': { content: '""', position: 'absolute', inset: '-10px' },
          },
        })}
      />
    </Tooltip>
  );
}

interface Props {
  /** Estado decidido por `workerInstancesSection` (nunca `hidden`: aí o card não é montado). */
  section: Exclude<WorkerInstancesSection, { kind: 'hidden' }>;
  thresholds?: OpsThresholds;
  /** Cor da série de cada instância no "Por instância" (marcador ao lado do nome); ausente = sem marcador. */
  instanceColors?: Map<string, string>;
  onRetry: () => void;
}

/**
 * Uma linha por réplica viva do serviço worker (Render × batimento). Dado de infraestrutura: nome
 * curto da instância e números, sem tenant nem cliente, por isso sem flag de borrar. Carregando e
 * erro ficam dentro do card, com o título, como nos gráficos.
 */
export function WorkerInstancesTable({ section, thresholds, instanceColors, onRetry }: Props) {
  const now = serverNow();
  const [scrolled, setScrolled] = useState(false);

  let body: ReactNode;
  if (section.kind === 'loading') {
    body = (
      <Box role="status" aria-busy="true" sx={{ p: 2 }}>
        <Box component="span" sx={srOnly}>{t.instances.loading}</Box>
        <Skeleton variant="rounded" height={140} />
      </Box>
    );
  } else if (section.kind === 'error') {
    body = (
      <Box sx={{ p: 2 }}>
        <Alert
          severity="error"
          action={<Button color="inherit" size="small" onClick={onRetry} sx={{ whiteSpace: 'nowrap' }}>{t.retry}</Button>}
        >
          {t.instances.error}
        </Alert>
      </Box>
    );
  } else if (section.kind === 'empty') {
    const notConfigured = section.reason === 'notConfigured';
    body = (
      <EmptyState
        icon={<AppIcon icon={Server} size="lg" />}
        title={notConfigured ? t.instances.notConfigured : t.instances.empty}
        description={notConfigured ? t.instances.notConfiguredHint : t.instances.emptyOfflineHint}
        sx={{ py: 4, px: 2, border: 0 }}
      />
    );
  } else {
    body = (
      <TableContainer sx={{ overflowX: 'auto' }} onScroll={(e) => setScrolled(e.currentTarget.scrollLeft > 0)}>
        <Table size="small" aria-label={t.instances.tableAria}>
          <TableHead>
            <TableRow>
              <HeadCell col="instance" align="left" scrolled={scrolled} />
              <HeadCell col="cpu" />
              <HeadCell col="memory" />
              <HeadCell col="sessions" />
              <HeadCell col="logins" />
              <HeadCell col="seen" />
            </TableRow>
          </TableHead>
          <TableBody>
            {section.instances.map((r) => {
              const hb = r.heartbeat;
              const seenIso = instanceSeenAt(r);
              const color = instanceColors?.get(r.instance);
              return (
                <TableRow key={r.resource ?? `hb:${r.instance}`}>
                  <TableCell sx={[{ whiteSpace: 'nowrap' }, sticky(scrolled)]}>
                    {color && (
                      <Box
                        component="span"
                        aria-hidden
                        data-testid="instance-color"
                        sx={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', bgcolor: color, mr: 1, verticalAlign: 'middle' }}
                      />
                    )}
                    <OverflowTooltipText
                      text={r.resource ?? hb?.workerId ?? r.instance}
                      alwaysShow
                      typographyProps={{ component: 'span', variant: 'body2', sx: { fontFamily: mono, display: 'inline-block', verticalAlign: 'middle' } }}
                    >
                      {r.instance}
                    </OverflowTooltipText>
                    {!hb && <MissingChip icon={HeartOff} label={t.instances.noHeartbeat} hint={t.instances.noHeartbeatHint} />}
                    {!r.resource && <MissingChip icon={CircleDashed} label={t.instances.noSample} hint={t.instances.noSampleHint} />}
                  </TableCell>
                  <PctCell value={r.cpuPct} threshold={thresholds?.cpuPct} />
                  <PctCell value={r.memoryPct} threshold={thresholds?.memoryPct} />
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    {hb ? (
                      <Tooltip title={t.instances.rss(hb.rssMb)} arrow describeChild enterTouchDelay={0}>
                        <Box component="span" tabIndex={0} sx={dottedHint}>{t.instances.sessions(hb.sessions, hb.maxSessions)}</Box>
                      </Tooltip>
                    ) : DASH}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {hb ? formatNumber(hb.pendingLogins) : DASH}
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>
                    {seenIso ? (
                      <Tooltip title={formatFullDateTime(seenIso)} arrow describeChild enterTouchDelay={0}>
                        <Box component="time" dateTime={seenIso} tabIndex={0} sx={dottedHint}>
                          {formatRelativeTime(seenIso, now, t.header.justNow)}
                        </Box>
                      </Tooltip>
                    ) : DASH}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    );
  }

  return (
    <Card>
      <Box sx={{ px: 2.5, py: 2 }}>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <Typography variant="subtitle1" component="h3">{t.instances.title}</Typography>
          <HelpTip label={t.instances.title} text={t.instances.help} />
        </Stack>
        <Typography variant="caption" color="text.secondary">{t.instances.subtitle}</Typography>
      </Box>
      <Divider />
      {body}
    </Card>
  );
}
