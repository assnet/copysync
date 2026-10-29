import {
  Box, Chip, CircularProgress, IconButton, Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, Tooltip, Typography,
} from '@mui/material';
import { Activity, CircleCheck, CircleDashed, CircleX, Pencil, Trash2 } from 'lucide-react';
import { AppIcon } from '@/components';
import { serverNow } from '@/services/serverClock';
import { probeReasonMessage } from '../errors';
import { formatRelativeTime } from '../rules';
import { linkDomainsAdminStrings } from '../strings';
import type { LinkDomain, LinkDomainProbeResult } from '../types';

const t = linkDomainsAdminStrings;

interface Props {
  domains: LinkDomain[];
  busy: Record<string, boolean>;
  probing: Record<string, boolean>;
  probeResults: Record<string, LinkDomainProbeResult>;
  onToggle: (domain: LinkDomain, active: boolean) => void;
  onProbe: (domain: LinkDomain) => void;
  onEdit: (domain: LinkDomain) => void;
  onRemove: (domain: LinkDomain) => void;
}

function ProbeCell({ domain, result }: { domain: LinkDomain; result?: LinkDomainProbeResult }) {
  if (!domain.lastProbeAt) {
    return (
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ color: 'text.secondary' }}>
        <AppIcon icon={CircleDashed} size="sm" />
        <Typography variant="body2">{t.probe.never}</Typography>
      </Stack>
    );
  }
  const ok = domain.lastProbeOk === true;
  const when = new Date(domain.lastProbeAt);
  return (
    <Box>
      <Tooltip title={when.toLocaleString('pt-BR')}>
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ color: ok ? 'success.main' : 'error.main', width: 'fit-content' }}>
          <AppIcon icon={ok ? CircleCheck : CircleX} size="sm" />
          <Typography variant="body2" sx={{ color: 'text.primary' }}>
            {ok ? t.probe.ok : t.probe.failed}
            <Box component="span" sx={{ color: 'text.secondary' }}>
              {' · '}
              <time dateTime={domain.lastProbeAt}>{formatRelativeTime(domain.lastProbeAt, serverNow(), t.relative.justNow)}</time>
            </Box>
          </Typography>
        </Stack>
      </Tooltip>
      {result && !result.ok && (
        <Typography variant="caption" color="error" role="status" sx={{ display: 'block', mt: 0.5, maxWidth: 360 }}>
          {t.probe.failedPrefix} {probeReasonMessage(result)}
        </Typography>
      )}
    </Box>
  );
}

/** Lista de domínios: status, landing, último teste e ações. Rola na horizontal no celular. */
export function LinkDomainsTable({ domains, busy, probing, probeResults, onToggle, onProbe, onEdit, onRemove }: Props) {
  return (
    <TableContainer sx={{ overflowX: 'auto' }}>
      <Table size="small" sx={{ minWidth: 720 }}>
        <TableHead>
          <TableRow>
            <TableCell>{t.columns.hostname}</TableCell>
            <TableCell>{t.columns.status}</TableCell>
            <TableCell>{t.columns.landing}</TableCell>
            <TableCell>{t.columns.probe}</TableCell>
            <TableCell align="right">{t.columns.actions}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {domains.map((d) => {
            const active = d.status === 'ACTIVE';
            const isBusy = Boolean(busy[d.id]);
            const isProbing = Boolean(probing[d.id]);
            return (
              <TableRow key={d.id} hover>
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 600, fontFamily: 'monospace' }}>{d.hostname}</Typography>
                  {d.reservedNames.length > 0 && (
                    <Tooltip title={d.reservedNames.join(', ')}>
                      <Typography variant="caption" color="text.secondary" sx={{ width: 'fit-content', display: 'block' }}>
                        {t.reservedCount(d.reservedNames.length)}
                      </Typography>
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Tooltip title={active ? '' : t.status.pausedHint}>
                      <span>
                        <Switch
                          checked={active}
                          disabled={isBusy}
                          onChange={(_, v) => onToggle(d, v)}
                          inputProps={{ 'aria-label': t.status.toggle(d.hostname) }}
                        />
                      </span>
                    </Tooltip>
                    <Chip
                      size="small"
                      variant="outlined"
                      color={active ? 'success' : 'default'}
                      label={active ? t.status.ACTIVE : t.status.PAUSED}
                    />
                  </Stack>
                </TableCell>
                <TableCell sx={{ maxWidth: 260 }}>
                  {d.landingUrl ? (
                    <Tooltip title={d.landingUrl}>
                      <Typography variant="body2" noWrap sx={{ fontFamily: 'monospace' }}>{d.landingUrl}</Typography>
                    </Tooltip>
                  ) : (
                    <Typography variant="body2" color="text.secondary">{t.landingNone}</Typography>
                  )}
                </TableCell>
                <TableCell>
                  <ProbeCell domain={d} result={probeResults[d.id]} />
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  <Tooltip title={isProbing ? t.probe.running : t.probe.run}>
                    <span>
                      <IconButton aria-label={`${t.probe.run}: ${d.hostname}`} disabled={isProbing} onClick={() => onProbe(d)}>
                        {isProbing ? <CircularProgress size={18} aria-label={t.probe.running} /> : <AppIcon icon={Activity} size="sm" />}
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title={t.actions.edit}>
                    <IconButton aria-label={`${t.actions.edit}: ${d.hostname}`} onClick={() => onEdit(d)}>
                      <AppIcon icon={Pencil} size="sm" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t.actions.remove}>
                    <span>
                      <IconButton aria-label={`${t.actions.remove}: ${d.hostname}`} color="error" disabled={isBusy} onClick={() => onRemove(d)}>
                        <AppIcon icon={Trash2} size="sm" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
