import { ChevronRight } from 'lucide-react';
import {
  Box, ButtonBase, Chip, IconButton, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography,
  useMediaQuery, useTheme,
} from '@mui/material';
import { AppIcon } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { formatCount, formatDateTime } from './format';
import { countryName, dddRegion, splitPhone } from './phoneRegions';
import { NUMERIC, VISUALLY_HIDDEN, focusRingSx, panelSx, tableHeadSx, toneFill, toneText } from './platformContactsStyle';
import { saverAdminStrings as s } from './strings';
import type { PlatformContact } from './types';

interface Props {
  items: PlatformContact[];
  onOpen: (contact: PlatformContact) => void;
}

/**
 * Cabeçalho com dica: mesmo padrão do `HeaderHint` dos Custos (rótulo sublinhado pontilhado com Tooltip
 * `describeChild`). Um só caminho para leitor de tela: o nome da coluna é o rótulo e a dica é a descrição
 * dele; sem ícone focável nem texto repetido.
 */
function HeadWithHint({ label, hint, align }: { label: string; hint: string; align?: 'right' }) {
  const theme = useTheme();
  return (
    <TableCell align={align}>
      <Tooltip title={hint} arrow enterTouchDelay={0} describeChild>
        <Box
          component="span"
          tabIndex={0}
          sx={{ borderBottom: 1, borderBottomStyle: 'dotted', borderBottomColor: 'text.disabled', cursor: 'help', borderRadius: '2px', ...focusRingSx(theme) }}
        >
          {label}
        </Box>
      </Tooltip>
    </TableCell>
  );
}

const muted = (text: string) => <Typography component="span" variant="body2" color="text.secondary">{text}</Typography>;

/** Selo de contato sem número guardado. Não depende só da cor: tem texto e Tooltip. */
function LidOnlyBadge() {
  const theme = useTheme();
  return (
    <Tooltip title={s.table.lidOnlyHint} arrow describeChild>
      <Chip
        size="small"
        label={s.table.lidOnly}
        tabIndex={0}
        sx={{ height: 22, fontSize: '0.75rem', bgcolor: toneFill(theme, 'warning'), color: toneText(theme, 'warning'), ...focusRingSx(theme) }}
      />
    </Tooltip>
  );
}

/**
 * Telefone com o DDI apagado, o DDD em destaque e o número agrupado. O número inteiro segue num rótulo
 * único para leitor de tela; borrado pela flag `saverAdmin.contactPhones` quem chama.
 */
export function PhoneNumber({ phone }: { phone: string }) {
  const theme = useTheme();
  const { ddi, ddd, local } = splitPhone(phone);
  return (
    <Box component="span" sx={{ ...NUMERIC, display: 'inline-flex', alignItems: 'baseline', gap: 0.75, whiteSpace: 'nowrap' }}>
      {ddi && (
        <Tooltip title={s.table.ddiHint(countryName(ddi))} arrow describeChild>
          <Box component="span" sx={{ color: 'text.secondary' }}>+{ddi}</Box>
        </Tooltip>
      )}
      {ddd && (
        <Tooltip title={s.table.dddHint(dddRegion(ddd))} arrow describeChild>
          <Box component="span" sx={{ fontWeight: 700, px: 0.75, borderRadius: '6px', bgcolor: toneFill(theme, 'primary'), color: toneText(theme, 'primary') }}>{ddd}</Box>
        </Tooltip>
      )}
      <Box component="span" sx={{ fontWeight: 500 }}>{local}</Box>
    </Box>
  );
}

