import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Avatar, Box, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, InputAdornment, List, ListItem, ListItemAvatar, ListItemButton, ListItemIcon, ListItemText,
  Switch, TextField, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import type { OfferDestinationItem } from '@/types/api.types';
import { offerStrings } from '../strings';
import { useConversationPicker, type PickerConversation } from '../hooks/useConversationPicker';
import type { OfferErrorView } from '../utils/offerErrors';

const t = offerStrings.destinations;

interface Props {
  open: boolean;
  current: OfferDestinationItem[];
  onClose: () => void;
  onSave: (conversationIds: string[]) => Promise<void>;
}

const fromDestination = (d: OfferDestinationItem): PickerConversation => ({
  id: d.conversationId,
  title: d.title,
  isGroup: d.isGroup,
  sessionName: d.sessionName ?? null,
});

export function OfferDestinationsDialog({ open, current, onClose, onSave }: Props) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [search, setSearch] = useState('');
  const [onlyGroups, setOnlyGroups] = useState(true);
  const [selected, setSelected] = useState<Map<string, PickerConversation>>(new Map());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { items, loading, failed, retry } = useConversationPicker(open, search, onlyGroups);

  useEffect(() => {
    if (!open) return;
    setSelected(new Map(current.map((d) => [d.conversationId, fromDestination(d)])));
    setSaveError(null);
    setSearch('');
  }, [open, current]);

  // Sem busca, os já marcados que não vieram na lista aparecem no topo para poder desmarcar.
  const rows = useMemo(() => {
    if (search.trim()) return items;
    const visible = new Set(items.map((i) => i.id));
    const extra = [...selected.values()].filter((s) => !visible.has(s.id) && (!onlyGroups || s.isGroup));
    return [...extra, ...items];
  }, [items, selected, search, onlyGroups]);

  const allVisibleSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someVisibleSelected = rows.some((r) => selected.has(r.id));

  const toggle = (row: PickerConversation) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(row.id)) next.delete(row.id);
      else next.set(row.id, row);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (allVisibleSelected) rows.forEach((r) => next.delete(r.id));
      else rows.forEach((r) => next.set(r.id, r));
      return next;
    });

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave([...selected.keys()]);
      onClose();
    } catch (err) {
      setSaveError((err as OfferErrorView).message ?? offerStrings.errors.generic);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      fullScreen={fullScreen}
      aria-labelledby="offer-destinations-title"
    >
      <DialogTitle id="offer-destinations-title" sx={{ pb: 0.5 }}>
        {t.dialogTitle}
        <Typography variant="body2" color="text.secondary">{t.dialogSubtitle}</Typography>
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: '12px !important' }}>
        <TextField
          fullWidth
          label={t.searchLabel}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                </InputAdornment>
              ),
            },
          }}
        />
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={allVisibleSelected}
                indeterminate={!allVisibleSelected && someVisibleSelected}
                onChange={toggleAll}
                disabled={rows.length === 0}
              />
            }
            label={t.selectAll}
          />
          <FormControlLabel
            control={<Switch checked={onlyGroups} onChange={(e) => setOnlyGroups(e.target.checked)} />}
            label={t.onlyGroups}
          />
        </Box>

        {failed ? (
          <Alert
            severity="error"
            action={<Button color="inherit" size="small" onClick={retry}>{t.retry}</Button>}
          >
            {t.loadError}
          </Alert>
        ) : loading && rows.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={28} aria-label={t.dialogTitle} />
          </Box>
        ) : rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>{t.empty}</Typography>
        ) : (
          <List
            dense
            sx={{ border: 1, borderColor: 'divider', borderRadius: 2, maxHeight: { xs: 'none', sm: 360 }, overflowY: 'auto', py: 0 }}
            aria-busy={loading}
          >
            {rows.map((row) => {
              const checked = selected.has(row.id);
              const labelId = `offer-dest-${row.id}`;
              return (
                <ListItem key={row.id} disablePadding divider>
                  <ListItemButton onClick={() => toggle(row)} selected={checked} sx={{ minHeight: 48 }}>
                    <ListItemIcon sx={{ minWidth: 40 }}>
                      <Checkbox
                        edge="start"
                        checked={checked}
                        tabIndex={-1}
                        disableRipple
                        slotProps={{ input: { 'aria-labelledby': labelId } }}
                      />
                    </ListItemIcon>
                    <ListItemAvatar sx={{ minWidth: 44 }}>
                      <Avatar sx={{ width: 32, height: 32, bgcolor: 'action.selected', color: 'text.secondary' }}>
                        {row.isGroup ? <GroupsOutlinedIcon fontSize="small" /> : <PersonOutlineIcon fontSize="small" />}
                      </Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      id={labelId}
                      primary={row.title || t.untitled}
                      secondary={[row.isGroup ? t.group : t.contact, row.sessionName].filter(Boolean).join(' · ')}
                      slotProps={{ primary: { noWrap: true } }}
                    />
                  </ListItemButton>
                </ListItem>
              );
            })}
          </List>
        )}

        {saveError && <Alert severity="error">{saveError}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
        <Typography variant="body2" color="text.secondary" role="status">{t.selectedCount(selected.size)}</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button color="inherit" onClick={onClose} disabled={saving}>{t.cancel}</Button>
          <Button
            variant="contained"
            disableElevation
            onClick={() => void save()}
            disabled={saving}
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {saving ? t.saving : t.save}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}
