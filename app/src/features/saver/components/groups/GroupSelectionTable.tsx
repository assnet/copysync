import { useMemo } from 'react';
import {
  Box, Button, Checkbox, Chip, InputAdornment, List, ListItem, ListItemButton, Paper, TextField, ToggleButton,
  ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import { ChevronDown, CircleCheck, Info, Megaphone, Search, UsersRound } from 'lucide-react';
import { AppIcon, OverflowTooltipText } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { saverStrings } from '../../strings';
import type { SaverSessionGroup } from '../../types';
import {
  GROUP_FILTERS, GROUP_PAGE_SIZE, GROUP_SORTS, countByFilter, searchGroups, visibleGroups,
  type GroupFilter, type GroupSort,
} from '../../groupList';
import { CopyGroupNameButton } from './CopyGroupNameButton';
import { SaverGroupAvatar } from './SaverGroupAvatar';
import { selectedRowSx } from '../../saverStyle';

const t = saverStrings.groups.table;

interface Props {
  groups: SaverSessionGroup[];
  selected: string[];
  onSelectedChange: (jids: string[]) => void;
  search: string;
  onSearchChange: (value: string) => void;
  filter: GroupFilter;
  onFilterChange: (value: GroupFilter) => void;
  sort: GroupSort;
  onSortChange: (value: GroupSort) => void;
  /** Quantos grupos aparecem (cresce de 50 em 50). */
  shown: number;
  onShownChange: (value: number) => void;
  disabled?: boolean;
}

const nameOf = (g: SaverSessionGroup) => g.name?.trim() || t.untitledGroup;
const KIND_ICON = { COMMUNITY: UsersRound, COMMUNITY_ANNOUNCE: Megaphone } as const;

/** Selo do tipo (comunidade / avisos). Também usado na lista de grupos salvos. */
export function KindBadge({ kind }: { kind: SaverSessionGroup['kind'] }) {
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
        sx={{ flexShrink: 0 }}
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

/**
 * Grupos ao vivo da sessão: busca, filtros rápidos, ordenação e "Mostrar mais" (50 por vez).
 * Sem rolagem própria: a lista cresce na página, que é a única rolagem da tela.
 */
export function GroupSelectionTable({
  groups, selected, onSelectedChange, search, onSearchChange, filter, onFilterChange, sort, onSortChange,
  shown, onShownChange, disabled,
}: Props) {
  const blur = useBlur('saver.groupNames');
  const chosen = useMemo(() => new Set(selected), [selected]);
  const searched = useMemo(() => searchGroups(groups, search, t.untitledGroup), [groups, search]);
  const counts = useMemo(() => countByFilter(searched), [searched]);
  const { filtered, page } = useMemo(
    () => visibleGroups(groups, search, filter, sort, shown, t.untitledGroup),
    [groups, search, filter, sort, shown],
  );

  if (groups.length === 0) {
    return <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>{t.empty}</Typography>;
  }

  const limit = Math.max(GROUP_PAGE_SIZE, shown);
  const rest = filtered.length - page.length;
  const pickable = page.filter((g) => g.selectable);
  const allVisible = pickable.length > 0 && pickable.every((g) => chosen.has(g.groupJid));
  const someVisible = pickable.some((g) => chosen.has(g.groupJid));
  const toggle = (jid: string) =>
    onSelectedChange(chosen.has(jid) ? selected.filter((j) => j !== jid) : [...selected, jid]);
  const toggleAll = () => {
    const ids = new Set(pickable.map((g) => g.groupJid));
    onSelectedChange(allVisible ? selected.filter((j) => !ids.has(j)) : [...new Set([...selected, ...ids])]);
  };
  const changeSearch = (value: string) => { onSearchChange(value); onShownChange(GROUP_PAGE_SIZE); };
  const changeFilter = (value: GroupFilter) => { onFilterChange(value); onShownChange(GROUP_PAGE_SIZE); };
  const reset = () => { changeSearch(''); onFilterChange('all'); };

  return (
    <Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
        <TextField
          size="small"
          placeholder={t.search}
          value={search}
          onChange={(e) => changeSearch(e.target.value)}
          sx={{ flex: '1 1 240px', minWidth: 0 }}
          slotProps={{
            htmlInput: { 'aria-label': t.searchAria },
            input: { startAdornment: <InputAdornment position="start"><AppIcon icon={Search} size="sm" /></InputAdornment> },
          }}
        />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="body2" color="text.secondary" id="saver-group-sort">{t.sortLabel}</Typography>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={sort}
            onChange={(_, v: GroupSort | null) => { if (v) onSortChange(v); }}
            aria-labelledby="saver-group-sort"
          >
            {GROUP_SORTS.map((x) => (
              <ToggleButton key={x} value={x} sx={{ px: 1.5, textTransform: 'none' }}>{t.sort[x]}</ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>
      </Box>

      <Box role="group" aria-label={t.filtersAria} sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
        {GROUP_FILTERS.map((f) => {
          const active = filter === f;
          return (
            <Tooltip key={f} title={t.filterHints[f]} describeChild>
              <Chip
                clickable
                color={active ? 'primary' : 'default'}
                variant={active ? 'filled' : 'outlined'}
                aria-pressed={active}
                onClick={() => changeFilter(f)}
                label={(
                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'baseline', gap: 0.75 }}>
                    {t.filters[f]}{' '}
                    <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums', opacity: 0.72, fontSize: '0.8em' }}>
                      {counts[f].toLocaleString('pt-BR')}
                    </Box>
                  </Box>
                )}
              />
            </Tooltip>
          );
        })}
      </Box>

      <Paper variant="outlined" sx={{ borderRadius: 2 }}>
        <Box
          sx={{
            display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.5,
            borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover',
            borderTopLeftRadius: 'inherit', borderTopRightRadius: 'inherit',
          }}
        >
          <Tooltip title={t.selectAll}>
            <Checkbox
              checked={allVisible}
              indeterminate={!allVisible && someVisible}
              onChange={toggleAll}
              disabled={disabled || pickable.length === 0}
              slotProps={{ input: { 'aria-label': t.selectAll } }}
            />
          </Tooltip>
          <Typography variant="body2" color="text.secondary" aria-live="polite">
            {t.showing(page.length, filtered.length)}
          </Typography>
        </Box>

        {filtered.length === 0 ? (
          <Box sx={{ py: 4, px: 2, textAlign: 'center' }}>
            <Typography color="text.secondary">{search.trim() ? t.noMatch : t.noMatchFilter}</Typography>
            <Button size="small" onClick={reset} sx={{ mt: 1 }}>{t.resetFilters}</Button>
          </Box>
        ) : (
          <List disablePadding aria-label={saverStrings.groups.session.title}>
            {page.map((g, i) => {
              const labelId = `saver-group-${g.groupJid}`;
              const reason = g.unselectableReason ? t.unselectable[g.unselectableReason] : null;
              const scan = g.lastScannedAt ? t.lastScan(saverStrings.groups.dateTime(g.lastScannedAt)) : t.neverScanned;
              const isOn = g.selectable && chosen.has(g.groupJid);
              const realName = g.name?.trim();
              return (
                <ListItem
                  key={g.groupJid}
                  disablePadding
                  divider={i < page.length - 1}
                  sx={(theme) => ({ alignItems: 'stretch', ...(isOn && selectedRowSx(theme)) })}
                >
                  <ListItemButton
                    onClick={() => toggle(g.groupJid)}
                    disabled={disabled || !g.selectable}
                    sx={{ gap: 1.5, py: 1.25, pl: 1, pr: 0.5, alignItems: 'center', '&.Mui-disabled': { opacity: 1 } }}
                  >
                    <Checkbox
                      edge="start"
                      tabIndex={-1}
                      disableRipple
                      checked={isOn}
                      disabled={!g.selectable}
                      sx={{ ml: 0, p: 0.75 }}
                      slotProps={{ input: { 'aria-label': blur ? t.selectGroup : `${t.selectGroup}: ${nameOf(g)}` } }}
                    />
                    <Box sx={{ opacity: g.selectable ? 1 : 0.55, display: 'flex' }}>
                      <SaverGroupAvatar name={nameOf(g)} size={40} />
                    </Box>
                    <Box
                      sx={{
                        flex: 1, minWidth: 0, display: 'flex', gap: { xs: 0.75, sm: 1.5 },
                        flexDirection: { xs: 'column', sm: 'row' }, alignItems: { xs: 'flex-start', sm: 'center' },
                      }}
                    >
                      <Box sx={{ flex: 1, minWidth: 0, width: '100%' }}>
                        <OverflowTooltipText
                          text={nameOf(g)}
                          disabled={blur}
                          focusable={false}
                          typographyProps={{
                            id: labelId,
                            variant: 'body2',
                            sx: { fontWeight: 600, color: g.selectable ? 'text.primary' : 'text.secondary' },
                          }}
                        >
                          <Blurred when={blur} inline radius={5}>{nameOf(g)}</Blurred>
                        </OverflowTooltipText>
                        {reason ? (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                            <AppIcon icon={Info} size="inline" />
                            {reason}
                          </Typography>
                        ) : (
                          <Typography variant="caption" color="text.secondary" component="p" sx={{ m: 0 }}>
                            <MembersText count={g.memberCount} />{' · '}{scan}
                          </Typography>
                        )}
                      </Box>
                      {(g.kind !== 'GROUP' || g.saved) && (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, flexShrink: 0 }}>
                          <KindBadge kind={g.kind} />
                          {g.saved && (
                            <Tooltip title={t.savedHint}>
                              <Chip size="small" color="success" variant="outlined" icon={<AppIcon icon={CircleCheck} size="sm" />} label={t.saved} />
                            </Tooltip>
                          )}
                        </Box>
                      )}
                    </Box>
                  </ListItemButton>
                  <Box sx={{ display: 'flex', alignItems: 'center', px: 0.5 }}>
                    {realName ? <CopyGroupNameButton name={realName} hideName={blur} /> : <Box sx={{ width: 34 }} />}
                  </Box>
                </ListItem>
              );
            })}
          </List>
        )}
      </Paper>

      {rest > 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1.5 }}>
          <Button
            variant="outlined"
            startIcon={<AppIcon icon={ChevronDown} size="sm" />}
            onClick={() => onShownChange(limit + GROUP_PAGE_SIZE)}
            sx={{ width: { xs: '100%', sm: 'auto' } }}
          >
            {t.showMore(Math.min(GROUP_PAGE_SIZE, rest))}
          </Button>
        </Box>
      )}
    </Box>
  );
}
