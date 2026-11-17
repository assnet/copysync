import { useMemo, type ReactNode } from 'react';
import {
  Box, Checkbox, IconButton, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip,
  Typography, useMediaQuery, type Theme,
} from '@mui/material';
import { Info, Trash2, TriangleAlert } from 'lucide-react';
import { AppIcon, OverflowTooltipText } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { GroupAvatar } from '@/features/offers/components/GroupChip';
import { saverStrings } from '../../strings';
import type { SaverGroup, SaverSessionGroupKind } from '../../types';
import { selectedRowSx } from '../../saverStyle';
import { CopyGroupNameButton } from './CopyGroupNameButton';
import { KindBadge } from './GroupSelectionTable';

const t = saverStrings.groups.saved;
const num = (n: number) => n.toLocaleString('pt-BR');

interface Props {
  groups: SaverGroup[];
  selected: string[];
  onSelectedChange: (ids: string[]) => void;
  /** Coluna de marcar (só quem pode exportar). */
  selectable: boolean;
  /** Remover (só quem configura). */
  onRemove?: (group: SaverGroup) => void;
  /** Tipo por JID, quando a sessão aberta acima já informou (o salvo não guarda o tipo). */
  kinds?: ReadonlyMap<string, SaverSessionGroupKind>;
}

