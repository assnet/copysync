import { useMemo } from 'react';
import {
  Box, Checkbox, IconButton, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material';
import { Info, Trash2, TriangleAlert } from 'lucide-react';
import { AppIcon } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { saverStrings } from '../../strings';
import type { SaverGroup } from '../../types';

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
}

/** Grupos salvos com contagens. Nunca linha de contato: o tenant só vê números agregados. */
export function SavedGroupsTable({ groups, selected, onSelectedChange, selectable, onRemove }: Props) {
  const blur = useBlur('saver.groupNames');
  const chosen = useMemo(() => new Set(selected), [selected]);
  const all = groups.length > 0 && groups.every((g) => chosen.has(g.id));
  const some = groups.some((g) => chosen.has(g.id));
  const toggle = (id: string) => onSelectedChange(chosen.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <TableContainer>
      <Table size="small" aria-label={t.title}>
        <TableHead>
          <TableRow>
            {selectable && (
              <TableCell padding="checkbox">
                <Checkbox
                  checked={all}
                  indeterminate={!all && some}
                  onChange={() => onSelectedChange(all ? [] : groups.map((g) => g.id))}
                  slotProps={{ input: { 'aria-label': t.selectAll } }}
                />
              </TableCell>
            )}
            <TableCell>{t.columns.name}</TableCell>
            <TableCell align="right">{t.columns.members}</TableCell>
            <TableCell align="right">{t.columns.phones}</TableCell>
            <TableCell align="right">
              <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                {t.columns.lidOnly}
                <Tooltip title={t.lidOnlyHint} arrow>
                  <Box component="span" tabIndex={0} aria-label={t.lidOnlyHint} sx={{ display: 'inline-flex', color: 'text.secondary', cursor: 'help' }}>
                    <AppIcon icon={Info} size="inline" />
                  </Box>
                </Tooltip>
              </Box>
            </TableCell>
            <TableCell>{t.columns.lastScan}</TableCell>
            {onRemove && <TableCell align="right"><Box component="span" sx={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{t.columns.actions}</Box></TableCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {groups.map((g) => {
            const warn = g.lastScanStatus ? t.scanStatus[g.lastScanStatus] : undefined;
            return (
              <TableRow key={g.id} hover selected={chosen.has(g.id)}>
                {selectable && (
                  <TableCell padding="checkbox">
                    <Checkbox checked={chosen.has(g.id)} onChange={() => toggle(g.id)} slotProps={{ input: { 'aria-label': `${t.selectGroup}: ${g.name}` } }} />
                  </TableCell>
                )}
                <TableCell sx={{ maxWidth: 280 }}>
                  <Blurred when={blur} radius={5}>
                    <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{g.name}</Typography>
                  </Blurred>
                </TableCell>
                <TableCell align="right">{num(g.memberCount)}</TableCell>
                <TableCell align="right">{num(g.phoneCount)}</TableCell>
                <TableCell align="right">{num(g.lidOnlyCount)}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
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
                </TableCell>
                {onRemove && (
                  <TableCell align="right">
                    <Tooltip title={t.remove}>
                      <IconButton size="small" aria-label={`${t.remove}: ${g.name}`} onClick={() => onRemove(g)}>
                        <AppIcon icon={Trash2} size="sm" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
