import { useMemo, useRef, useState } from 'react';
import {
  Alert, Autocomplete, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, IconButton, InputAdornment, List, ListItemButton, ListItemIcon, ListItemText, Skeleton, Stack,
  TextField, Tooltip, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Link as RouterLink } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { AppIcon } from '@/components';
import { GroupAvatar } from '@/features/offers/components/GroupChip';
import { useSessionGroups } from '@/features/offers/hooks/useSessionGroups';
import { Blurred, useBlur } from '@/features/privacy';
import { usePersistedState } from '@/hooks/usePersistedState';
import type { SessionItem } from '@/types/api.types';
import { monitoringStrings } from '../strings';
import { uiErrorMessage } from '../utils/apiErrors';

const t = monitoringStrings.picker;

export interface PickedGroup {
  groupJid: string;
  /** Sessão dona do grupo (monitorado: a do monitor; disparo: pode ser outra, sessão cruzada). */
  sessionId: string;
  title: string | null;
  avatarUrl: string | null;
  keywords: string[];
}

const keyOf = (g: { sessionId: string; groupJid: string }) => `${g.sessionId}:${g.groupJid}`;

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
  /** Disparo: sessões do tenant; com `crossSession`, os grupos de todas as conectadas entram. */
  sessions?: readonly SessionItem[];
  /** Entitlement `cross_session_dispatch`. Sem ele, só a sessão atual; com 2+ sessões mostra o aviso do plano. */
  crossSession?: boolean;
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
  sessionId: string;
  keywords: string[];
}

/** Mude ao alterar `DraftGroup`. */
const PICKER_DRAFT_VERSION = 3;

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
export function GroupPickerDialog({ mode, sessionId, initial, max, excludeJids, sessions, crossSession = false, onClose, onSave }: Props) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const blurNames = useBlur('monitoring.groupNames');
  const [draft, setDraft, clear] = usePersistedState<DraftGroup[]>(
    `monitoring.picker.${mode}.${sessionId}`,
    () => initial.map((g) => ({ groupJid: g.groupJid, sessionId: g.sessionId, keywords: g.keywords })),
    { version: PICKER_DRAFT_VERSION },
  );
  const draftRef = useRef(draft);
  draftRef.current = draft;
  // Nome/foto em memória: os salvos (`initial`), os vistos na busca e os escolhidos nesta tela
  const [seen, setSeen] = useState<Map<string, { title: string | null; avatarUrl: string | null }>>(
    () => new Map(initial.map((g) => [keyOf(g), { title: g.title, avatarUrl: g.avatarUrl }])),
  );
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Disparo com sessão cruzada: grupos de todas as sessões conectadas; senão, só a sessão atual
  const multi = mode === 'broadcast' && crossSession && (sessions?.length ?? 0) > 1;
  const sessionIds = useMemo(
    () => (multi ? sessions!.filter((s) => s.status === 'CONNECTED').map((s) => s.id) : [sessionId]),
    [multi, sessions, sessionId],
  );
  const sessionName = (id: string) => sessions?.find((s) => s.id === id)?.name || t.sessionOf(id.slice(-4));
  const crossLocked = mode === 'broadcast' && !crossSession && (sessions?.length ?? 0) > 1;
  const groups = useSessionGroups(sessionIds, search);
  const metaOf = (g: { sessionId: string; groupJid: string }) =>
    seen.get(keyOf(g)) ?? groups.items.find((x) => x.groupJid === g.groupJid && x.sessionId === g.sessionId) ?? { title: null, avatarUrl: null };
  const selected: PickedGroup[] = draft.map((d) => ({ ...d, ...pick(metaOf(d)) }));
  const excluded = useMemo(() => new Set(excludeJids), [excludeJids]);
  const selectedKeys = useMemo(() => new Set(draft.map(keyOf)), [draft]);
  const full = max !== null && selected.length >= max;
  const available = groups.items.filter((g) => !selectedKeys.has(keyOf(g)));
  const titleId = `monitoring-picker-${mode}`;

  const close = () => {
    clear();
    onClose();
  };

  const toggle = (g: { groupJid: string; sessionId: string; title: string | null; avatarUrl: string | null }) => {
    setError(null);
    setSeen((prev) => (prev.has(keyOf(g)) ? prev : new Map(prev).set(keyOf(g), pick(g))));
    setDraft((prev) =>
      prev.some((p) => keyOf(p) === keyOf(g))
        ? prev.filter((p) => keyOf(p) !== keyOf(g))
        : [...prev, { groupJid: g.groupJid, sessionId: g.sessionId, keywords: [] }],
    );
  };

  const setKeywords = (key: string, words: string[]) =>
    setDraft((prev) => prev.map((p) => (keyOf(p) === key ? { ...p, keywords: normalizeKeywords(words) } : p)));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const sent = draft;
      await onSave(selected);
      // Mexeu durante o salvar: mantém aberto com a alteração para salvar de novo
      if (draftRef.current !== sent) return;
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
          {crossLocked && (
            <Alert severity="info" action={<Button color="inherit" size="small" component={RouterLink} to="/plans">{t.crossLockedLink}</Button>}>
              {t.crossLocked}
            </Alert>
          )}
          {multi && <Alert severity="info">{t.crossHelp}</Alert>}

          <Box>
            <Typography variant="overline" color="text.secondary">{t.selected(selected.length, max)}</Typography>
            {mode === 'broadcast' && selected.length > 0 && (
              <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>{t.orderHelp}</Typography>
            )}
            <Stack spacing={1}>
              {selected.map((g, i) => (
                <Box key={keyOf(g)} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.25 }}>
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
                      {multi && <Chip size="small" variant="outlined" label={sessionName(g.sessionId)} sx={{ height: 20, fontSize: 11, mt: 0.25 }} />}
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
                      onChange={(_e, words) => setKeywords(keyOf(g), words as string[])}
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
            <Typography variant="overline" color="text.secondary">{multi ? t.availableAll : t.available}</Typography>
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
                    <Tooltip key={keyOf(g)} title={reason} arrow placement="top">
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
                            secondary={multi ? sessionName(g.sessionId) : undefined}
                            primaryTypographyProps={{ noWrap: true }}
                            secondaryTypographyProps={{ noWrap: true, variant: 'caption' }}
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
