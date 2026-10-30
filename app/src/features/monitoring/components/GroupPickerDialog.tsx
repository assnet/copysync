import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Alert, Autocomplete, Box, Button, Chip, CircularProgress, Collapse, Dialog, DialogActions, DialogContent,
  DialogTitle, IconButton, InputAdornment, LinearProgress, Skeleton, Stack, Tab, Tabs, TextField, Tooltip,
  Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Link as RouterLink } from 'react-router-dom';
import { ChevronDown, Ear, Info, Lock, Plus, Search, Send, X } from 'lucide-react';
import { AppIcon } from '@/components';
import { GroupAvatar } from '@/features/offers/components/GroupChip';
import { useSessionGroups } from '@/features/offers/hooks/useSessionGroups';
import { Blurred, useBlur } from '@/features/privacy';
import { usePersistedState } from '@/hooks/usePersistedState';
import type { SessionItem } from '@/types/api.types';
import { INNER_RADIUS, REDUCED_MOTION, REDUCED_MOTION_QUERY, focusRingScopeSx, iconTileSx, toneSurface, toneText } from '../monitoringStyle';
import { monitoringStrings } from '../strings';
import { uiErrorMessage } from '../utils/apiErrors';

const t = monitoringStrings.picker;
const tg = monitoringStrings.groups;

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

/** Aba visível no celular/tablet (no md+ as duas colunas ficam lado a lado). */
type PickerTab = 'available' | 'selected';

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

const BLUR = { filter: 'blur(5px)', userSelect: 'none' } as const;
/** Borra só o que foi digitado: o placeholder (texto de interface) continua legível. */
const BLUR_INPUT = { '& input:not(:placeholder-shown)': BLUR } as const;
/** Sem busca, a lista principal já é completa: o lookup de nome/foto não busca nada. */
const NO_SESSIONS: readonly string[] = [];

/** Aviso compacto tintado; o texto quebra linha (nunca corta). */
function InfoLine({ text, action }: { text: string; action?: ReactNode }) {
  const theme = useTheme();
  return (
    <Box sx={{ ...toneSurface(theme, 'info'), border: 1, borderRadius: INNER_RADIUS, px: 1.25, py: 0.75, display: 'flex', alignItems: 'flex-start', gap: 1 }}>
      <Box component="span" sx={{ display: 'inline-flex', pt: 0.25, flexShrink: 0 }}><AppIcon icon={Info} size="sm" aria-hidden /></Box>
      <Typography variant="caption" sx={{ flex: 1, minWidth: 0, fontWeight: 500, overflowWrap: 'anywhere' }}>{text}</Typography>
      {action}
    </Box>
  );
}

/**
 * Escolha de grupos da sessão (busca no servidor). Monte só quando aberto: seleção, busca, aba e
 * item com palavras-chave aberto são persistidos na aba por sessão e modo, apagados ao salvar ou cancelar.
 * md+: duas colunas (disponíveis | selecionados); menor: abas.
 */
