import { useMemo, useState } from 'react';
import {
  Alert, Autocomplete, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, IconButton, InputAdornment, List, ListItemButton, ListItemIcon, ListItemText, Skeleton, Stack,
  TextField, Tooltip, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Search, X } from 'lucide-react';
import { AppIcon } from '@/components';
import { GroupAvatar } from '@/features/offers/components/GroupChip';
import { useSessionGroups } from '@/features/offers/hooks/useSessionGroups';
import { Blurred, useBlur } from '@/features/privacy';
import { usePersistedState } from '@/hooks/usePersistedState';
import { monitoringStrings } from '../strings';
import { uiErrorMessage } from '../utils/apiErrors';

const t = monitoringStrings.picker;

export interface PickedGroup {
  groupJid: string;
  title: string | null;
  avatarUrl: string | null;
  keywords: string[];
}

const pick = (g: { title: string | null; avatarUrl: string | null }) => ({ title: g.title, avatarUrl: g.avatarUrl });

export type GroupPickerMode = 'monitored' | 'broadcast';

interface Props {
  mode: GroupPickerMode;
  sessionId: string;
  /** Seleção salva; vira o ponto de partida (um rascunho da aba tem prioridade). */
  initial: PickedGroup[];
  /** Máximo para esta sessão (limite do plano menos o uso das outras). null = sem limite. */
  max: number | null;
  /** Grupos usados na outra lista (origem ≠ destino). */
  excludeJids: readonly string[];
  onClose: () => void;
  /** Lança em erro; a mensagem aparece no diálogo. */
  onSave: (groups: PickedGroup[]) => Promise<void>;
}

/** Limites da API (`MONITOR_LIMITS` em api/src/modules/automation/domain/services/monitorSettings.ts). */
export const KEYWORD_MAX_LENGTH = 40;
export const KEYWORDS_PER_GROUP = 20;

/** Rascunho na aba: só a escolha do usuário. Nome e foto do grupo vêm do servidor (nunca no storage). */
interface DraftGroup {
  groupJid: string;
  keywords: string[];
}

/** Mude ao alterar `DraftGroup`. */
const PICKER_DRAFT_VERSION = 2;

