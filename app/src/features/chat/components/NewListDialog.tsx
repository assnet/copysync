import { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, Box, Typography,
  List, ListItemButton, ListItemAvatar, ListItemText, Avatar, Checkbox, InputAdornment, Tooltip,
  useMediaQuery, useTheme,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import type { ChatConversation } from '../types';
import { chatStrings } from '../strings';
import { formatPhone } from '../utils';
import { LIST_NAME_MAX_LENGTH, validateListName, type ListNameError } from '../conversationFilters';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Conversas que podem entrar na lista (as carregadas na barra lateral). */
  conversations: ChatConversation[];
  /** Nomes já usados: um nome repetido (sem diferenciar maiúsculas) é recusado. */
  existingLists: string[];
  /** Nome aparado e ids das conversas marcadas. */
  onCreate: (name: string, conversationIds: string[]) => void;
}

const strings = chatStrings.lists.dialog;

function errorMessage(error: ListNameError): string {
  if (error === 'tooLong') return strings.errors.tooLong(LIST_NAME_MAX_LENGTH);
  return strings.errors[error];
}

function displayTitle(c: ChatConversation): string {
  return c.isGroup ? (c.groupName ?? c.contact.name) : c.contact.name;
}

/**
 * Cria uma lista do painel escolhendo as conversas que a compõem.
 *
 * Não há catálogo de listas por tenant: a lista existe enquanto ao menos uma conversa a
 * carrega. Por isso o diálogo exige uma conversa marcada — sem ela a lista sumiria ao fechar.
 */
export function NewListDialog({ open, onClose, conversations, existingLists, onCreate }: Props) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));

  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  // Cada abertura começa limpa: a lista anterior já foi criada ou descartada.
  useEffect(() => {
    if (!open) return;
    setName('');
    setNameTouched(false);
    setSearch('');
    setSelected(new Set());
  }, [open]);

  const nameError = validateListName(name, existingLists);
  const showNameError = nameTouched && nameError !== null;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) => displayTitle(c).toLowerCase().includes(q) || c.contact.phone.includes(q),
    );
  }, [conversations, search]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canCreate = nameError === null && selected.size > 0;

  const handleCreate = () => {
    if (!canCreate) {
      setNameTouched(true);
      return;
    }
    onCreate(name.trim(), [...selected]);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      fullScreen={fullScreen}
      aria-labelledby="new-list-dialog-title"
      aria-describedby="new-list-dialog-intro"
    >
      <DialogTitle id="new-list-dialog-title" sx={{ fontWeight: 700, pb: 0.5 }}>
        {strings.title}
      </DialogTitle>

      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        <Typography id="new-list-dialog-intro" variant="body2" color="text.secondary">
          {strings.intro}
        </Typography>

        <TextField
          label={strings.nameLabel}
          placeholder={strings.namePlaceholder}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setNameTouched(true)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
          autoFocus
          fullWidth
          size="small"
          error={showNameError}
          helperText={showNameError ? errorMessage(nameError) : `${name.trim().length}/${LIST_NAME_MAX_LENGTH}`}
          inputProps={{ maxLength: LIST_NAME_MAX_LENGTH + 20, autoComplete: 'off' }}
        />

        <TextField
          placeholder={strings.searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          fullWidth
          size="small"
          inputProps={{ 'aria-label': strings.searchLabel, autoComplete: 'off' }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 18, color: 'text.disabled' }} />
              </InputAdornment>
            ),
          }}
        />

        <Box
          sx={{
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            maxHeight: { xs: 'none', sm: 280 },
            flex: { xs: 1, sm: 'unset' },
            minHeight: 120,
            overflowY: 'auto',
          }}
        >
          {visible.length === 0 ? (
            <Typography variant="body2" color="text.disabled" sx={{ p: 2, textAlign: 'center' }}>
              {strings.noResults}
            </Typography>
          ) : (
            <List dense disablePadding aria-label={strings.conversationsLabel}>
              {visible.map((c) => {
                const checked = selected.has(c.id);
                const title = displayTitle(c);
                return (
                  <ListItemButton
                    key={c.id}
                    role="checkbox"
                    aria-checked={checked}
                    selected={checked}
                    onClick={() => toggle(c.id)}
                    sx={{ py: 0.75 }}
                  >
                    <Checkbox edge="start" checked={checked} tabIndex={-1} disableRipple size="small" inputProps={{ 'aria-hidden': true }} />
                    <ListItemAvatar sx={{ minWidth: 44 }}>
                      <Avatar
                        sx={{
                          width: 32, height: 32, fontSize: 13, fontWeight: 700,
                          bgcolor: c.isGroup ? 'success.main' : (c.contact.avatarColor ?? 'primary.main'),
                        }}
                        src={c.isGroup ? undefined : (c.contact.avatarUrl ?? undefined)}
                      >
                        {c.isGroup ? <GroupsOutlinedIcon sx={{ fontSize: 18 }} /> : c.contact.initials}
                      </Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      primary={title}
                      secondary={c.isGroup ? strings.group : formatPhone(c.contact.phone)}
                      primaryTypographyProps={{ noWrap: true, fontWeight: checked ? 600 : 500 }}
                      secondaryTypographyProps={{ noWrap: true }}
                    />
                  </ListItemButton>
                );
              })}
            </List>
          )}
        </Box>

        <Typography variant="caption" color={selected.size > 0 ? 'primary.main' : 'text.secondary'} fontWeight={600} role="status">
          {strings.selectedCount(selected.size)}
        </Typography>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit">{strings.cancel}</Button>
        <Tooltip title={canCreate ? '' : strings.createHint}>
          <span>
            <Button variant="contained" disableElevation disabled={!canCreate} onClick={handleCreate}>
              {strings.create}
            </Button>
          </span>
        </Tooltip>
      </DialogActions>
    </Dialog>
  );
}
