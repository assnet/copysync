import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment,
  List, ListItemAvatar, ListItemButton, ListItemText, MenuItem, Skeleton, Stack, TextField, Tooltip, Typography,
  useMediaQuery, useTheme,
} from '@mui/material';
import { CircleCheck, Search, X } from 'lucide-react';
import { AppIcon, UnavailableReason } from '@/components';
import { usePersistedState } from '@/hooks/usePersistedState';
import { Blurred, useBlur } from '@/features/privacy';
import { GroupAvatar } from '@/features/offers/components/GroupChip';
import { useSessionGroups } from '@/features/offers/hooks/useSessionGroups';
import type { SessionGroupWithSession, SessionItem } from '@/types/api.types';
import { offerHunterErrorMessage, offerHunterStrings } from '../../strings';
import type { HunterSettings, SaveHunterSettingsInput } from '../../types';

const t = offerHunterStrings.home.destinationPicker;
const td = offerHunterStrings.destination;

interface Draft {
  sessionId: string | null;
  conversationId: string | null;
  search: string;
}
const EMPTY: Draft = { sessionId: null, conversationId: null, search: '' };

export interface DestinationPickerDialogProps {
  open: boolean;
  current: HunterSettings | null;
  sessions: SessionItem[];
  sessionsLoading: boolean;
  sessionsFailed: boolean;
  onRetrySessions: () => void;
  onClose: () => void;
  /** Rejeita com o erro do `apiClient` (mensagem por código na tela). */
  onSave: (body: SaveHunterSettingsInput) => Promise<void>;
}

/** Motivo de o grupo não poder ser o destino: sem conversa no chat (a API exige `conversationId`) ou sem permissão de postar. */
function blockedReason(g: SessionGroupWithSession): string | null {
  if (!g.conversationId) return t.noConversation;
  if (g.canPost === false) return g.postBlockedReason === 'CHANNEL_READONLY' ? t.readOnly : t.adminsOnly;
  return null;
}