function LidOnlyHeader({ wrap = false }: { wrap?: boolean }) {
  return (
    <Box component="span" sx={wrap ? { '& > span': { ml: 0.5, verticalAlign: 'middle' } } : { display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
      {t.columns.lidOnly}
      <Tooltip title={t.lidOnlyHint} arrow>
        <Box component="span" tabIndex={0} aria-label={t.lidOnlyHint} sx={{ display: 'inline-flex', color: 'text.secondary', cursor: 'help' }}>
          <AppIcon icon={Info} size="inline" />
        </Box>
      </Tooltip>
    </Box>
  );
}

function LastScan({ g }: { g: SaverGroup }) {
  const warn = g.lastScanStatus ? t.scanStatus[g.lastScanStatus] : undefined;
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
      {g.lastScannedAt ? saverStrings.groups.dateTime(g.lastScannedAt) : saverStrings.groups.table.neverScanned}
      {warn && (
        <Tooltip title={warn}>
          <Box component="span" tabIndex={0} aria-label={warn} sx={{ display: 'inline-flex', color: 'warning.main' }}>
            <AppIcon icon={TriangleAlert} size="inline" />
          </Box>
        </Tooltip>
      )}
    </Box>
  );
}

/** Grupos salvos com contagens. Nunca linha de contato: o tenant só vê números agregados. Celular: cartões. */
export function SavedGroupsTable({ groups, selected, onSelectedChange, selectable, onRemove, kinds }: Props) {
  const blur = useBlur('saver.groupNames');
  const cards = useMediaQuery((theme: Theme) => theme.breakpoints.down('md'));
  const chosen = useMemo(() => new Set(selected), [selected]);
  const all = groups.length > 0 && groups.every((g) => chosen.has(g.id));
  const some = groups.some((g) => chosen.has(g.id));
  const toggle = (id: string) => onSelectedChange(chosen.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const selectAll = (
    <Checkbox
      checked={all}
      indeterminate={!all && some}
      onChange={() => onSelectedChange(all ? [] : groups.map((g) => g.id))}
      slotProps={{ input: { 'aria-label': t.selectAll } }}
    />
  );

  const pick = (g: SaverGroup) => (
    <Checkbox checked={chosen.has(g.id)} onChange={() => toggle(g.id)} slotProps={{ input: { 'aria-label': blur ? t.selectGroup : `${t.selectGroup}: ${g.name}` } }} />
  );
  const remove = (g: SaverGroup) => onRemove && (
    <Tooltip title={t.remove}>
      <IconButton size="small" aria-label={blur ? t.remove : `${t.remove}: ${g.name}`} onClick={() => onRemove(g)}>
        <AppIcon icon={Trash2} size="sm" />
      </IconButton>
    </Tooltip>
  );
  const name = (g: SaverGroup, extra?: ReactNode) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
      <GroupAvatar title={g.name} avatarUrl={null} size={32} blurFlag="saver.groupNames" />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, minWidth: 0 }}>
          <OverflowTooltipText text={g.name} disabled={blur} typographyProps={{ variant: 'body2', sx: { fontWeight: 600 } }}>
            <Blurred when={blur} inline radius={5}>{g.name}</Blurred>
          </OverflowTooltipText>
          <CopyGroupNameButton name={g.name} hideName={blur} />
        </Box>
        {extra}
      </Box>
    </Box>
  );
  const kindOf = (g: SaverGroup) => kinds?.get(g.groupJid);

  if (cards) {
    return (
      <Stack spacing={1} aria-label={t.title} role="list">
        {selectable && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {selectAll}
            <Typography variant="body2" color="text.secondary">{t.selectAll}</Typography>
          </Box>
        )}
        {groups.map((g) => {
          const kind = kindOf(g);
          return (
            <Paper
              key={g.id}
              role="listitem"
              variant="outlined"
              sx={(theme) => ({ borderRadius: 2, p: 1.25, ...(chosen.has(g.id) && selectedRowSx(theme)) })}
            >
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
                {selectable && pick(g)}
                <Box sx={{ flex: 1, minWidth: 0, pt: selectable ? 0.75 : 0 }}>
                  {name(g, kind && kind !== 'GROUP' && <Box sx={{ mt: 0.5 }}><KindBadge kind={kind} /></Box>)}
                </Box>
                {remove(g)}
              </Box>
              <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1, m: 0, mt: 1 }}>
                {([
                  [t.columns.members, num(g.memberCount)],
                  [t.columns.phones, num(g.phoneCount)],
                  [<LidOnlyHeader key="lid" wrap />, num(g.lidOnlyCount)],
                ] as const).map(([label, value], i) => (
                  <Box key={i}>
                    <Typography component="dt" variant="caption" color="text.secondary">{label}</Typography>
                    <Typography component="dd" variant="body2" sx={{ m: 0, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
                  </Box>
                ))}
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                {t.columns.lastScan}: <LastScan g={g} />
              </Typography>
            </Paper>
          );
        })}
      </Stack>
    );
  }

  return (
    <TableContainer>
      <Table size="small" aria-label={t.title} sx={{ '& td, & th': { borderColor: 'divider' }, '& th': { color: 'text.secondary', fontWeight: 600 } }}>
        <TableHead>
          <TableRow>
            {selectable && <TableCell padding="checkbox">{selectAll}</TableCell>}
            <TableCell>{t.columns.name}</TableCell>
            <TableCell align="right">{t.columns.members}</TableCell>
            <TableCell align="right">{t.columns.phones}</TableCell>
            <TableCell align="right"><LidOnlyHeader /></TableCell>
            <TableCell>{t.columns.lastScan}</TableCell>
            {onRemove && <TableCell align="right"><Box component="span" sx={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{t.columns.actions}</Box></TableCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {groups.map((g) => {
            const kind = kindOf(g);
            return (
              <TableRow key={g.id} hover sx={(theme) => (chosen.has(g.id) ? selectedRowSx(theme) : {})}>
                {selectable && <TableCell padding="checkbox">{pick(g)}</TableCell>}
                <TableCell sx={{ py: 1.25, width: '40%', maxWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                    <Box sx={{ minWidth: 0 }}>{name(g)}</Box>
                    {kind && kind !== 'GROUP' && <KindBadge kind={kind} />}
                  </Box>
                </TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num(g.memberCount)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num(g.phoneCount)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num(g.lidOnlyCount)}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}><LastScan g={g} /></TableCell>
                {onRemove && <TableCell align="right">{remove(g)}</TableCell>}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
