import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { keyframes, useTheme } from '@mui/material/styles';
import {
  Alert, Avatar, Box, Button, Chip, CircularProgress, Collapse, IconButton, LinearProgress, Skeleton, Snackbar, Stack, Tooltip, Typography,
  useMediaQuery,
} from '@mui/material';
import {
  AlertTriangle, CheckCheck, ChevronDown, CircleSlash, Clock, ImageOff, Inbox, Loader, Pause, Radar, RefreshCw, RotateCcw, Send, Square, Tag,
  type LucideIcon,
} from 'lucide-react';
import { AppIcon, CooldownBar } from '@/components';
import { GroupAvatar } from '@/features/offers/components/GroupChip';
import { Blurred, useBlur } from '@/features/privacy';
import { usePersistedState } from '@/hooks/usePersistedState';
import { serverNow, serverToLocal } from '@/services/serverClock';
import type { CapturedOfferItem, CapturedOfferStatus } from '@/types/api.types';
import { OfferControlButtons, OfferControlFeedback, isControllableOffer, useOfferControl, type OfferControl } from '@/features/sendQueue/components/OfferControls';
import {
  CAPTURED_FILTERS, canRetryCaptured, countCapturedByFilter, matchesCapturedFilter, useCapturedOffers, type CapturedFilter,
} from '../hooks/useCapturedOffers';
import { INNER_RADIUS, REDUCED_MOTION, VISUALLY_HIDDEN, glassPillSx, iconTileSx, surfaceSx, toneSurface, type MonitorTone } from '../monitoringStyle';
import { monitoringStrings } from '../strings';
import { uiErrorMessage } from '../utils/apiErrors';
import { MonitorCard } from './MonitorCard';

export { canRetryCaptured };

const t = monitoringStrings.captured;

/** Ids com o texto aberto guardados na aba: só os mais recentes. */
const EXPANDED_MAX = 20;
/** Chips por linha no celular; o resto vai para o "Ver mais". */
const COMPACT_CHIPS = 2;
/** Mesma regra do texto: só recolhe se esconder 2+ chips; com 1 a mais, mostra todos. */
const MIN_HIDDEN_CHIPS = 2;
/** Relógio da tela: "há 3 min" anda sem depender do polling. */
const TICK_MS = 30_000;
/** Linhas do texto fechado. "Ver mais" só aparece se esconder 2+ linhas; com 1 a mais, mostra tudo. */
const CLAMP_LINES = 3;
const MIN_HIDDEN_LINES = 2;

/** Spinner parado com movimento reduzido (a raiz gira e o círculo pulsa). */
const SPINNER_SX = { [REDUCED_MOTION]: { animation: 'none', '& .MuiCircularProgress-circle': { animation: 'none' } } };

const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

const STATUS_META: Record<CapturedOfferStatus, { tone: MonitorTone; icon: LucideIcon }> = {
  PENDING: { tone: 'neutral', icon: Clock },
  PROCESSING: { tone: 'info', icon: Loader },
  QUEUED: { tone: 'success', icon: Send },
  SKIPPED: { tone: 'warning', icon: CircleSlash },
  FAILED: { tone: 'error', icon: AlertTriangle },
};

/** Status mostrado: QUEUED vira o estado da oferta na fila quando ele diz mais (pausada, enviada, parada). */
function displayStatus(item: CapturedOfferItem): { tone: MonitorTone; icon: LucideIcon; label: string } {
  if (item.status === 'QUEUED' && item.offerId) {
    switch (item.offerStatus) {
      case 'PAUSED': return { tone: 'warning', icon: Pause, label: t.offerPaused };
      case 'SENT': return { tone: 'success', icon: CheckCheck, label: t.offerStatus.SENT };
      case 'CANCELLED': return { tone: 'neutral', icon: Square, label: t.offerStatus.CANCELLED };
      case 'FAILED': return { tone: 'error', icon: AlertTriangle, label: t.offerStatus.FAILED };
      default: break;
    }
  }
  // Mesma regra dos filtros: recuperável = "Precisa de ação"; sem volta = "Ignorada"
  if (item.status === 'SKIPPED' || item.status === 'FAILED') {
    return canRetryCaptured(item)
      ? { tone: 'warning', icon: AlertTriangle, label: t.statusAction }
      : { ...STATUS_META.SKIPPED, label: t.status.SKIPPED };
  }
  return { ...STATUS_META[item.status], label: t.status[item.status] };
}

