import { useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import {
  Alert, Avatar, Box, Button, Card, CardActionArea, type CardActionAreaProps, Checkbox, Chip, CircularProgress, InputAdornment, Skeleton, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import { Search, X } from 'lucide-react';
import { AppIcon, HideUnavailableSwitch, UnavailableReason, useIsTruncated } from '@/components';
import { GroupAvatar } from '../GroupChip';
import { Blurred, useBlur } from '@/features/privacy';
import { useSessionGroups } from '../../hooks/useSessionGroups';
import { offerService } from '@/services/offer.service';
import { ChannelLogo } from '@/features/sessions/components/ChannelLogo';
import { channelOf } from '@/features/sessions/utils';
import type { BroadcastGroupsResponse, OfferConfigResponse, PostBlockedReason, SessionGroupWithSession, SessionItem } from '@/types/api.types';
import { CHANNELS, unionBroadcastCount } from '../../utils/offerConfig';
import { ChannelCounterChips } from './ChannelCounterChips';
import { resolveMediaUrl } from '@/utils/resolveMediaUrl';
import { offerStrings } from '../../strings';
import { isUnpostable, postBlockedText } from '../../utils/postBlocked';
import { sessionColor } from './DispatchOrderPicker';

const t = offerStrings.wizard.groups;

interface GroupCardActionProps extends Omit<CardActionAreaProps, 'children'> {
  /** Nome completo do grupo: conteúdo do tooltip quando o título está cortado. */
  title: string;
  /** Flag de borrar ligada: nunca mostra o tooltip (não vaza o nome). */
  tooltipOff: boolean;
  /** Motivo de indisponível: vira o tooltip da linha (não contém o nome). */
  reason?: string;
  /** Recebe a ref do título para medir o corte. */
  children: (titleRef: RefObject<HTMLElement | null>) => ReactNode;
}

/**
 * Área clicável do cartão com o tooltip do nome nela mesma: o foco de teclado fica no botão
 * e abre o tooltip quando o título está cortado.
 */
function GroupCardAction({ title, tooltipOff, reason, children, ...areaProps }: GroupCardActionProps) {
  const titleRef = useRef<HTMLElement>(null);
  const truncated = useIsTruncated(titleRef, `${title}|${tooltipOff}`);
  const show = !tooltipOff && truncated && !areaProps.disabled;
  return (
    <Tooltip title={reason ?? (show ? title : '')} arrow describeChild enterTouchDelay={0} leaveTouchDelay={4000}>
      <CardActionArea {...areaProps}>{children(titleRef)}</CardActionArea>
    </Tooltip>
  );
}

export interface SelectedGroup {
  title: string | null;
  avatarUrl: string | null;
  sessionId: string;
  /** Do grupo salvo/listado; false = sessão não posta nele. Ausente/null = desconhecido. */
  canPost?: boolean | null;
  postBlockedReason?: PostBlockedReason | null;
}

interface Props {
  /** Sessões escolhidas, na ordem de envio. */
  sessions: SessionItem[];
  /** id → grupo, mantido fora da lista para a seleção sobreviver à busca. */
  selected: ReadonlyMap<string, SelectedGroup>;
  /** Limites por canal; o canal do grupo é o da sessão dona. null = sem limite. */
  limits: OfferConfigResponse['limits'];
  /**
   * Catálogo de grupos de disparo do tenant (monitoramento + gerador), buscado uma vez pelo
   * assistente. null = indisponível: chip e bloqueio contam só a seleção.
   */
  catalog: BroadcastGroupsResponse | null;
  onToggle: (id: string, group: SelectedGroup) => void;
  onClear: () => void;
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** Termos de exclusão: separados por vírgula, sem acento/caixa, vazios fora. */
export function parseExcludeTerms(raw: string): string[] {
  return raw.split(',').map(fold).filter(Boolean);
}

/** Passo 2: grupos de todas as sessões, com busca, filtro por sessão, exclusão por palavra e contador × limite. */
export function ConfigGroupsStep({ sessions, selected, limits, catalog, onToggle, onClear }: Props) {
  // Filtros sobrevivem a reload junto com o rascunho do assistente
  const [filters, setFilters] = usePersistedState('offers.groupsFilters', { search: '', exclude: '', sessionFilter: null as string | null }, { scope: 'device' });
  const { search, exclude, sessionFilter } = filters;
  const setSearch = (v: string) => setFilters((f) => ({ ...f, search: v }));
  const setExclude = (v: string) => setFilters((f) => ({ ...f, exclude: v }));
  const setSessionFilter = (v: string | null) => setFilters((f) => ({ ...f, sessionFilter: v }));
  const sessionIds = useMemo(() => sessions.map((s) => s.id), [sessions]);
  const { items: allItems, partial, loading, failed, retry } = useSessionGroups(sessionIds, search);
  // Grupo onde a sessão não posta: oculto (padrão) ou visível, com motivo e nunca marcável
  const [hideUnpostable, setHideUnpostable] = usePersistedState('offers.groups.hideUnpostable', true);
  const multi = sessions.length > 1;
  const blurNames = useBlur('offers.groupNames');
  const blurSession = useBlur('offers.sessionName');
  const channelOfId = (id: string) => channelOf(sessions.find((s) => s.id === id)?.engine);
  // Chip e bloqueio pela união com o monitoramento (catálogo do tenant), não só pelo rascunho
  const inUseIds = useMemo(() => new Set(catalog?.items.map((i) => i.conversationId) ?? []), [catalog]);
  const count = unionBroadcastCount([...selected].map(([id, g]) => ({ id, channel: channelOfId(g.sessionId) })), catalog);
  const channels = CHANNELS.filter((ch) => sessions.some((s) => channelOf(s.engine) === ch));
  const groupLimits = { whatsapp: limits.whatsapp.broadcastGroups, telegram: limits.telegram.broadcastGroups };
  // Abre sempre resumido: a busca procura em todos; a tela mostra VISIBLE_GROUPS até "Ver todos"
  const [expanded, setExpanded] = useState(false);
  // Grupo sem conversa ganha uma ao ser marcado; guarda aqui para a lista refletir sem recarregar.
  const [ensured, setEnsured] = useState<ReadonlyMap<string, string>>(new Map());
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [ensureFailed, setEnsureFailed] = useState(false);

  const keyOf = (g: SessionGroupWithSession) => `${g.sessionId}:${g.groupJid}`;
  const idOf = (g: SessionGroupWithSession) => g.conversationId ?? ensured.get(keyOf(g)) ?? null;
  // Marcado continua à vista mesmo bloqueado: é por ele que o usuário desmarca
  const isChecked = (g: SessionGroupWithSession) => { const id = idOf(g); return id != null && selected.has(id); };
  const items = useMemo(
    () => (hideUnpostable ? allItems.filter((g) => !isUnpostable(g) || isChecked(g)) : allItems),
    [allItems, hideUnpostable, selected, ensured],
  );

  const excludeTerms = useMemo(() => parseExcludeTerms(exclude), [exclude]);
  const matches = (g: SessionGroupWithSession) => {
    if (sessionFilter && g.sessionId !== sessionFilter) return false;
    if (excludeTerms.length > 0) {
      const name = fold(g.title ?? '');
      if (excludeTerms.some((term) => name.includes(term))) return false;
    }
    return true;
  };
  // Ocultos agora, já com busca e filtros aplicados
  const hiddenCount = hideUnpostable ? allItems.filter((g) => isUnpostable(g) && !isChecked(g) && matches(g)).length : 0;
  const filteredRaw = useMemo(() => items.filter((g) => {
    if (sessionFilter && g.sessionId !== sessionFilter) return false;
    if (excludeTerms.length > 0) {
      const name = fold(g.title ?? '');
      if (excludeTerms.some((term) => name.includes(term))) return false;
    }
    return true;
  }), [items, sessionFilter, excludeTerms]);
  // Indisponíveis no fim da lista
  const filtered = useMemo(
    () => [...filteredRaw.filter((g) => !isUnpostable(g)), ...filteredRaw.filter(isUnpostable)],
    [filteredRaw],
  );
  const shown = expanded ? filtered : filtered.slice(0, VISIBLE_GROUPS);
  const hidden = filtered.length - shown.length;

  const sessionIndex = (id: string) => sessionIds.indexOf(id);
  const sessionOf = (id: string) => sessions.find((s) => s.id === id);

  const toggle = async (g: SessionGroupWithSession) => {
    const id = idOf(g);
    const group: SelectedGroup = { title: g.title, avatarUrl: g.avatarUrl, sessionId: g.sessionId, canPost: g.canPost ?? null, postBlockedReason: g.postBlockedReason ?? null };
    if (id) {
      onToggle(id, group);
      return;
    }
    setPendingKey(keyOf(g));
    setEnsureFailed(false);
    try {
      const { conversationId } = await offerService.ensureSessionGroup(g.sessionId, g.groupJid);
      setEnsured((prev) => new Map(prev).set(keyOf(g), conversationId));
      onToggle(conversationId, group);
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

      <HideUnavailableSwitch
        checked={hideUnpostable}
        onChange={setHideUnpostable}
        label={t.hideUnpostable}
        tooltip={t.hideUnpostableTooltip}
        hiddenCount={hiddenCount}
        hiddenCountLabel={t.hiddenCount}
      />

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
                avatar={<Avatar src={resolveMediaUrl(s.avatarUrl ?? null) ?? undefined} alt="" sx={{ bgcolor: sessionColor(i), color: '#fff', fontWeight: 700, ...(blurSession && { filter: 'blur(5px)', userSelect: 'none' }) }}>{s.name.slice(0, 1).toUpperCase()}</Avatar>}
                label={
                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                    <ChannelLogo channel={channelOf(s.engine)} labelled />
                    <Blurred when={blurSession} inline radius={4}>{`${s.name}${countBySession.has(s.id) ? ` · ${countBySession.get(s.id)}` : ''}`}</Blurred>
                  </Box>
                }
                color={sessionFilter === s.id ? 'primary' : 'default'}
                variant={sessionFilter === s.id ? 'filled' : 'outlined'}
                onClick={() => setSessionFilter(sessionFilter === s.id ? null : s.id)}
              />
            ))}
          </Box>
        )}
        <Box sx={{ ml: 'auto' }}>
          <ChannelCounterChips
            channels={channels}
            count={count}
            limits={groupLimits}
            label={t.channelCounter}
            ariaLabel={t.channelCounterAria}
            sharedLimitHint
          />
        </Box>
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
      ) : filtered.length === 0 && hiddenCount > 0 ? (
        <Box sx={{ py: 4, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t.allHiddenUnpostable(hiddenCount)}</Typography>
          <Button size="small" onClick={() => setHideUnpostable(false)}>{t.showHidden}</Button>
        </Box>
      ) : filtered.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
          {items.length > 0 ? t.emptyFiltered : search.trim() ? t.emptySearch : t.empty}
        </Typography>
      ) : (
        <Box sx={{ ...gridSx, opacity: loading ? 0.6 : 1, transition: 'opacity 150ms ease' }} aria-busy={loading}>
          {shown.map((g) => {
            const id = idOf(g);
            const session = sessionOf(g.sessionId);
            const checked = id != null && selected.has(id);
            const pending = pendingKey === keyOf(g);
            const channel = channelOf(session?.engine);
            const limit = groupLimits[channel];
            // Já em uso (monitoramento ou gerador salvo) não soma ao marcar: não bloqueia
            const blocked = !checked && !(id != null && inUseIds.has(id)) && limit != null && count[channel] >= limit;
            const title = g.title || t.untitled;
            // Sem permissão de postar: nunca marcável; se já marcado, o clique só desmarca
            const unpostable = isUnpostable(g);
            const locked = unpostable && !checked;
            const reason = unpostable ? postBlockedText(g.postBlockedReason) : null;
            const reasonId = `offer-group-reason-${keyOf(g).replace(/[^\w-]/g, '_')}`;
            const card = (
              <Card
                variant="outlined"
                sx={{
                  borderColor: checked ? 'primary.main' : 'divider',
                  bgcolor: checked ? 'action.selected' : 'background.paper',
                  opacity: blocked ? 0.55 : 1,
                  borderStyle: unpostable ? 'dashed' : 'solid',
                  transition: 'border-color 150ms ease, background-color 150ms ease',
                }}
              >
                <GroupCardAction
                  title={title}
                  tooltipOff={blurNames}
                  reason={reason ? (checked ? `${reason.long} ${t.unpostableSelectedHint}` : reason.long) : undefined}
                  role="checkbox"
                  aria-checked={checked}
                  aria-disabled={blocked || locked}
                  aria-describedby={reason ? reasonId : undefined}
                  aria-busy={pending}
                  // Bloqueado por permissão: sem `disabled` (mantém foco e tooltip), só sem clique
                  disabled={blocked || pendingKey !== null}
                  onClick={locked ? undefined : () => void toggle(g)}
                  sx={{
                    px: 1.5, py: 1, display: 'flex', alignItems: 'center', gap: 1.25, justifyContent: 'flex-start', minHeight: 60,
                    ...(locked && { cursor: 'not-allowed', '&:hover .MuiCardActionArea-focusHighlight': { opacity: 0 } }),
                  }}
                >
                  {(titleRef) => (<>
                  <Box sx={{ opacity: unpostable ? 0.6 : 1, display: 'flex' }}>
                    <GroupAvatar title={g.title} avatarUrl={g.avatarUrl} size={36} blurFlag="offers.groupAvatars" />
                  </Box>
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography ref={titleRef} variant="body2" noWrap sx={{ fontWeight: 500, opacity: unpostable ? 0.6 : 1 }}>
                      <Blurred when={blurNames} inline radius={5}>{title}</Blurred>
                    </Typography>
                    {multi && session && (
                      <Typography variant="caption" noWrap component="p" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
                        <Box component="span" sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: sessionColor(sessionIndex(g.sessionId)), flexShrink: 0 }} />
                        <Blurred when={blurSession} inline radius={4}>{t.viaSession(session.name)}</Blurred>
                      </Typography>
                    )}
                    {reason && <UnavailableReason id={reasonId} text={reason.short} />}
                  </Box>
                  {pending ? (
                    <CircularProgress size={18} sx={{ m: 0.75 }} aria-hidden />
                  ) : (
                    <Checkbox checked={checked} disabled={locked} tabIndex={-1} disableRipple size="small" sx={{ p: 0.5 }} slotProps={{ input: { 'aria-hidden': true } }} />
                  )}
                  </>)}
                </GroupCardAction>
              </Card>
            );
            return blocked && limit != null ? (
              <Tooltip key={keyOf(g)} title={t.channelLimitTooltip(channel, limit)} arrow>
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