/** Normaliza palavras-chave: sem espaços nas pontas, sem vazias, sem repetidas (ignora caixa), nos limites da API. */
export function normalizeKeywords(words: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of words) {
    if (out.length >= KEYWORDS_PER_GROUP) break;
    const w = raw.trim().slice(0, KEYWORD_MAX_LENGTH);
    const key = w.toLocaleLowerCase('pt-BR');
    if (!w || seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}

/**
 * Escolha de grupos da sessão (busca no servidor). Monte só quando aberto: a seleção é um
 * rascunho persistido na aba por sessão e modo, apagado ao salvar ou cancelar.
 */
export function GroupPickerDialog({ mode, sessionId, initial, max, excludeJids, onClose, onSave }: Props) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const blurNames = useBlur('monitoring.groupNames');
  const [draft, setDraft, clear] = usePersistedState<DraftGroup[]>(
    `monitoring.picker.${mode}.${sessionId}`,
    () => initial.map((g) => ({ groupJid: g.groupJid, keywords: g.keywords })),
    { version: PICKER_DRAFT_VERSION },
  );
  // Nome/foto em memória: os salvos (`initial`), os vistos na busca e os escolhidos nesta tela
  const [seen, setSeen] = useState<Map<string, { title: string | null; avatarUrl: string | null }>>(
    () => new Map(initial.map((g) => [g.groupJid, { title: g.title, avatarUrl: g.avatarUrl }])),
  );
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionIds = useMemo(() => [sessionId], [sessionId]);
  const groups = useSessionGroups(sessionIds, search);
  const metaOf = (jid: string) => seen.get(jid) ?? groups.items.find((g) => g.groupJid === jid) ?? { title: null, avatarUrl: null };
  const selected: PickedGroup[] = draft.map((d) => ({ ...d, ...pick(metaOf(d.groupJid)) }));
  const excluded = useMemo(() => new Set(excludeJids), [excludeJids]);
  const selectedJids = useMemo(() => new Set(draft.map((g) => g.groupJid)), [draft]);
  const full = max !== null && selected.length >= max;
  const available = groups.items.filter((g) => !selectedJids.has(g.groupJid));
  const titleId = `monitoring-picker-${mode}`;

  const close = () => {
    clear();
    onClose();
  };

  const toggle = (g: { groupJid: string; title: string | null; avatarUrl: string | null }) => {
    setError(null);
    setSeen((prev) => (prev.has(g.groupJid) ? prev : new Map(prev).set(g.groupJid, pick(g))));
    setDraft((prev) =>
      prev.some((p) => p.groupJid === g.groupJid)
        ? prev.filter((p) => p.groupJid !== g.groupJid)
        : [...prev, { groupJid: g.groupJid, keywords: [] }],
    );
  };

  const setKeywords = (jid: string, words: string[]) =>
    setDraft((prev) => prev.map((p) => (p.groupJid === jid ? { ...p, keywords: normalizeKeywords(words) } : p)));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(selected);
      clear();
      onClose();
    } catch (err) {
      setError(uiErrorMessage(err, { scope: 'groups' }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={saving ? undefined : close} fullScreen={fullScreen} fullWidth maxWidth="sm" aria-labelledby={titleId}>
      <DialogTitle id={titleId} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ flex: 1 }}>{mode === 'monitored' ? t.monitoredTitle : t.broadcastTitle}</Box>
        <Tooltip title={t.close} arrow>
          <IconButton aria-label={t.close} onClick={close} disabled={saving} edge="end">
            <AppIcon icon={X} size="sm" />
          </IconButton>
        </Tooltip>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}

          <Box>
            <Typography variant="overline" color="text.secondary">{t.selected(selected.length, max)}</Typography>
            {mode === 'broadcast' && selected.length > 0 && (
              <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>{t.orderHelp}</Typography>
            )}
            <Stack spacing={1}>
              {selected.map((g, i) => (
                <Box key={g.groupJid} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.25 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                    {mode === 'broadcast' && (
                      <Typography variant="caption" sx={{ fontWeight: 700, minWidth: 22, color: 'text.secondary' }}>
                        {monitoringStrings.groups.position(i + 1)}
                      </Typography>
                    )}
                    <GroupAvatar title={g.title} avatarUrl={g.avatarUrl} size={32} blurFlag="monitoring.groupAvatars" />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Blurred when={blurNames} inline radius={5}>
                        <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{g.title || monitoringStrings.groups.untitled}</Typography>
                      </Blurred>
                    </Box>
                    <Tooltip title={monitoringStrings.groups.remove} arrow>
                      <IconButton size="small" aria-label={monitoringStrings.groups.remove} onClick={() => toggle(g)}>
                        <AppIcon icon={X} size="sm" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                  {mode === 'monitored' && (
                    <Autocomplete
                      multiple
                      freeSolo
                      size="small"
                      options={[]}
                      value={g.keywords}
                      onChange={(_e, words) => setKeywords(g.groupJid, words as string[])}
                      renderTags={(value, getTagProps) =>
                        value.map((w, idx) => {
                          const { key, ...tag } = getTagProps({ index: idx });
                          return <Chip key={key} size="small" label={w} {...tag} />;
                        })
                      }
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label={t.keywords}
                          placeholder={g.keywords.length === 0 ? t.keywordsPlaceholder : undefined}
                          inputProps={{
                            ...params.inputProps,
                            maxLength: KEYWORD_MAX_LENGTH,
                            disabled: g.keywords.length >= KEYWORDS_PER_GROUP,
                            'aria-describedby': `${titleId}-kw-${i}`,
                          }}
                          helperText={
                            <Box component="span" id={`${titleId}-kw-${i}`} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                              <span>
                                {g.keywords.length >= KEYWORDS_PER_GROUP
                                  ? t.keywordsFull(KEYWORDS_PER_GROUP)
                                  : i === 0 ? `${t.keywordsHelp} ${t.keywordTooLong(KEYWORD_MAX_LENGTH)}` : t.keywordTooLong(KEYWORD_MAX_LENGTH)}
                              </span>
                              <Box component="span" sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                                {t.keywordsCounter(g.keywords.length, KEYWORDS_PER_GROUP)}
                              </Box>
                            </Box>
                          }
                        />
                      )}
                      sx={{ mt: 1.25 }}
                    />
                  )}
                </Box>
              ))}
            </Stack>
          </Box>

          <TextField
            size="small"
            label={t.search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><AppIcon icon={Search} size="sm" /></InputAdornment> } }}
          />

          <Box>
            <Typography variant="overline" color="text.secondary">{t.available}</Typography>
            {groups.partial && <Alert severity="info" sx={{ mb: 1 }}>{t.partial}</Alert>}
            {groups.failed ? (
              <Alert severity="error" action={<Button color="inherit" size="small" onClick={groups.retry}>{t.retry}</Button>}>{t.loadError}</Alert>
            ) : groups.loading && groups.items.length === 0 ? (
              <Stack spacing={1}>{[0, 1, 2].map((k) => <Skeleton key={k} variant="rounded" height={44} />)}</Stack>
            ) : available.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>{t.noResults}</Typography>
            ) : (
              <List dense disablePadding>
                {available.map((g) => {
                  const usedElsewhere = excluded.has(g.groupJid);
                  const disabled = usedElsewhere || full;
                  const reason = usedElsewhere
                    ? (mode === 'monitored' ? t.usedElsewhereMonitored : t.usedElsewhereBroadcast)
                    : full ? t.limitReached : '';
                  return (
                    <Tooltip key={g.groupJid} title={reason} arrow placement="top">
                      <Box component="li" sx={{ listStyle: 'none' }}>
                        <ListItemButton disabled={disabled} onClick={() => toggle(g)} sx={{ borderRadius: 1.5 }}>
                          <ListItemIcon sx={{ minWidth: 36 }}>
                            <Checkbox edge="start" checked={false} tabIndex={-1} disableRipple inputProps={{ 'aria-hidden': true }} />
                          </ListItemIcon>
                          <Box sx={{ mr: 1.25 }}>
                            <GroupAvatar title={g.title} avatarUrl={g.avatarUrl} size={28} blurFlag="monitoring.groupAvatars" />
                          </Box>
                          <ListItemText
                            primary={<Blurred when={blurNames} inline radius={5}>{g.title || monitoringStrings.groups.untitled}</Blurred>}
                            primaryTypographyProps={{ noWrap: true }}
                          />
                        </ListItemButton>
                      </Box>
                    </Tooltip>
                  );
                })}
              </List>
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={close} disabled={saving}>{t.cancel}</Button>
        <Button
          variant="contained"
          onClick={() => void save()}
          disabled={saving || (max !== null && selected.length > max)}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {t.save}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
