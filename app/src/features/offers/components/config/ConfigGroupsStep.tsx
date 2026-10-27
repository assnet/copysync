import { useMemo, useState } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import {
  Alert, Avatar, Box, Button, Card, CardActionArea, Checkbox, Chip, CircularProgress, InputAdornment, Skeleton, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import { Search, X } from 'lucide-react';
import { AppIcon } from '@/components';
import { GroupAvatar } from '../GroupChip';
import { Blurred, useBlur } from '@/features/privacy';
import { useSessionGroups } from '../../hooks/useSessionGroups';
import { offerService } from '@/services/offer.service';
import type { SessionGroupWithSession, SessionItem } from '@/types/api.types';
import { resolveMediaUrl } from '@/utils/resolveMediaUrl';
import { offerStrings } from '../../strings';
import { sessionColor } from './DispatchOrderPicker';

const t = offerStrings.wizard.groups;

export interface SelectedGroup {
  title: string | null;
  avatarUrl: string | null;
  sessionId: string;
}

interface Props {
  /** Sessões escolhidas, na ordem de envio. */
  sessions: SessionItem[];
  /** id → grupo, mantido fora da lista para a seleção sobreviver à busca. */
  selected: ReadonlyMap<string, SelectedGroup>;
  limit: number | null;
  onToggle: (id: string, group: SelectedGroup) => void;
  onClear: () => void;
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** Termos de exclusão: separados por vírgula, sem acento/caixa, vazios fora. */
export function parseExcludeTerms(raw: string): string[] {
  return raw.split(',').map(fold).filter(Boolean);
}

/** Passo 2: grupos de todas as sessões, com busca, filtro por sessão, exclusão por palavra e contador × limite. */
export function ConfigGroupsStep({ sessions, selected, limit, onToggle, onClear }: Props) {
  // Filtros sobrevivem a reload junto com o rascunho do assistente
  const [filters, setFilters] = usePersistedState('offers.groupsFilters', { search: '', exclude: '', sessionFilter: null as string | null });
  const { search, exclude, sessionFilter } = filters;
  const setSearch = (v: string) => setFilters((f) => ({ ...f, search: v }));
  const setExclude = (v: string) => setFilters((f) => ({ ...f, exclude: v }));
  const setSessionFilter = (v: string | null) => setFilters((f) => ({ ...f, sessionFilter: v }));
  const sessionIds = useMemo(() => sessions.map((s) => s.id), [sessions]);
  const { items, partial, loading, failed, retry } = useSessionGroups(sessionIds, search);
  const multi = sessions.length > 1;
  const blurNames = useBlur('offers.groupNames');
  const blurSession = useBlur('offers.sessionName');
  const atLimit = limit != null && selected.size >= limit;
  // Abre sempre resumido: a busca procura em todos; a tela mostra VISIBLE_GROUPS até "Ver todos"
  const [expanded, setExpanded] = useState(false);
  // Grupo sem conversa ganha uma ao ser marcado; guarda aqui para a lista refletir sem recarregar.
  const [ensured, setEnsured] = useState<ReadonlyMap<string, string>>(new Map());
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [ensureFailed, setEnsureFailed] = useState(false);

  const excludeTerms = useMemo(() => parseExcludeTerms(exclude), [exclude]);
  const filtered = useMemo(() => items.filter((g) => {
    if (sessionFilter && g.sessionId !== sessionFilter) return false;
    if (excludeTerms.length > 0) {
      const name = fold(g.title ?? '');
      if (excludeTerms.some((term) => name.includes(term))) return false;
    }
    return true;
  }), [items, sessionFilter, excludeTerms]);
  const shown = expanded ? filtered : filtered.slice(0, VISIBLE_GROUPS);
  const hidden = filtered.length - shown.length;

  const keyOf = (g: SessionGroupWithSession) => `${g.sessionId}:${g.groupJid}`;
  const idOf = (g: SessionGroupWithSession) => g.conversationId ?? ensured.get(keyOf(g)) ?? null;
  const sessionIndex = (id: string) => sessionIds.indexOf(id);
  const sessionOf = (id: string) => sessions.find((s) => s.id === id);

  const toggle = async (g: SessionGroupWithSession) => {
    const id = idOf(g);
    if (id) {
      onToggle(id, { title: g.title, avatarUrl: g.avatarUrl, sessionId: g.sessionId });
      return;
    }
    setPendingKey(keyOf(g));
    setEnsureFailed(false);
    try {
      const { conversationId } = await offerService.ensureSessionGroup(g.sessionId, g.groupJid);
      setEnsured((prev) => new Map(prev).set(keyOf(g), conversationId));
      onToggle(conversationId, { title: g.title, avatarUrl: g.avatarUrl, sessionId: g.sessionId });
    } catch {
      setEnsureFailed(true);
    } finally {
      setPendingKey(null);
    }
  };

  const countBySession = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of items) m.set(g.sessionId, (m.get(g.sessionId) ?? 0) + 1);
    return m;
  }, [items]);

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
        <TextField
          size="small"
          label={t.searchLabel}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          slotProps={{
            input: {
              startAdornment: <InputAdornment position="start"><AppIcon icon={Search} size="sm" /></InputAdornment>,
            },
          }}
        />
        <TextField
          size="small"
          label={t.excludeLabel}
          placeholder={t.excludePlaceholder}
          value={exclude}
          onChange={(e) => setExclude(e.target.value)}
          helperText={exclude ? t.excludeHelper : undefined}
          slotProps={{
            input: {
              startAdornment: <InputAdornment position="start"><AppIcon icon={X} size="sm" /></InputAdornment>,
            },
          }}
        />
      </Box>

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        {multi && (
          <Box role="group" aria-label={t.filterAria} sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
            <Chip
              size="small"
              label={t.filterAll}
              color={sessionFilter === null ? 'primary' : 'default'}
              variant={sessionFilter === null ? 'filled' : 'outlined'}
              onClick={() => setSessionFilter(null)}
            />
            {sessions.map((s, i) => (
              <Chip
                key={s.id}
                size="small"
                avatar={<Avatar src={resolveMediaUrl(s.avatarUrl ?? null) ?? undefined} alt="" sx={{ bgcolor: sessionColor(i), color: '#fff', fontWeight: 700 }}>{s.name.slice(0, 1).toUpperCase()}</Avatar>}
                label={<Blurred when={blurSession} inline radius={4}>{`${s.name}${countBySession.has(s.id) ? ` · ${countBySession.get(s.id)}` : ''}`}</Blurred>}
                color={sessionFilter === s.id ? 'primary' : 'default'}
                variant={sessionFilter === s.id ? 'filled' : 'outlined'}
                onClick={() => setSessionFilter(sessionFilter === s.id ? null : s.id)}
              />
            ))}
          </Box>
        )}
        <Chip
          role="status"
          aria-live="polite"
          aria-label={t.counterAria(selected.size, limit)}
          color={atLimit ? 'warning' : selected.size > 0 ? 'primary' : 'default'}
          variant={selected.size > 0 ? 'filled' : 'outlined'}
          label={t.counter(selected.size, limit)}
          sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', ml: 'auto' }}
        />
        {selected.size > 0 && (
          <Button size="small" color="inherit" onClick={onClear}>{t.clear}</Button>
        )}
      </Box>

      {partial && !failed && <Alert severity="warning" variant="outlined">{t.partial}</Alert>}
      {ensureFailed && (
        <Alert severity="error" onClose={() => setEnsureFailed(false)}>{t.ensureError}</Alert>
      )}

      {failed ? (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={retry}>{offerStrings.page.retry}</Button>}>
          {t.loadError}
        </Alert>
      ) : loading && items.length === 0 ? (
        <Box sx={gridSx}>
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} variant="rounded" height={64} />)}
        </Box>
      ) : filtered.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
          {items.length > 0 ? t.emptyFiltered : search.trim() ? t.emptySearch : t.empty}
        </Typography>
      ) : (
        <Box sx={{ ...gridSx, opacity: loading ? 0.6 : 1, transition: 'opacity 150ms ease' }} aria-busy={loading}>
          {shown.map((g) => {
            const id = idOf(g);
            const checked = id != null && selected.has(id);
            const pending = pendingKey === keyOf(g);
            const blocked = !checked && atLimit;
            const title = g.title || t.untitled;
            const session = sessionOf(g.sessionId);
            const card = (
              <Card
                variant="outlined"
                sx={{
                  borderColor: checked ? 'primary.main' : 'divider',
                  bgcolor: checked ? 'action.selected' : 'background.paper',
                  opacity: blocked ? 0.55 : 1,
                  transition: 'border-color 150ms ease, background-color 150ms ease',
                }}
              >
                <CardActionArea
                  role="checkbox"
                  aria-checked={checked}
                  aria-disabled={blocked}
                  aria-busy={pending}
                  disabled={blocked || pendingKey !== null}
                  onClick={() => void toggle(g)}
                  sx={{ px: 1.5, py: 1, display: 'flex', alignItems: 'center', gap: 1.25, justifyContent: 'flex-start', minHeight: 60 }}
                >
                  <GroupAvatar title={g.title} avatarUrl={g.avatarUrl} size={36} />
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap title={blurNames ? undefined : title}>
                      <Blurred when={blurNames} inline radius={5}>{title}</Blurred>
                    </Typography>
                    {multi && session && (
                      <Typography variant="caption" noWrap component="p" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
                        <Box component="span" sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: sessionColor(sessionIndex(g.sessionId)), flexShrink: 0 }} />
                        <Blurred when={blurSession} inline radius={4}>{t.viaSession(session.name)}</Blurred>
                      </Typography>
                    )}
                  </Box>
                  {pending ? (
                    <CircularProgress size={18} sx={{ m: 0.75 }} aria-hidden />
                  ) : (
                    <Checkbox checked={checked} tabIndex={-1} disableRipple size="small" sx={{ p: 0.5 }} slotProps={{ input: { 'aria-hidden': true } }} />
                  )}
                </CardActionArea>
              </Card>
            );
            return blocked && limit != null ? (
              <Tooltip key={keyOf(g)} title={t.limitTooltip(limit)} arrow>
                {/* span: o Tooltip precisa de um filho que receba eventos mesmo com o cartão desabilitado */}
                <Box component="span" sx={{ display: 'block' }}>{card}</Box>
              </Tooltip>
            ) : (
              <Box key={keyOf(g)}>{card}</Box>
            );
          })}
        </Box>
      )}

      {filtered.length > VISIBLE_GROUPS && (
        <Button size="small" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} sx={{ alignSelf: 'flex-start' }}>
          {expanded ? t.showLess : t.showAll(hidden)}
        </Button>
      )}
    </Stack>
  );
}

const VISIBLE_GROUPS = 6;

const gridSx = {
  display: 'grid',
  gap: 1.25,
  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' },
} as const;