/** Uma linha por contato da base. Nome, número e LID borram pelas flags `saverAdmin.*`. Em tela estreita vira lista. */
export function PlatformContactsTable({ items, onOpen }: Props) {
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('md'));
  const blurName = useBlur('saverAdmin.contactNames');
  const blurPhone = useBlur('saverAdmin.contactPhones');
  const openLabel = (c: PlatformContact) => (blurName || blurPhone ? s.table.open : s.table.openContact(c.name ?? c.phone ?? c.lid ?? s.table.noName));

  const name = (c: PlatformContact) => (c.name ? (
    <Blurred when={blurName}>
      <Typography variant="body2" fontWeight={600} noWrap title={blurName ? undefined : c.name}>{c.name}</Typography>
    </Blurred>
  ) : muted(s.table.noName));
  const phone = (c: PlatformContact) => (c.phone ? <Blurred when={blurPhone} inline><PhoneNumber phone={c.phone} /></Blurred> : <LidOnlyBadge />);
  const lid = (c: PlatformContact) => (c.lid ? (
    <Blurred when={blurPhone}>
      <Typography variant="caption" color="text.secondary" noWrap sx={{ ...NUMERIC, display: 'block' }}>{c.lid}</Typography>
    </Blurred>
  ) : null);

  if (compact) {
    return (
      <Box component="ul" aria-label={s.table.label} sx={{ ...panelSx(theme), listStyle: 'none', p: 0, m: 0, overflow: 'hidden' }}>
        {items.map((c) => {
          const last = formatDateTime(c.lastExtractedAt);
          return (
            <Box component="li" key={c.id} sx={{ '& + li': { borderTop: 1, borderColor: 'divider' } }}>
              <ButtonBase
                data-testid="platform-contact-row"
                aria-label={openLabel(c)}
                onClick={() => onOpen(c)}
                sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', columnGap: 1, rowGap: 0.5, alignItems: 'center', width: '100%', textAlign: 'left', px: 1.75, py: 1.5, '&:hover': { bgcolor: 'action.hover' }, ...focusRingSx(theme), outlineOffset: '-2px' }}
              >
                <Box sx={{ minWidth: 0 }}>{name(c)}</Box>
                <Box sx={{ gridRow: 'span 3', color: 'text.secondary', display: 'flex' }}><AppIcon icon={ChevronRight} size="sm" /></Box>
                <Box sx={{ minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1, rowGap: 0.25 }}>
                  {phone(c)}
                  <Box sx={{ minWidth: 0, maxWidth: '100%' }}>{lid(c)}</Box>
                </Box>
                <Typography variant="caption" color="text.secondary" sx={NUMERIC}>
                  {[last, s.table.tenantsCount(c.tenantCount), s.table.groupsCount(c.groupCount)].filter(Boolean).join(' · ')}
                </Typography>
              </ButtonBase>
            </Box>
          );
        })}
      </Box>
    );
  }

  return (
    <TableContainer sx={{ ...panelSx(theme), overflowX: 'auto' }}>
      <Table aria-label={s.table.label} sx={{ minWidth: 820, '& td': { py: 1.25, borderBottomColor: 'divider' }, '& tbody tr:last-of-type td': { borderBottom: 0 } }}>
        <TableHead sx={tableHeadSx(theme)}>
          <TableRow>
            <TableCell>{s.table.name}</TableCell>
            <TableCell>{s.table.phone}</TableCell>
            <HeadWithHint label={s.table.lid} hint={s.table.lidHint} />
            <TableCell>{s.table.lastExtracted}</TableCell>
            <HeadWithHint label={s.table.tenants} hint={s.table.tenantsHint} align="right" />
            <HeadWithHint label={s.table.groups} hint={s.table.groupsHint} align="right" />
            <TableCell padding="checkbox"><Box component="span" sx={VISUALLY_HIDDEN}>{s.table.open}</Box></TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((c) => {
            const first = formatDateTime(c.firstExtractedAt);
            const last = formatDateTime(c.lastExtractedAt);
            return (
              <TableRow key={c.id} hover data-testid="platform-contact-row" onClick={() => onOpen(c)} sx={{ cursor: 'pointer' }}>
                <TableCell sx={{ maxWidth: 260 }}>{name(c)}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{phone(c)}</TableCell>
                <TableCell sx={{ maxWidth: 180 }}>{lid(c) ?? muted(s.table.none)}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap', ...NUMERIC }}>
                  {last ?? muted(s.table.none)}
                  {first && first !== last && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{s.table.since(first)}</Typography>
                  )}
                </TableCell>
                <TableCell align="right" sx={NUMERIC}>{formatCount(c.tenantCount)}</TableCell>
                <TableCell align="right" sx={NUMERIC}>{formatCount(c.groupCount)}</TableCell>
                <TableCell padding="checkbox">
                  <Tooltip title={s.table.open} arrow>
                    <IconButton size="small" aria-label={openLabel(c)} onClick={(e) => { e.stopPropagation(); onOpen(c); }}>
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