function statusHelp(item: CapturedOfferItem): string {
  if (item.status === 'SKIPPED' || item.status === 'FAILED') return canRetryCaptured(item) ? t.statusActionHelp : t.statusHelp.SKIPPED;
  return t.statusHelp[item.status];
}

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "agora", "há 3 min", "hoje 03:47", "ontem 03:47" ou "12 out 03:47" (horários do servidor). */
export function relativeWhen(serverMs: number, nowServerMs: number): string {
  const diff = (nowServerMs - serverMs) / 1000;
  if (diff < 3600) return t.ago(diff);
  const d = serverToLocal(serverMs);
  const now = serverToLocal(nowServerMs);
  const time = t.timeOf(d);
  if (sameDay(d, now)) return t.today(time);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return t.yesterday(time);
  return t.dayMonth(d, time);
}

/** Hora de um evento (envio, validade): só a hora no mesmo dia, com data em outro dia. */
function clockLabel(serverMs: number, nowServerMs: number): string {
  const d = serverToLocal(serverMs);
  const time = t.timeOf(d);
  return sameDay(d, serverToLocal(nowServerMs)) ? time : t.dayMonth(d, time);
}

function useServerNow(): number {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function StatusChip({ item }: { item: CapturedOfferItem }) {
  const theme = useTheme();
  const s = displayStatus(item);
  const surface = toneSurface(theme, s.tone);
  return (
    <Tooltip title={statusHelp(item)} arrow describeChild enterTouchDelay={0} leaveTouchDelay={4000}>
      <Chip
        size="small"
        icon={<AppIcon icon={s.icon} size="sm" />}
        label={s.label}
        sx={{
          ...surface,
          border: '1px solid',
          fontWeight: 600,
          '& .MuiChip-icon': { color: 'inherit', ml: 0.75 },
        }}
      />
    </Tooltip>
  );
}

/** Espera até o 1º envio: começa a barra de quando a tela viu o item (não da captura), senão nasce quase vazia e vermelha. */
function StartCooldownBar({ capturedAt, startsAt, now }: { capturedAt: string; startsAt: string; now: number }) {
  const [firstSeen] = useState(() => serverNow());
  const end = Date.parse(startsAt);
  return (
    <CooldownBar
      size="small"
      startAt={Math.min(Math.max(Date.parse(capturedAt), firstSeen), end)}
      endAt={end}
      ariaLabel={t.untilStartAria}
      label={t.untilStart}
      doneLabel={t.started}
      formatRemaining={t.remaining}
      tooltip={t.startsAt(clockLabel(end, now))}
    />
  );
}

/** Miniatura: foto quando houver; senão um só estilo de marcador (inicial da loja ou etiqueta). A falta de foto já tem chip próprio. */
function OfferThumb({ item }: { item: CapturedOfferItem }) {
  const theme = useTheme();
  const blurImage = useBlur('monitoring.capturedImages');
  const size = { xs: 40, sm: 72 };
  const initial = item.marketplace ? t.marketplace[item.marketplace].charAt(0) : null;
  const fallback = initial ?? <AppIcon icon={Tag} size="md" />;
  const surface = toneSurface(theme, 'neutral');
  return (
    <Avatar
      variant="rounded"
      src={item.imageUrl && !item.imageUnavailable ? item.imageUrl : undefined}
      alt=""
      aria-hidden
      sx={{
        width: size, height: size, flexShrink: 0, borderRadius: INNER_RADIUS,
        bgcolor: surface.backgroundColor, color: 'text.secondary', typography: { xs: 'subtitle1', sm: 'h6' }, fontWeight: 700,
        ...(blurImage && { filter: 'blur(12px)' }),
      }}
    >
      {fallback}
    </Avatar>
  );
}

function ReasonCallout({ item, action }: { item: CapturedOfferItem; action?: ReactNode }) {
  const theme = useTheme();
  if (!item.reason) return null;
  const tone: MonitorTone = item.status === 'FAILED' ? 'error' : 'warning';
  const s = toneSurface(theme, tone);
  return (
    <Box
      sx={{
        display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1, rowGap: 0.75,
        px: 1.25, py: 0.75, borderRadius: INNER_RADIUS, border: '1px solid', ...s,
      }}
    >
      {/* Ícone e texto sempre na mesma linha; só o botão desce quando falta espaço */}
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'nowrap', gap: 1, flex: '1 1 12rem', minWidth: 0 }}>
        <Box component="span" sx={{ display: 'inline-flex', flexShrink: 0 }}>
          <AppIcon icon={tone === 'error' ? AlertTriangle : CircleSlash} size="sm" aria-hidden />
        </Box>
        <Typography variant="body2" sx={{ fontWeight: 600, color: 'inherit', minWidth: 0, overflowWrap: 'anywhere' }}>
          {t.reason[item.reason]}
        </Typography>
      </Box>
      {action && <Box sx={{ ml: 'auto', flexShrink: 0 }}>{action}</Box>}
    </Box>
  );
}