export function GroupPickerDialog({ mode, sessionId, initial, max, excludeJids, sessions, crossSession = false, onClose, onSave }: Props) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const wide = useMediaQuery(theme.breakpoints.up('md'));
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);
  const blurNames = useBlur('monitoring.groupNames');
  const blurSession = useBlur('monitoring.sessionName');
  const blurKeywords = useBlur('monitoring.keywords');
  const [draft, setDraft, clearDraft] = usePersistedState<DraftGroup[]>(
    `monitoring.picker.${mode}.${sessionId}`,
    () => initial.map((g) => ({ groupJid: g.groupJid, sessionId: g.sessionId, keywords: g.keywords })),
    { version: PICKER_DRAFT_VERSION },
  );
  const [search, setSearch, clearSearch] = usePersistedState<string>(`monitoring.picker.search.${mode}.${sessionId}`, '');
  const [tab, setTab, clearTab] = usePersistedState<PickerTab>(`monitoring.picker.tab.${mode}.${sessionId}`, 'available');
  const [openKw, setOpenKw, clearOpenKw] = usePersistedState<string | null>(`monitoring.picker.openKeywords.${sessionId}`, null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  // Nome/foto em memória (nunca no storage): os salvos (`initial`) e os escolhidos nesta tela.
  // Depois de um reload, o grupo do rascunho é achado pelo jid na lista da sessão (`lookup`).
  const [seen, setSeen] = useState<Map<string, { title: string | null; avatarUrl: string | null }>>(
    () => new Map(initial.map((g) => [keyOf(g), { title: g.title, avatarUrl: g.avatarUrl }])),
  );
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
  // Com busca, a lista principal vem filtrada: lista completa só para achar nome/foto dos selecionados.
  // Carrega uma vez por conjunto de sessões (na 1ª busca) e não some quando a busca é limpa.
  const sessionsKey = sessionIds.join(',');
  const [lookupKey, setLookupKey] = useState<string | null>(null);
  if (search.trim() && lookupKey !== sessionsKey) setLookupKey(sessionsKey);
  const lookup = useSessionGroups(lookupKey === sessionsKey ? sessionIds : NO_SESSIONS, '');
  const findIn = (items: typeof groups.items, g: { sessionId: string; groupJid: string }) =>
    items.find((x) => x.groupJid === g.groupJid && x.sessionId === g.sessionId);
  const metaOf = (g: { sessionId: string; groupJid: string }) =>
    seen.get(keyOf(g)) ?? findIn(groups.items, g) ?? findIn(lookup.items, g) ?? { title: null, avatarUrl: null };
  const selected: PickedGroup[] = draft.map((d) => ({ ...d, ...pick(metaOf(d)) }));
  const excluded = useMemo(() => new Set(excludeJids), [excludeJids]);
  const selectedKeys = useMemo(() => new Set(draft.map(keyOf)), [draft]);
  const full = max !== null && selected.length >= max;
  // Bloqueados (usados na outra lista) vão para o fim; `sort` é estável e mantém a ordem do servidor
  const available = groups.items
    .filter((g) => !selectedKeys.has(keyOf(g)))
    .sort((a, b) => Number(excluded.has(a.groupJid)) - Number(excluded.has(b.groupJid)));
  const baseId = useId();
  const titleId = `monitoring-picker-${mode}`;
  const subtitleId = `${titleId}-subtitle`;
  const tabId = (k: PickerTab) => `${baseId}-tab-${k}`;
  const panelId = (k: PickerTab) => `${baseId}-panel-${k}`;
  const monitored = mode === 'monitored';
  const tone = monitored ? 'info' : 'success';

  const clearAll = () => {
    clearDraft();
    clearSearch();
    clearTab();
    clearOpenKw();
  };

  const close = () => {
    clearAll();
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
      clearAll();
      onClose();
    } catch (err) {
      setError(uiErrorMessage(err, { scope: 'groups' }));
    } finally {
      setSaving(false);
    }
  };

  const rowSx = {
    display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0, minHeight: 52, px: 1, py: 0.75,
    borderRadius: INNER_RADIUS,
    transition: theme.transitions.create('background-color', { duration: 200 }),
    '&:hover': { bgcolor: 'action.hover' },
    [REDUCED_MOTION]: { transition: 'none' },
  } as const;

  const sessionLine = (id: string) => (
    <Blurred when={blurSession} inline radius={5}>
      <Typography variant="caption" color="text.secondary" noWrap component="span" sx={{ display: 'block' }}>{sessionName(id)}</Typography>
    </Blurred>
  );

  // Bloco próprio: o que vem abaixo (sessão, palavras-chave) fica sempre na linha de baixo, com ou sem borrão
  const groupName = (title: string | null) => (
    <Box sx={{ minWidth: 0 }}>
      <Blurred when={blurNames} inline radius={5} sx={{ maxWidth: '100%', verticalAlign: 'top' }}>
        <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{title || tg.untitled}</Typography>
      </Blurred>
    </Box>
  );

  const availablePanel = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minHeight: 0, height: '100%' }}>
      <TextField
        size="small"
        fullWidth
        label={t.search}
        placeholder={t.searchPlaceholder}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        sx={blurNames ? BLUR_INPUT : undefined}
        slotProps={{ input: { startAdornment: <InputAdornment position="start"><AppIcon icon={Search} size="sm" /></InputAdornment> } }}
      />
      {groups.partial && <InfoLine text={t.partial} />}
      <Typography variant="subtitle2" component="h3" color="text.secondary">{multi ? t.availableAll : t.available}</Typography>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: wide ? 'auto' : 'visible', mx: -1, px: 1 }}>
        {groups.failed ? (
          <Alert severity="error" sx={{ borderRadius: INNER_RADIUS }} action={<Button color="inherit" size="small" onClick={groups.retry}>{t.retry}</Button>}>{t.loadError}</Alert>
        ) : groups.loading && groups.items.length === 0 ? (
          <Stack spacing={1}>{[0, 1, 2].map((k) => <Skeleton key={k} variant="rounded" height={52} sx={{ borderRadius: INNER_RADIUS }} />)}</Stack>
        ) : available.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>{t.noResults}</Typography>
        ) : (
          <Stack component="ul" spacing={0.25} sx={{ m: 0, p: 0, listStyle: 'none' }} aria-busy={saving}>
            {available.map((g) => {
              const usedElsewhere = excluded.has(g.groupJid);
              const disabled = usedElsewhere || full;
              const reason = usedElsewhere ? (monitored ? t.usedElsewhereMonitored : t.usedElsewhereBroadcast) : full ? t.limitReached : '';
              const title = g.title || tg.untitled;
              return (
                <Box component="li" key={keyOf(g)} sx={rowSx}>
                  <Box sx={{ opacity: disabled ? 0.6 : 1, display: 'flex' }}>
                    <GroupAvatar title={blurNames ? null : g.title} avatarUrl={g.avatarUrl} size={32} blurFlag="monitoring.groupAvatars" />
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    {groupName(g.title)}
                    {multi && sessionLine(g.sessionId)}
                    {reason && (
                      <Typography variant="caption" component="p" sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, color: toneText(theme, 'warning'), mt: 0.25 }}>
                        <Box component="span" sx={{ display: 'inline-flex', pt: 0.25, flexShrink: 0 }}><AppIcon icon={Lock} size="inline" aria-hidden /></Box>
                        <span>{reason}</span>
                      </Typography>
                    )}
                  </Box>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AppIcon icon={Plus} size="sm" />}
                    disabled={disabled || saving}
                    onClick={() => toggle(g)}
                    aria-label={t.addAria(title)}
                    sx={{ flexShrink: 0, minHeight: 36, borderRadius: 999 }}
                  >
                    {t.add}
                  </Button>
                </Box>
              );
            })}
          </Stack>
        )}
      </Box>
    </Box>
  );

  const selectedPanel = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minHeight: 0, height: '100%' }}>
      {wide && <Typography variant="subtitle2" component="h3" color="text.secondary">{t.selectedTitle}</Typography>}
      {!monitored && selected.length > 0 && <Typography variant="caption" color="text.secondary">{t.orderHelp}</Typography>}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: wide ? 'auto' : 'visible', mx: -1, px: 1 }}>
        {selected.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>{t.selectedEmpty}</Typography>
        ) : (
          <Stack component={monitored ? 'ul' : 'ol'} spacing={0.5} sx={{ m: 0, p: 0, listStyle: 'none' }} aria-busy={saving}>
            {selected.map((g, i) => {
              const key = keyOf(g);
              const title = g.title || tg.untitled;
              const open = openKw === key;
              const kwId = `${baseId}-kw-${i}`;
              const kwPanelId = `${baseId}-kwp-${i}`;
              return (
                <Box component="li" key={key} sx={{ borderRadius: INNER_RADIUS, bgcolor: open ? 'action.hover' : 'transparent' }}>
                  <Box sx={rowSx}>
                    {!monitored && (
                      <Box
                        aria-hidden
                        sx={{
                          ...toneSurface(theme, 'primary'), border: 0,
                          width: 24, height: 24, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center',
                          typography: 'caption', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {i + 1}
                      </Box>
                    )}
                    <GroupAvatar title={blurNames ? null : g.title} avatarUrl={g.avatarUrl} size={32} blurFlag="monitoring.groupAvatars" />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      {groupName(g.title)}
                      {multi && sessionLine(g.sessionId)}
                      {monitored && (
                        <Button
                          size="small"
                          variant="text"
                          onClick={() => setOpenKw(open ? null : key)}
                          aria-expanded={open}
                          aria-controls={kwPanelId}
                          aria-label={`${t.keywordsToggleAria(title)}: ${t.keywordsSummary(g.keywords.length)}`}
                          endIcon={
                            <Box component="span" sx={{ display: 'inline-flex', transition: theme.transitions.create('transform', { duration: 200 }), transform: open ? 'rotate(180deg)' : 'none', [REDUCED_MOTION]: { transition: 'none' } }}>
                              <AppIcon icon={ChevronDown} size="sm" />
                            </Box>
                          }
                          sx={{ display: 'flex', width: 'fit-content', ml: -0.75, mt: 0.25, px: 0.75, minHeight: 28, typography: 'caption', fontWeight: 600, color: 'text.secondary' }}
                        >
                          {t.keywordsSummary(g.keywords.length)}
                        </Button>
                      )}
                    </Box>
                    <Tooltip title={tg.remove} arrow>
                      <IconButton aria-label={t.removeAria(title)} onClick={() => toggle(g)} disabled={saving} sx={{ width: 40, height: 40 }}>
                        <AppIcon icon={X} size="sm" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                  {monitored && (
                    <Collapse in={open} id={kwPanelId} timeout={reducedMotion ? 0 : 'auto'}>
                      <Box sx={{ px: 1, pb: 1.25 }}>
                        <Autocomplete
                          multiple
                          freeSolo
                          size="small"
                          options={[]}
                          value={g.keywords}
                          onChange={(_e, words) => setKeywords(key, words as string[])}
                          renderTags={(value, getTagProps) =>
                            value.map((w, idx) => {
                              const { key: tagKey, ...tag } = getTagProps({ index: idx });
                              return <Chip key={tagKey} size="small" label={w} {...tag} sx={blurKeywords ? { '& .MuiChip-label': BLUR } : undefined} />;
                            })
                          }
                          renderInput={(params) => (
                            <TextField
                              {...params}
                              label={t.keywords}
                              placeholder={g.keywords.length === 0 ? t.keywordsPlaceholder : undefined}
                              sx={blurKeywords ? BLUR_INPUT : undefined}
                              inputProps={{
                                ...params.inputProps,
                                maxLength: KEYWORD_MAX_LENGTH,
                                disabled: g.keywords.length >= KEYWORDS_PER_GROUP,
                                'aria-describedby': kwId,
                              }}
                              helperText={
                                <Box component="span" id={kwId} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                                  <span>
                                    {g.keywords.length >= KEYWORDS_PER_GROUP
                                      ? t.keywordsFull(KEYWORDS_PER_GROUP)
                                      : `${t.keywordsHelp} ${t.keywordTooLong(KEYWORD_MAX_LENGTH)}`}
                                  </span>
                                  <Box component="span" sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                                    {t.keywordsCounter(g.keywords.length, KEYWORDS_PER_GROUP)}
                                  </Box>
                                </Box>
                              }
                            />
                          )}
                        />
                      </Box>
                    </Collapse>
                  )}
                </Box>
              );
            })}
          </Stack>
        )}
      </Box>
    </Box>
  );

  return (
    <Dialog
      open
      onClose={saving ? undefined : close}
      fullScreen={fullScreen}
      fullWidth
      maxWidth="md"
      aria-labelledby={titleId}
      aria-describedby={subtitleId}
      slotProps={{ paper: { sx: { borderRadius: fullScreen ? 0 : '20px', backgroundImage: 'none', ...focusRingScopeSx(theme) } } }}
    >
      <DialogTitle component="div" sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, pb: 1.5 }}>
        <Box aria-hidden sx={iconTileSx(theme, tone, 40)}><AppIcon icon={monitored ? Ear : Send} size="md" /></Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography id={titleId} variant="h6" component="h2" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
            {monitored ? t.monitoredTitle : t.broadcastTitle}
          </Typography>
          <Typography id={subtitleId} variant="body2" color="text.secondary">
            {monitored ? t.monitoredSubtitle : t.broadcastSubtitle}
          </Typography>
          {max !== null && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mt: 1, maxWidth: 360 }}>
              <LinearProgress
                variant="determinate"
                value={Math.min(100, max === 0 ? 100 : (selected.length / max) * 100)}
                color={selected.length > max ? 'error' : full ? 'warning' : 'primary'}
                aria-label={t.usageAria(selected.length, max)}
                sx={{ flex: 1, height: 6, borderRadius: 999 }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }} aria-hidden>
                {selected.length}/{max}
              </Typography>
            </Box>
          )}
        </Box>
        <Tooltip title={t.close} arrow>
          <IconButton aria-label={t.close} onClick={close} disabled={saving} edge="end">
            <AppIcon icon={X} size="sm" />
          </IconButton>
        </Tooltip>
      </DialogTitle>

      {!wide && (
        <Tabs
          value={tab}
          onChange={(_e, v: PickerTab) => setTab(v)}
          variant="fullWidth"
          aria-label={t.tabsLabel}
          sx={{ px: 2, borderBottom: 1, borderColor: 'divider', '& .MuiTab-root': { textTransform: 'none', fontWeight: 600 } }}
        >
          <Tab value="available" label={t.tabAvailable} id={tabId('available')} aria-controls={panelId('available')} />
          <Tab value="selected" label={t.tabSelected(selected.length)} id={tabId('selected')} aria-controls={panelId('selected')} />
        </Tabs>
      )}

      <DialogContent
        dividers={wide}
        sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, ...(wide && { height: 'min(560px, 68vh)', overflow: 'hidden' }) }}
      >
        {error && <Alert severity="error" sx={{ borderRadius: INNER_RADIUS }}>{error}</Alert>}
        {crossLocked && (
          <InfoLine
            text={t.crossLocked}
            action={<Button color="inherit" size="small" component={RouterLink} to="/plans" sx={{ flexShrink: 0 }}>{t.crossLockedLink}</Button>}
          />
        )}
        {multi && <InfoLine text={t.crossHelp} />}

        {wide ? (
          <Box sx={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 3 }}>
            <Box component="section" aria-label={t.tabAvailable} sx={{ minHeight: 0 }}>{availablePanel}</Box>
            <Box
              component="section"
              aria-label={t.selectedTitle}
              sx={{ minHeight: 0, pl: 3, borderLeft: 1, borderColor: 'divider' }}
            >
              {selectedPanel}
            </Box>
          </Box>
        ) : (
          <>
            {/* As duas abas ficam montadas (estado do Autocomplete e da busca); a inativa só some. */}
            <Box role="tabpanel" id={panelId('available')} aria-labelledby={tabId('available')} hidden={tab !== 'available'}>
              {availablePanel}
            </Box>
            <Box role="tabpanel" id={panelId('selected')} aria-labelledby={tabId('selected')} hidden={tab !== 'selected'}>
              {selectedPanel}
            </Box>
          </>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 1.5, gap: 1, borderTop: wide ? 0 : 1, borderColor: 'divider' }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1, fontVariantNumeric: 'tabular-nums' }} role="status">
          {t.selected(selected.length, max)}
        </Typography>
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
