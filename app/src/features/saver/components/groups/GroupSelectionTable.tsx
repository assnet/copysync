import { useMemo } from 'react';
import {
  Box, Checkbox, Chip, InputAdornment, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Paper, TextField,
  Tooltip, Typography,
} from '@mui/material';
import { CircleCheck, Megaphone, Search, UsersRound } from 'lucide-react';
import { AppIcon } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { saverStrings } from '../../strings';
import type { SaverSessionGroup } from '../../types';
import { CopyGroupNameButton } from './CopyGroupNameButton';

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
const KIND_ICON = { COMMUNITY: UsersRound, COMMUNITY_ANNOUNCE: Megaphone } as const;

function KindBadge({ kind }: { kind: SaverSessionGroup['kind'] }) {
  if (kind === 'GROUP') return null;
  return (
    <Tooltip title={t.kindHint[kind]}>
      <Chip
        size="small"
        variant="outlined"
        color={kind === 'COMMUNITY_ANNOUNCE' ? 'info' : 'default'}
        icon={<AppIcon icon={KIND_ICON[kind]} size="sm" />}
        label={t.kind[kind]}
        tabIndex={0}
        sx={{ ml: 1, flexShrink: 0 }}
      />
    </Tooltip>
  );
}

function MembersText({ count }: { count: number | null }) {
  if (count !== null) return <>{t.members(count)}</>;
  return (
    <Tooltip title={t.membersUnknown}>
      <Box component="span" tabIndex={0} aria-label={t.membersUnknown}>{t.members(null)}</Box>
    </Tooltip>
  );
}

/** Grupos ao vivo da sessão: busca, marcar/desmarcar, membros, comunidade, copiar nome e o que já foi lido. */
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

  const pickable = visible.filter((g) => g.selectable);
  const allVisible = pickable.length > 0 && pickable.every((g) => chosen.has(g.groupJid));
  const someVisible = pickable.some((g) => chosen.has(g.groupJid));
  const toggle = (jid: string) =>
    onSelectedChange(chosen.has(jid) ? selected.filter((j) => j !== jid) : [...selected, jid]);
  const toggleAll = () => {
    const ids = new Set(pickable.map((g) => g.groupJid));
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
            disabled={disabled || pickable.length === 0}
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
              const reason = g.unselectableReason ? t.unselectable[g.unselectableReason] : null;
              const scan = g.lastScannedAt ? t.lastScan(saverStrings.groups.dateTime(g.lastScannedAt)) : t.neverScanned;
              return (
                <ListItem
                  key={g.groupJid}
                  disablePadding
                  divider
                  secondaryAction={g.name?.trim() ? <CopyGroupNameButton name={g.name.trim()} hideName={blur} /> : undefined}
                >
                  <ListItemButton onClick={() => toggle(g.groupJid)} disabled={disabled || !g.selectable} sx={{ minHeight: 52 }}>
                    <ListItemIcon sx={{ minWidth: 40 }}>
                      <Checkbox
                        edge="start"
                        tabIndex={-1}
                        disableRipple
                        checked={g.selectable && chosen.has(g.groupJid)}
                        slotProps={{ input: { 'aria-labelledby': labelId } }}
                      />
                    </ListItemIcon>
                    <ListItemText
                      id={labelId}
                      primary={<Blurred when={blur} inline radius={5}>{nameOf(g)}</Blurred>}
                      secondary={reason ?? <><MembersText count={g.memberCount} />{' · '}{scan}</>}
                      slotProps={{ primary: { noWrap: true, sx: { fontWeight: 600 } } }}
                      sx={{ minWidth: 0 }}
                    />
                    <KindBadge kind={g.kind} />
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