function MetaDot() {
  return <Box component="span" aria-hidden sx={{ color: 'text.disabled' }}>·</Box>;
}

interface RowProps {
  item: CapturedOfferItem;
  now: number;
  expanded: boolean;
  compact: boolean;
  onToggle: (id: string) => void;
  onRetry: (id: string) => Promise<void>;
  control: OfferControl;
}

function CapturedOfferRow({ item, now, expanded, compact, onToggle, onRetry, control }: RowProps) {
  const theme = useTheme();
  const blurText = useBlur('monitoring.capturedText');
  const blurGroup = useBlur('monitoring.groupNames');
  const uid = useId();
  const textId = `${uid}-text`;
  const detailsId = `${uid}-details`;
  const textRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState(0);
  const [retrying, setRetrying] = useState(false);

  const capturedMs = Date.parse(item.capturedAt);
  const startsMs = item.startsAt ? Date.parse(item.startsAt) : null;
  const waitingStart = item.status === 'QUEUED' && startsMs !== null && startsMs > now;
  const queued = item.status === 'QUEUED' && item.offerId !== null && item.offerStatus !== null;
  const controllable = queued && isControllableOffer(item.offerStatus);
  const retryable = canRetryCaptured(item);
  const status = displayStatus(item);

  // Linhas do texto inteiro (scrollHeight não depende do corte). Só corta se esconder 2+ linhas
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return undefined;
    const measure = () => {
      const style = getComputedStyle(el);
      const lh = parseFloat(style.lineHeight) || (parseFloat(style.fontSize) || 14) * 1.43;
      setLines(el.scrollHeight > 0 ? Math.round(el.scrollHeight / lh) : 0);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [item.textPreview]);
  const clamped = lines >= CLAMP_LINES + MIN_HIDDEN_LINES;

  const retry = async () => {
    setRetrying(true);
    try {
      await onRetry(item.id);
    } finally {
      setRetrying(false);
    }
  };

  const chips: ReactNode[] = [];
  if (item.coupon) {
    chips.push(
      <Chip
        key="coupon"
        size="small"
        variant="outlined"
        icon={<AppIcon icon={Tag} size="sm" />}
        sx={{ color: 'text.primary', maxWidth: '100%', '& .MuiChip-icon': { color: 'text.secondary' } }}
        label={<Blurred when={blurText} inline radius={5}>{t.coupon(item.coupon)}</Blurred>}
      />,
    );
  }
  if (item.aiErrorCode) {
    chips.push(
      <Tooltip key="ai" title={t.aiFallbackTooltip(item.aiErrorCode)} arrow describeChild enterTouchDelay={0} leaveTouchDelay={4000}>
        <Chip size="small" variant="outlined" label={t.aiFallback} sx={{ ...toneSurface(theme, 'warning'), border: '1px solid' }} />
      </Tooltip>,
    );
  }
  if (item.imageUnavailable) {
    chips.push(
      <Tooltip key="img" title={t.imageUnavailableTooltip} arrow describeChild enterTouchDelay={0} leaveTouchDelay={4000}>
        <Chip
          size="small"
          variant="outlined"
          icon={<AppIcon icon={ImageOff} size="sm" />}
          label={t.imageUnavailable}
          sx={{ color: 'text.secondary', '& .MuiChip-icon': { color: 'text.secondary' } }}
        />
      </Tooltip>,
    );
  }
  if (item.textSource) {
    chips.push(
      <Tooltip key="src" title={t.textSourceTooltip[item.textSource]} arrow describeChild enterTouchDelay={0} leaveTouchDelay={4000}>
        <Chip size="small" variant="outlined" label={t.textSource[item.textSource]} sx={{ color: 'text.secondary' }} />
      </Tooltip>,
    );
  }
  const collapseChips = compact && chips.length - COMPACT_CHIPS >= MIN_HIDDEN_CHIPS;
  const visibleChips = collapseChips ? chips.slice(0, COMPACT_CHIPS) : chips;
  const hiddenChips = collapseChips ? chips.slice(COMPACT_CHIPS) : [];
  const canToggle = clamped || hiddenChips.length > 0;

  const retryButton = retryable ? (
    <Tooltip title={t.retryItemTooltip} arrow describeChild>
      <span>
        <Button
          size="small"
          variant="outlined"
          color="inherit"
          onClick={() => void retry()}
          disabled={retrying}
          startIcon={retrying ? <CircularProgress size={14} color="inherit" sx={SPINNER_SX} /> : <AppIcon icon={RotateCcw} size="sm" />}
          sx={{ bgcolor: 'background.paper' }}
        >
          {t.retryItem}
        </Button>
      </span>
    </Tooltip>
  ) : undefined;

  const capturedLocal = serverToLocal(capturedMs);
  const showProgress = queued && item.totalCount > 0;

  return (
    <Box
      component="li"
      sx={{
        ...surfaceSx(theme, { interactive: true, tone: status.tone }),
        borderRadius: INNER_RADIUS,
        listStyle: 'none',
        display: 'flex',
        gap: { xs: 1.5, sm: 2 },
        p: { xs: 1.5, sm: 2 },
        pl: { xs: 2, sm: 2.5 },
        minWidth: 0,
      }}
    >
      <OfferThumb item={item} />

      <Box sx={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        {/* Cabeçalho: status, loja, grupo de origem e quando chegou */}
        <Box sx={{ display: 'flex', alignItems: 'center', columnGap: 1, rowGap: 0.5, flexWrap: 'wrap', minWidth: 0 }}>
          <StatusChip item={item} />
          {item.marketplace && (
            <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.primary' }}>{t.marketplace[item.marketplace]}</Typography>
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, maxWidth: '100%' }}>
            <GroupAvatar title={item.sourceGroupTitle} avatarUrl={item.sourceGroupAvatarUrl} size={20} blurFlag="monitoring.groupAvatars" />
            <Blurred when={blurGroup} inline radius={5} sx={{ minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>{item.sourceGroupTitle || t.unknownGroup}</Typography>
            </Blurred>
          </Box>
        </Box>

        <ReasonCallout item={item} action={retryButton} />

        <Box>
          <Blurred when={blurText} radius={5}>
            <Typography
              ref={textRef}
              id={textId}
              variant="body2"
              sx={{
                color: 'text.primary', whiteSpace: 'pre-line', overflowWrap: 'anywhere',
                ...(!expanded && clamped && { display: '-webkit-box', WebkitLineClamp: CLAMP_LINES, WebkitBoxOrient: 'vertical', overflow: 'hidden' }),
              }}
            >
              {item.textPreview}
            </Typography>
          </Blurred>
        </Box>

        {/* Meta numa linha: quando chegou, envio, validade, progresso */}
        <Box sx={{ display: 'flex', alignItems: 'center', columnGap: 0.75, rowGap: 0.5, flexWrap: 'wrap', typography: 'caption', color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
          <Tooltip title={t.dateTime(capturedLocal)} arrow enterTouchDelay={0} leaveTouchDelay={4000}>
            <Box component="time" dateTime={item.capturedAt}>
              <span aria-hidden>{relativeWhen(capturedMs, now)}</span>
              <Box component="span" sx={VISUALLY_HIDDEN}>{t.capturedAt(t.dateTime(capturedLocal))}</Box>
            </Box>
          </Tooltip>
          {startsMs !== null && !waitingStart && (<><MetaDot /><span>{t.startsAt(clockLabel(startsMs, now))}</span></>)}
          {item.expiresAt && (<><MetaDot /><span>{t.expiresAt(clockLabel(Date.parse(item.expiresAt), now))}</span></>)}
          {showProgress && (
            <>
              <MetaDot />
              <Tooltip title={t.progressTooltip} arrow describeChild enterTouchDelay={0} leaveTouchDelay={4000}>
                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                  <LinearProgress
                    variant="determinate"
                    value={Math.min(100, (item.sentCount / item.totalCount) * 100)}
                    aria-label={t.progressAria(item.sentCount, item.totalCount)}
                    sx={{ width: 48, height: 4, borderRadius: 999 }}
                    color="success"
                  />
                  <span aria-hidden>{t.progress(item.sentCount, item.totalCount)}</span>
                </Box>
              </Tooltip>
            </>
          )}
        </Box>

        {visibleChips.length > 0 && (
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', minWidth: 0 }}>{visibleChips}</Box>
        )}

        {hiddenChips.length > 0 && (
          <Collapse in={expanded} id={detailsId}>
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>{hiddenChips}</Box>
          </Collapse>
        )}

        {(waitingStart || controllable || canToggle) && (
          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, minWidth: 0 }}>
            {canToggle && (
              <Button
                size="small"
                variant="text"
                color="inherit"
                onClick={() => onToggle(item.id)}
                aria-expanded={expanded}
                aria-controls={hiddenChips.length > 0 ? `${textId} ${detailsId}` : textId}
                endIcon={(
                  <Box component="span" sx={{ display: 'inline-flex', transition: 'transform 200ms', transform: expanded ? 'rotate(180deg)' : 'none', [REDUCED_MOTION]: { transition: 'none' } }}>
                    <AppIcon icon={ChevronDown} size="sm" />
                  </Box>
                )}
                sx={{ color: 'text.secondary', px: 1, ml: -1 }}
              >
                {expanded ? t.showLess : t.showMore}
              </Button>
            )}
            {waitingStart && item.startsAt && (
              <Box sx={{ flex: { xs: '1 1 100%', md: '0 1 320px' }, minWidth: 0 }}>
                <StartCooldownBar capturedAt={item.capturedAt} startsAt={item.startsAt} now={now} />
              </Box>
            )}
            {controllable && item.offerId && item.offerStatus && (
              <Stack direction="row" sx={{ ml: 'auto', flexShrink: 0 }}>
                {/* Celular: só ícones (tooltip + aria-label), lado a lado */}
                <OfferControlButtons offerId={item.offerId} offerStatus={item.offerStatus} control={control} variant={compact ? 'icon' : 'text'} waitingCount={item.totalCount - item.sentCount} />
              </Stack>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
}

interface FilterBarProps {
  value: CapturedFilter;
  counts: Record<CapturedFilter, number>;
  /** Há mais páginas: número com "+" e leitor de tela diz "nas carregadas". */
  partial: boolean;
  onChange: (f: CapturedFilter) => void;
}

function FilterBar({ value, counts, partial, onChange }: FilterBarProps) {
  const theme = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  // Celular rola na horizontal: esmaece a borda direita enquanto houver chip escondido
  const [moreRight, setMoreRight] = useState(false);
  const measure = useCallback(() => {
    const el = ref.current;
    if (el) setMoreRight(el.scrollWidth - el.clientWidth - el.scrollLeft > 1);
  }, []);
  useLayoutEffect(() => {
    measure();
    if (typeof ResizeObserver === 'undefined' || !ref.current) return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [measure, partial]);
  const fade = 'linear-gradient(to right, #000 calc(100% - 32px), transparent)';
  return (
    <Box
      ref={ref}
      role="group"
      aria-label={t.filterAria}
      onScroll={measure}
      sx={{
        display: 'flex', gap: 0.75, minWidth: 0,
        flexWrap: { xs: 'nowrap', sm: 'wrap' },
        overflowX: { xs: 'auto', sm: 'visible' },
        mx: { xs: -0.5, sm: 0 }, px: { xs: 0.5, sm: 0 }, py: 0.25,
        scrollbarWidth: 'thin',
        ...(moreRight && { maskImage: fade, WebkitMaskImage: fade }),
      }}
    >
      {CAPTURED_FILTERS.map((f) => {
        const selected = value === f;
        const tone: MonitorTone = selected ? 'primary' : 'neutral';
        return (
          <Chip
            key={f}
            clickable
            onClick={() => onChange(f)}
            aria-pressed={selected}
            aria-label={partial ? t.filterCountPartial(t.filters[f], counts[f]) : t.filterCount(t.filters[f], counts[f])}
            label={(
              <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                {t.filters[f]}
                <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums', opacity: selected ? 1 : 0.7 }}>
                  {partial ? t.countPartial(counts[f]) : counts[f]}
                </Box>
              </Box>
            )}
            sx={{
              flexShrink: 0,
              height: 32,
              fontWeight: selected ? 700 : 500,
              border: '1px solid',
              ...toneSurface(theme, tone),
              ...(selected ? {} : { color: 'text.secondary', bgcolor: 'transparent' }),
              transition: theme.transitions.create(['background-color', 'color'], { duration: 200 }),
              [REDUCED_MOTION]: { transition: 'none' },
            }}
          />
        );
      })}
    </Box>
  );
}

const isFilter = (v: unknown): v is CapturedFilter => typeof v === 'string' && (CAPTURED_FILTERS as readonly string[]).includes(v);

export interface CapturedOffersListProps {
  sessionId: string;
  /** Leva à escolha de grupos monitorados (estado vazio). Só passe quando a config não tiver grupos. */
  onConfigureGroups?: () => void;
}

/** Ofertas que chegaram dos grupos monitorados e o que aconteceu com cada uma. */
export function CapturedOffersList({ sessionId, onConfigureGroups }: CapturedOffersListProps) {
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('sm'));
  const { items, nextCursor, loading, loadingMore, failed, refresh, loadMore, retry, lastUpdatedAt, newSinceLastView } = useCapturedOffers(sessionId);
  const [toast, setToast] = useState<{ message: string; severity: 'success' | 'error' } | null>(null);
  const control = useOfferControl(refresh);
  const now = useServerNow();
  const [filter, setFilter] = usePersistedState<CapturedFilter>(`monitoring.captured.filter.${sessionId}`, 'all', {
    deserialize: (raw) => (isFilter(raw) ? raw : 'all'),
  });
  const [expanded, setExpanded] = usePersistedState<string[]>(`monitoring.captured.expanded.${sessionId}`, [], {
    deserialize: (raw) => (Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(-EXPANDED_MAX) : []),
  });

  const toggle = (id: string) =>
    setExpanded((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(-EXPANDED_MAX)));

  const onRetry = async (id: string) => {
    try {
      await retry(id);
      setToast({ message: t.retryDone, severity: 'success' });
    } catch (err) {
      setToast({ message: uiErrorMessage(err, { scope: 'captured' }), severity: 'error' });
    }
  };

  const counts = countCapturedByFilter(items);
  // Mais páginas no servidor: contagens valem só para as carregadas ("12+")
  const partial = nextCursor !== null;
  const visible = items.filter((i) => matchesCapturedFilter(i, filter));
  const nowForRows = Math.max(now, lastUpdatedAt ?? 0);

  return (
    <MonitorCard
      icon={Inbox}
      tone="info"
      title={t.title}
      subtitle={t.subtitle}
      action={
        <Tooltip title={loading ? t.refreshing : t.refresh} arrow>
          <span>
            <IconButton aria-label={t.refresh} onClick={() => void refresh()} disabled={loading}>
              <Box
                component="span"
                sx={{
                  display: 'inline-flex',
                  ...(loading && { animation: `${spin} 1s linear infinite` }),
                  [REDUCED_MOTION]: { animation: 'none' },
                }}
              >
                <AppIcon icon={RefreshCw} size="sm" />
              </Box>
            </IconButton>
          </span>
        </Tooltip>
      }
    >
      {loading && items.length === 0 ? (
        <Stack spacing={1.5}>{[0, 1, 2].map((k) => <Skeleton key={k} variant="rounded" height={104} sx={{ borderRadius: INNER_RADIUS, [REDUCED_MOTION]: { animation: 'none', '&::after': { animation: 'none' } } }} />)}</Stack>
      ) : failed && items.length === 0 ? (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void refresh()}>{t.retry}</Button>}>
          {t.loadError}
        </Alert>
      ) : items.length === 0 ? (
        <Stack alignItems="center" spacing={1.25} sx={{ textAlign: 'center', py: { xs: 3, sm: 4 }, px: 2 }}>
          <Box sx={iconTileSx(theme, 'info', 48)}><AppIcon icon={Radar} size="lg" /></Box>
          <Typography variant="subtitle1" component="p" sx={{ fontWeight: 700 }}>{t.empty}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: '42ch' }}>{t.emptyDescription}</Typography>
          {onConfigureGroups && (
            <Button variant="outlined" onClick={onConfigureGroups} sx={{ mt: 0.5 }}>{t.configureGroups}</Button>
          )}
        </Stack>
      ) : (
        <Stack spacing={1.5}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: { xs: 'wrap', md: 'nowrap' }, minWidth: 0 }}>
            <Box sx={{ flex: '1 1 auto', minWidth: 0, maxWidth: '100%' }}>
              <FilterBar value={filter} counts={counts} partial={partial} onChange={setFilter} />
            </Box>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ ml: { md: 'auto' }, flexShrink: 0 }}>
              <Box role="status" aria-live="polite">
                {newSinceLastView > 0 && (
                  <Box component="span" sx={{ ...glassPillSx(theme), ...toneSurface(theme, 'info') }}>
                    {t.newItems(newSinceLastView)}
                  </Box>
                )}
              </Box>
              {lastUpdatedAt !== null && (
                <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  {t.updatedAt(t.timeOf(serverToLocal(lastUpdatedAt)))}
                </Typography>
              )}
            </Stack>
          </Box>

          {visible.length === 0 ? (
            <Box sx={{ ...toneSurface(theme, 'neutral'), border: '1px dashed', borderRadius: INNER_RADIUS, color: 'text.secondary', p: 2, textAlign: 'center' }}>
              <Typography variant="body2">{t.filterEmpty}{nextCursor ? ` ${t.filterEmptyMore}` : ''}</Typography>
              <Button size="small" onClick={() => setFilter('all')} sx={{ mt: 1 }}>{t.showAll}</Button>
            </Box>
          ) : (
            <Box component="ul" aria-label={t.listAria} aria-busy={loading} sx={{ m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {visible.map((item) => (
                <CapturedOfferRow
                  key={item.id}
                  item={item}
                  now={nowForRows}
                  compact={compact}
                  expanded={expanded.includes(item.id)}
                  onToggle={toggle}
                  onRetry={onRetry}
                  control={control}
                />
              ))}
            </Box>
          )}

          {failed && <Alert severity="error">{t.loadError}</Alert>}
          {nextCursor && (
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              <Button
                variant="outlined"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                startIcon={loadingMore ? <CircularProgress size={14} color="inherit" sx={SPINNER_SX} /> : undefined}
              >
                {t.loadMore}
              </Button>
            </Box>
          )}
        </Stack>
      )}

      <OfferControlFeedback control={control} />
      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        {toast ? <Alert severity={toast.severity} onClose={() => setToast(null)} sx={{ width: '100%' }}>{toast.message}</Alert> : undefined}
      </Snackbar>
    </MonitorCard>
  );
}
