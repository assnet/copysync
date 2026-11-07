import {
  Box, Chip, IconButton, Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip,
  Typography,
} from '@mui/material';
import { Copy, ExternalLink, Pencil, Trash2 } from 'lucide-react';
import { AppIcon, OverflowTooltipText } from '@/components';
import { publicRedirectUrl } from '../rules';
import { redirectLinksStrings } from '../strings';
import type { RedirectLink } from '../types';

const t = redirectLinksStrings;

interface Props {
  links: RedirectLink[];
  busy: Record<string, boolean>;
  onToggle: (link: RedirectLink, active: boolean) => void;
  onCopy: (link: RedirectLink) => void;
  onEdit: (link: RedirectLink) => void;
  onRemove: (link: RedirectLink) => void;
}

function Destination({ side, url }: { side: string; url: string }) {
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
      <Chip label={side} size="small" variant="outlined" sx={{ height: 20, fontSize: 11, fontWeight: 700, flexShrink: 0 }} />
      <OverflowTooltipText text={url} typographyProps={{ variant: 'body2', sx: { fontFamily: 'monospace', minWidth: 0 } }} />
    </Stack>
  );
}

/** Lista de links: endereço copiável, destinos, divisão, ativo, cliques e ações. Rola na horizontal no celular. */
export function RedirectLinksTable({ links, busy, onToggle, onCopy, onEdit, onRemove }: Props) {
  return (
    <TableContainer sx={{ overflowX: 'auto' }}>
      <Table size="small" sx={{ minWidth: 860 }}>
        <TableHead>
          <TableRow>
            <TableCell>{t.columns.link}</TableCell>
            <TableCell>{t.columns.destination}</TableCell>
            <TableCell>{t.columns.split}</TableCell>
            <TableCell>{t.columns.status}</TableCell>
            <TableCell align="right">{t.columns.clicks}</TableCell>
            <TableCell align="right">{t.columns.actions}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {links.map((l) => {
            const url = publicRedirectUrl(l.slug);
            const isBusy = Boolean(busy[l.id]);
            return (
              <TableRow key={l.id} hover sx={{ opacity: l.isActive ? 1 : 0.7 }}>
                <TableCell sx={{ maxWidth: 280 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, fontFamily: 'monospace', wordBreak: 'break-all' }}>{l.slug}</Typography>
                  <OverflowTooltipText text={url} typographyProps={{ variant: 'caption', color: 'text.secondary', sx: { display: 'block' } }} />
                  {l.note && (
                    <OverflowTooltipText text={l.note} typographyProps={{ variant: 'caption', color: 'text.secondary', sx: { display: 'block', fontStyle: 'italic' } }} />
                  )}
                </TableCell>
                <TableCell sx={{ maxWidth: 320 }}>
                  <Stack spacing={0.5}>
                    <Destination side={t.sideA} url={l.urlA} />
                    {l.urlB && <Destination side={t.sideB} url={l.urlB} />}
                  </Stack>
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  <Typography variant="body2">{l.urlB ? t.splitLabel(l.percentA) : t.splitAll}</Typography>
                </TableCell>
                <TableCell>
                  <Tooltip title={l.isActive ? '' : t.inactiveHint}>
                    <span>
                      <Switch
                        checked={l.isActive}
                        disabled={isBusy}
                        onChange={(_, v) => onToggle(l, v)}
                        inputProps={{ 'aria-label': t.status.toggle(l.slug) }}
                      />
                    </span>
                  </Tooltip>
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  <Tooltip title={t.clicksHint}>
                    <Box sx={{ display: 'inline-block', textAlign: 'right' }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{t.clicksTotal(l.hitsTotal)}</Typography>
                      {l.urlB && (
                        <Typography variant="caption" color="text.secondary">{t.clicksSplit(l.hitsA, l.hitsB)}</Typography>
                      )}
                    </Box>
                  </Tooltip>
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  <Tooltip title={t.actions.copy}>
                    <IconButton aria-label={`${t.actions.copy}: ${l.slug}`} onClick={() => onCopy(l)}>
                      <AppIcon icon={Copy} size="sm" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t.actions.open}>
                    <IconButton
                      aria-label={`${t.actions.open}: ${l.slug}`}
                      component="a"
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <AppIcon icon={ExternalLink} size="sm" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t.actions.edit}>
                    <IconButton aria-label={`${t.actions.edit}: ${l.slug}`} onClick={() => onEdit(l)}>
                      <AppIcon icon={Pencil} size="sm" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t.actions.remove}>
                    <span>
                      <IconButton aria-label={`${t.actions.remove}: ${l.slug}`} color="error" disabled={isBusy} onClick={() => onRemove(l)}>
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