/** Sessão + grupo do destino. Rascunho (sessão, grupo, busca) em `usePersistedState`, limpo ao salvar/cancelar. */
export function DestinationPickerDialog({
  open, current, sessions, sessionsLoading, sessionsFailed, onRetrySessions, onClose, onSave,
}: DestinationPickerDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const blurSession = useBlur('offerHunter.sessionName');
  const blurGroup = useBlur('offerHunter.groupNames');
  const [draft, setDraft, clearDraft] = usePersistedState<Draft>('offerHunter.destinationDraft', EMPTY, { scope: 'tab', version: 1 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connected = useMemo(() => sessions.filter((s) => s.status === 'CONNECTED'), [sessions]);

  // Ao abrir sem rascunho: parte do destino atual (ou da única sessão conectada).
  useEffect(() => {
    if (!open || draft.sessionId) return;
    const start = current?.sessionId ?? (connected.length === 1 ? connected[0]!.id : null);
    if (start) setDraft({ sessionId: start, conversationId: current?.conversationId ?? null, search: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, current?.sessionId, connected.length]);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const ids = useMemo(() => (open && draft.sessionId ? [draft.sessionId] : []), [open, draft.sessionId]);
  const groups = useSessionGroups(ids, draft.search);

  const close = () => {
    clearDraft();
    onClose();
  };

  const save = async () => {
    if (!draft.sessionId || !draft.conversationId) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({ sessionId: draft.sessionId, conversationId: draft.conversationId });
      clearDraft();
    } catch (err) {
      setError(offerHunterErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const unchanged = draft.sessionId === current?.sessionId && draft.conversationId === current?.conversationId;

  return (
    <Dialog open={open} onClose={saving ? undefined : close} fullWidth maxWidth="sm" fullScreen={fullScreen} aria-labelledby="hunter-destination-picker">
      <DialogTitle id="hunter-destination-picker" sx={{ fontWeight: 700, pr: 6 }}>
        {t.title}
        <Typography variant="body2" color="text.secondary">{t.subtitle}</Typography>
      </DialogTitle>
      <Tooltip title={t.close} describeChild>
        <span style={{ position: 'absolute', top: 12, right: 12 }}>
          <IconButton size="small" onClick={close} aria-label={t.close} disabled={saving}>
            <AppIcon icon={X} size="md" />
          </IconButton>
        </span>
      </Tooltip>

      <DialogContent dividers>
        <Stack spacing={2}>
          {sessionsFailed ? (
            <Alert severity="error" action={<Button color="inherit" size="small" onClick={onRetrySessions}>{t.retry}</Button>}>
              {t.sessionsFailed}
            </Alert>
          ) : !sessionsLoading && connected.length === 0 ? (
            <Alert severity="info" variant="outlined">{t.noSessions}</Alert>
          ) : (
            <TextField
              select
              label={t.session}
              value={draft.sessionId ?? ''}
              onChange={(e) => setDraft({ sessionId: e.target.value || null, conversationId: null, search: '' })}
              disabled={sessionsLoading || saving}
              helperText={sessionsLoading ? t.sessionsLoading : undefined}
              fullWidth
              SelectProps={{
                renderValue: (v) => {
                  const s = sessions.find((x) => x.id === v);
                  return <Blurred when={blurSession} inline radius={5}>{s?.name || td.unnamedSession}</Blurred>;
                },
              }}
            >
              {sessions.map((s) => (
                <MenuItem key={s.id} value={s.id} disabled={s.status !== 'CONNECTED'}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, width: '100%' }}>
                    <Box sx={{ minWidth: 0, flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <Blurred when={blurSession} inline radius={5}>{s.name || td.unnamedSession}</Blurred>
                    </Box>
                    {s.status !== 'CONNECTED' && <Typography variant="caption" color="text.secondary">{t.disconnected}</Typography>}
                  </Stack>
                </MenuItem>
              ))}
            </TextField>
          )}

          {draft.sessionId && (
            <>
              <TextField
                label={t.search}
                placeholder={t.searchPlaceholder}
                value={draft.search}
                onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value }))}
                disabled={saving}
                fullWidth
                InputProps={{ startAdornment: <InputAdornment position="start"><AppIcon icon={Search} size="sm" /></InputAdornment> }}
              />
              {groups.partial && <Alert severity="info" variant="outlined">{t.partial}</Alert>}
              {groups.failed ? (
                <Alert severity="error" action={<Button color="inherit" size="small" onClick={groups.retry}>{t.retry}</Button>}>
                  {t.groupsFailed}
                </Alert>
              ) : groups.loading && groups.items.length === 0 ? (
                <Stack spacing={1} role="status" aria-label={t.groupsLoading}>
                  {[0, 1, 2].map((i) => (
                    <Stack key={i} direction="row" spacing={1.5} alignItems="center">
                      <Skeleton variant="circular" width={36} height={36} />
                      <Skeleton width="55%" />
                    </Stack>
                  ))}
                </Stack>
              ) : groups.items.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>{t.groupsEmpty}</Typography>
              ) : (
                <List dense disablePadding aria-label={td.group} sx={{ maxHeight: { xs: 'none', sm: 340 }, overflowY: 'auto', mx: -1 }}>
                  {groups.items.map((g) => {
                    const reason = blockedReason(g);
                    const selected = g.conversationId !== null && g.conversationId === draft.conversationId;
                    const name = g.title || td.unnamedGroup;
                    return (
                      <ListItemButton
                        key={g.groupJid}
                        selected={selected}
                        disabled={Boolean(reason) || saving}
                        onClick={() => setDraft((d) => ({ ...d, conversationId: g.conversationId }))}
                        aria-pressed={selected}
                        sx={{ borderRadius: 1.5 }}
                      >
                        <ListItemAvatar sx={{ minWidth: 48 }}>
                          <GroupAvatar title={g.title} avatarUrl={g.avatarUrl} size={36} blurFlag="offerHunter.groupAvatars" />
                        </ListItemAvatar>
                        <ListItemText
                          primary={<Blurred when={blurGroup} inline radius={5}>{name}</Blurred>}
                          secondary={reason ? <UnavailableReason text={reason} /> : null}
                          secondaryTypographyProps={{ component: 'div' }}
                          primaryTypographyProps={{ noWrap: true, fontWeight: selected ? 700 : 500 }}
                        />
                        {selected && (
                          <Box sx={{ color: 'primary.main', display: 'inline-flex', ml: 1 }}>
                            <AppIcon icon={CircleCheck} size="md" label={t.selected} />
                          </Box>
                        )}
                      </ListItemButton>
                    );
                  })}
                </List>
              )}
            </>
          )}

          {error && <Alert severity="error" aria-live="polite">{error}</Alert>}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={close} disabled={saving}>{t.cancel}</Button>
        <Button
          variant="contained"
          onClick={() => void save()}
          disabled={!draft.sessionId || !draft.conversationId || saving || unchanged}
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          {saving ? td.saving : td.save}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
