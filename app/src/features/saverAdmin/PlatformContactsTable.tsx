import { ChevronRight, Info } from 'lucide-react';
import {
  Box, IconButton, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material';
import { AppIcon } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { formatDateTime } from './format';
import { saverAdminStrings as s } from './strings';
import type { PlatformContact } from './types';

interface Props {
  items: PlatformContact[];
  onOpen: (contact: PlatformContact) => void;
}

function HeadWithHint({ label, hint, align }: { label: string; hint: string; align?: 'right' }) {
  return (
    <TableCell align={align}>
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
        {label}
        <Tooltip title={hint} arrow>
          <Box component="span" tabIndex={0} aria-label={hint} sx={{ display: 'inline-flex', color: 'text.secondary', cursor: 'help' }}>
            <AppIcon icon={Info} size="inline" />
          </Box>
        </Tooltip>
      </Box>
    </TableCell>
  );
}

const muted = (text: string) => <Typography component="span" variant="body2" color="text.secondary">{text}</Typography>;

/** Uma linha por contato da base. Nome, número e LID borram pelas flags `saverAdmin.*`. */
export function PlatformContactsTable({ items, onOpen }: Props) {
  const blurName = useBlur('saverAdmin.contactNames');
  const blurPhone = useBlur('saverAdmin.contactPhones');

  return (
    <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2, overflowX: 'auto' }}>
      <Table size="small" aria-label={s.table.label} sx={{ minWidth: 860 }}>
        <TableHead>
          <TableRow>
            <TableCell>{s.table.name}</TableCell>
            <TableCell>{s.table.phone}</TableCell>
            <HeadWithHint label={s.table.lid} hint={s.table.lidHint} />
            <TableCell>{s.table.firstExtracted}</TableCell>
            <TableCell>{s.table.lastExtracted}</TableCell>
            <HeadWithHint label={s.table.tenants} hint={s.table.tenantsHint} align="right" />
            <HeadWithHint label={s.table.groups} hint={s.table.groupsHint} align="right" />
            <TableCell padding="checkbox"><Box component="span" sx={visuallyHidden}>{s.table.open}</Box></TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((c) => {
            const who = c.name ?? c.phone ?? c.lid ?? s.table.noName;
            const first = formatDateTime(c.firstExtractedAt);
            const last = formatDateTime(c.lastExtractedAt);
            return (
              <TableRow key={c.id} hover data-testid="platform-contact-row" onClick={() => onOpen(c)} sx={{ cursor: 'pointer' }}>
                <TableCell sx={{ maxWidth: 240 }}>
                  {c.name ? (
                    <Blurred when={blurName}>
                      <Typography variant="body2" fontWeight={600} noWrap title={blurName ? undefined : c.name}>{c.name}</Typography>
                    </Blurred>
                  ) : muted(s.table.noName)}
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {c.phone ? <Blurred when={blurPhone} inline>{c.phone}</Blurred> : muted(s.table.hiddenPhone)}
                </TableCell>
                <TableCell sx={{ maxWidth: 200 }}>
                  {c.lid ? (
                    <Blurred when={blurPhone}>
                      <Typography variant="body2" noWrap sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{c.lid}</Typography>
                    </Blurred>
                  ) : muted(s.table.none)}
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{first ?? muted(s.table.none)}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{last ?? muted(s.table.none)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{c.tenantCount.toLocaleString('pt-BR')}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{c.groupCount.toLocaleString('pt-BR')}</TableCell>
                <TableCell padding="checkbox">
                  <Tooltip title={s.table.open} arrow>
                    <IconButton
                      size="small"
                      aria-label={blurName || blurPhone ? s.table.open : s.table.openContact(who)}
                      onClick={(e) => { e.stopPropagation(); onOpen(c); }}
                    >
                      <AppIcon icon={ChevronRight} size="sm" />
                    </IconButton>
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

const visuallyHidden = {
  position: 'absolute', width: '1px', height: '1px', p: 0, m: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
} as const;
