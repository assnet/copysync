import { useMemo } from 'react';
import {
  Box, Checkbox, Chip, InputAdornment, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Paper, TextField,
  Tooltip, Typography,
} from '@mui/material';
import { CircleCheck, Search } from 'lucide-react';
import { AppIcon } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { saverStrings } from '../../strings';
import type { SaverSessionGroup } from '../../types';

const t = saverStrings.groups.table;

interface Props {
  groups: SaverSessionGroup[];
  selected: string[];
  onSelectedChange: (jids: string[]) => void;
  search: string;
  onSearchChange: (value: string) => void;
  disabled?: boolean;
}

const nameOf = (g: SaverSessionGroup) => g.name?.trim() || t.untitledGroup;

/** Grupos ao vivo da sessão: busca, marcar/desmarcar e o que já foi salvo e quando foi lido. */
export function GroupSelectionTable({ groups, selected, onSelectedChange, search, onSearchChange, disabled }: Props) {
  const blur = useBlur('saver.groupNames');
  const chosen = useMemo(() => new Set(selected), [selected]);
  const visible = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('pt-BR');
    return q ? groups.filter((g) => nameOf(g).toLocaleLowerCase('pt-BR').includes(q)) : groups;
  }, [groups, search]);

  if (groups.length === 0) {
    return <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>{t.empty}</Typography>;
  }

  const allVisible = visible.length > 0 && visible.every((g) => chosen.has(g.groupJid));
  const someVisible = visible.some((g) => chosen.has(g.groupJid));
  const toggle = (jid: string) =>
    onSelectedChange(chosen.has(jid) ? selected.filter((j) => j !== jid) : [...selected, jid]);
  const toggleAll = () => {
    const ids = new Set(visible.map((g) => g.groupJid));
    onSelectedChange(allVisible ? selected.filter((j) => !ids.has(j)) : [...new Set([...selected, ...ids])]);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Tooltip title={t.selectAll}>
          <Checkbox
            checked={allVisible}
            indeterminate={!allVisible && someVisible}
            onChange={toggleAll}
            disabled={disabled || visible.length === 0}
            slotProps={{ input: { 'aria-label': t.selectAll } }}
          />
        </Tooltip>
        <TextField
          size="small"
          fullWidth
          placeholder={t.search}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          slotProps={{
            htmlInput: { 'aria-label': t.searchAria },
            input: { startAdornment: <InputAdornment position="start"><AppIcon icon={Search} size="sm" /></InputAdornment> },
          }}
        />
      </Box>
      <Paper variant="outlined" sx={{ maxHeight: 420, overflowY: 'auto', borderRadius: 2 }}>
        {visible.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>{t.noMatch}</Typography>
        ) : (
          <List dense disablePadding>
            {visible.map((g) => {
              const labelId = `saver-group-${g.groupJid}`;
              return (
                <ListItem key={g.groupJid} disablePadding divider>
                  <ListItemButton onClick={() => toggle(g.groupJid)} disabled={disabled} sx={{ minHeight: 52 }}>
                    <ListItemIcon sx={{ minWidth: 40 }}>
                      <Checkbox
                        edge="start"
                        tabIndex={-1}
                        disableRipple
                        checked={chosen.has(g.groupJid)}
                        slotProps={{ input: { 'aria-labelledby': labelId } }}
                      />
                    </ListItemIcon>
                    <ListItemText
                      id={labelId}
                      primary={<Blurred when={blur} inline radius={5}>{nameOf(g)}</Blurred>}
                      secondary={g.lastScannedAt ? t.lastScan(saverStrings.groups.dateTime(g.lastScannedAt)) : t.neverScanned}
                      slotProps={{ primary: { noWrap: true, sx: { fontWeight: 600 } } }}
                      sx={{ minWidth: 0 }}
                    />
                    {g.saved && (
                      <Tooltip title={t.savedHint}>
                        <Chip size="small" color="success" variant="outlined" icon={<AppIcon icon={CircleCheck} size="sm" />} label={t.saved} sx={{ ml: 1, flexShrink: 0 }} />
                      </Tooltip>
                    )}
                  </ListItemButton>
                </ListItem>
              );
            })}
          </List>
        )}
      </Paper>
    </Box>
  );
}
