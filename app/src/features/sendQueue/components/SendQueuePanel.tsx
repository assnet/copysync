import { useState } from 'react';
import {
  Alert, Avatar, Box, Button, Chip, IconButton, LinearProgress, List, ListItem, ListItemAvatar,
  Skeleton, Stack, Tab, Tabs, Tooltip, Typography, type ChipProps,
} from '@mui/material';
import { ExternalLink, ListOrdered, RefreshCw, Users } from 'lucide-react';
import { AppIcon, CooldownBar, EmptyState, SectionCard } from '@/components';
import { serverNow, serverToLocal } from '@/services/serverClock';
import { Blurred, useBlur, type PrivacyFlag } from '@/features/privacy';
import { usePersistedState } from '@/hooks/usePersistedState';
import { offerStrings } from '@/features/offers/strings';
import type { OfferDispatchStatus, SendQueueItem, SendQueueSession } from '@/types/api.types';
import { useSendQueue } from '../hooks/useSendQueue';
import { laneCooldown } from '../utils/laneCooldown';
import { sendQueueStrings as t } from '../strings';

/** Flags de privacidade da tela que hospeda o painel (uma por tipo de dado). */
export interface SendQueuePrivacyFlags {
  sessionName: PrivacyFlag;
  groupNames: PrivacyFlag;
  groupAvatars: PrivacyFlag;
  productText: PrivacyFlag;
}

const OFFER_FLAGS: SendQueuePrivacyFlags = {
  sessionName: 'offers.sessionName',
  groupNames: 'offers.groupNames',
  groupAvatars: 'offers.groupAvatars',
  productText: 'offers.productText',
};

const STATUS_COLOR: Record<OfferDispatchStatus, ChipProps['color']> = {
  QUEUED: 'default', SENDING: 'info', SENT: 'success', FAILED: 'error', SKIPPED: 'warning', CANCELLED: 'default',
};

/** Itens visíveis por aba antes de "Mostrar todos". */
const COLLAPSED_ROWS = 5;
/** Passou disso do horário previsto sem sair: mostra "atrasado" em vez de "Enviando…". */
const OVERDUE_MS = 30_000;

const timeOf = (iso: string) =>
  serverToLocal(Date.parse(iso)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

interface Props {
  /** Só esta sessão; ausente = todas. */
  sessionId?: string;
  /** Abre a oferta na tela (ex.: gerador). Ausente = sem o botão. */
  onOpenOffer?: (offerId: string) => void;
  /** Oferta já aberta: não mostra "Abrir" para ela. */
  currentOfferId?: string | null;
  privacy?: SendQueuePrivacyFlags;
}

/**
 * Fila de envio lida do servidor: por sessão, o que está saindo, o que aguarda e o que saiu hoje.
 * Igual em qualquer aba ou navegador; o envio segue no servidor com o painel fechado.
 */
export function SendQueuePanel({ sessionId, onOpenOffer, currentOfferId = null, privacy = OFFER_FLAGS }: Props) {
  const { data, loading, failed, refresh } = useSendQueue(sessionId);
  const sessions = (data?.sessions ?? []).filter((s) => s.running || s.waiting.length > 0 || s.recent.length > 0);

  return (
    <SectionCard
      title={t.title}
      subtitle={t.subtitle}
      action={
        <Tooltip title={t.refresh} arrow>
          <IconButton size="small" aria-label={t.refresh} onClick={() => void refresh()}>
            <AppIcon icon={RefreshCw} size="sm" />
          </IconButton>
        </Tooltip>
      }
    >
      {loading && !data ? (
        <Stack spacing={1}>
          <Skeleton variant="rounded" height={48} />
          <Skeleton variant="rounded" height={120} />
        </Stack>
      ) : failed && !data ? (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void refresh()}>{t.retry}</Button>}>
          {t.loadError}
        </Alert>
      ) : sessions.length === 0 ? (
        <EmptyState icon={<AppIcon icon={ListOrdered} size="lg" />} title={t.emptyTitle} description={t.emptyDescription} sx={{ py: 4 }} />
      ) : (
        <Stack spacing={2}>
          {sessions.map((s) => (
            <LanePanel key={s.sessionId ?? 'none'} session={s} privacy={privacy} onOpenOffer={onOpenOffer} currentOfferId={currentOfferId} />
          ))}
        </Stack>
      )}
    </SectionCard>
  );
}

interface LaneProps {
  session: SendQueueSession;
  privacy: SendQueuePrivacyFlags;
  onOpenOffer?: (offerId: string) => void;
  currentOfferId: string | null;
}

function LanePanel({ session, privacy, onOpenOffer, currentOfferId }: LaneProps) {
  const laneKey = session.sessionId ?? 'none';
  const [tabs, setTabs] = usePersistedState<Record<string, 'waiting' | 'done'>>('sendQueue.tabs', {});
  const [expanded, setExpanded] = useState(false);
  const blurSession = useBlur(privacy.sessionName);
  const blurNames = useBlur(privacy.groupNames);
  const tab = tabs[laneKey] ?? 'waiting';
  const rows = tab === 'waiting' ? session.waiting : session.recent;
  const visible = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);
  const cooldown = laneCooldown(session);
  const next = session.waiting.find((w) => w.offerStatus !== 'PAUSED');
  const offline = session.sessionId !== null && session.status !== null && session.status !== 'CONNECTED';
  const name = session.sessionId === null ? t.noSession : session.name || t.unnamedSession;
  const overdue = cooldown != null && serverNow() - cooldown.endMs > OVERDUE_MS;
  const c = session.counts;

  const countChip = (key: keyof typeof t.countsTooltip, n: number, color: ChipProps['color'] = 'default') =>
    n > 0 && (
      <Tooltip key={key} title={t.countsTooltip[key]} arrow>
        <Chip size="small" variant={color === 'error' ? 'filled' : 'outlined'} color={color} label={t.counts[key](n)} />
      </Tooltip>
    );

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: { xs: 1.5, sm: 2 } }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1.5, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
        <Typography variant="subtitle2" noWrap sx={{ minWidth: 0 }}>
          <Blurred when={blurSession} inline radius={5}>{name}</Blurred>
        </Typography>
        <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
          {countChip('waiting', c.waiting)}
          {countChip('paused', c.paused)}
          {countChip('sent', c.sentToday)}
          {countChip('failed', c.failedToday, 'error')}
          {countChip('skipped', c.skippedToday)}
        </Stack>
      </Stack>

      {offline && (session.running || session.waiting.length > 0) && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>{t.sessionOffline}</Alert>
      )}

      {session.running && (
        <Box sx={{ mb: 1.5 }} role="status" aria-label={t.sendingNowAria}>
          <Typography variant="caption" color="text.secondary">{t.sendingNow}</Typography>
          <LinearProgress sx={{ my: 0.5, height: 4, borderRadius: 2 }} />
          <List dense disablePadding>
            <QueueRow item={session.running} privacy={privacy} onOpenOffer={onOpenOffer} currentOfferId={currentOfferId} />
          </List>
        </Box>
      )}

      {cooldown && next && !session.running && !offline && overdue && (
        <Typography variant="body2" color="warning.main" sx={{ mb: 1.5 }}>{t.overdue}</Typography>
      )}
      {cooldown && next && !session.running && !offline && !overdue && (
        <Box sx={{ mb: 1.5 }}>
          <LaneCooldownBar
            key={next.dispatchId}
            startMs={cooldown.startMs}
            endMs={cooldown.endMs}
            ariaLabel={t.nextSendAria}
            label={blurNames ? t.nextSendHidden : t.nextSend(next.groupName || t.untitledGroup)}
            formatRemaining={t.remaining}
            doneLabel={t.nextSendDone}
            tooltip={t.nextSendAt(timeOf(next.notBefore))}
          />
        </Box>
      )}

      <Tabs
        value={tab}
        onChange={(_, v: 'waiting' | 'done') => { setTabs({ ...tabs, [laneKey]: v }); setExpanded(false); }}
        variant="fullWidth"
        sx={{ minHeight: 36, borderBottom: 1, borderColor: 'divider', '& .MuiTab-root': { minHeight: 36, py: 0.5, px: 1, textTransform: 'none', minWidth: 0 } }}
      >
        <Tab value="waiting" label={t.tabs.waiting(session.waiting.length)} />
        <Tab value="done" label={t.tabs.done(session.recent.length)} />
      </Tabs>

      {rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
          {tab === 'waiting' ? t.emptyWaiting : t.emptyDone}
        </Typography>
      ) : (
        <List dense disablePadding>
          {visible.map((item) => (
            <QueueRow key={item.dispatchId} item={item} privacy={privacy} onOpenOffer={onOpenOffer} currentOfferId={currentOfferId} />
          ))}
        </List>
      )}
      {rows.length > COLLAPSED_ROWS && (
        <Button size="small" onClick={() => setExpanded(!expanded)} sx={{ mt: 0.5 }}>
          {expanded ? t.showLess : t.showAll(rows.length)}
        </Button>
      )}
    </Box>
  );
}

interface LaneCooldownBarProps {
  startMs: number;
  endMs: number;
  ariaLabel: string;
  label: string;
  formatRemaining: (seconds: number) => string;
  doneLabel: string;
  tooltip: string;
}

/**
 * Espera até o próximo envio. Sessão parada há muito tempo daria uma janela enorme e a barra já
 * nasceria quase vazia (vermelha): o início é limitado ao momento em que o painel viu este envio.
 */
function LaneCooldownBar({ startMs, endMs, ...bar }: LaneCooldownBarProps) {
  const [firstSeen] = useState(() => serverNow());
  return <CooldownBar startAt={Math.min(Math.max(startMs, firstSeen), endMs)} endAt={endMs} size="small" {...bar} />;
}

interface RowProps {
  item: SendQueueItem;
  privacy: SendQueuePrivacyFlags;
  onOpenOffer?: (offerId: string) => void;
  currentOfferId: string | null;
}

function QueueRow({ item, privacy, onOpenOffer, currentOfferId }: RowProps) {
  const blurNames = useBlur(privacy.groupNames);
  const blurAvatars = useBlur(privacy.groupAvatars);
  const blurText = useBlur(privacy.productText);
  const done = item.status !== 'QUEUED' && item.status !== 'SENDING';
  const pausedRow = item.status === 'QUEUED' && item.offerStatus === 'PAUSED';
  const failure = item.status === 'FAILED' || item.status === 'SKIPPED'
    ? (item.failureReason && offerStrings.progress.failureReasons[item.failureReason])
      || (item.status === 'SKIPPED' ? offerStrings.progress.failureReasons.skipped : offerStrings.progress.failureReasons.generic)
    : null;
  const canOpen = onOpenOffer && item.origin === 'GENERATOR' && item.offerId !== currentOfferId;

  return (
    <ListItem
      divider
      disableGutters
      sx={{ gap: 1, alignItems: 'flex-start', opacity: item.status === 'CANCELLED' ? 0.6 : 1 }}
      secondaryAction={canOpen ? (
        <Tooltip title={t.openOffer} arrow>
          <IconButton edge="end" size="small" aria-label={t.openOffer} onClick={() => onOpenOffer!(item.offerId)}>
            <AppIcon icon={ExternalLink} size="sm" />
          </IconButton>
        </Tooltip>
      ) : undefined}
    >
      <ListItemAvatar sx={{ minWidth: 40, mt: 0.75 }}>
        <Avatar
          src={item.groupAvatarUrl ?? undefined}
          alt=""
          sx={{ width: 32, height: 32, bgcolor: 'action.selected', color: 'text.secondary', ...(blurAvatars && { filter: 'blur(5px)' }) }}
        >
          <AppIcon icon={Users} size="sm" />
        </Avatar>
      </ListItemAvatar>
      <Box sx={{ minWidth: 0, flex: 1, py: 0.75, pr: canOpen ? 5 : 0 }}>
        <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
          <Blurred when={blurNames} inline radius={5}>{item.groupName || t.untitledGroup}</Blurred>
        </Typography>
        <Typography variant="body2" color="text.secondary" noWrap>
          <Blurred when={blurText} inline radius={5}>{item.title || item.textPreview || t.untitledOffer}</Blurred>
        </Typography>
        <Stack direction="row" spacing={0.75} useFlexGap sx={{ mt: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <Tooltip title={t.originTooltip[item.origin]} arrow>
            <Chip size="small" variant="outlined" label={t.origin[item.origin]} sx={{ height: 20, fontSize: 11 }} />
          </Tooltip>
          {(done || item.status === 'SENDING') && (
            <Chip size="small" variant="outlined" color={STATUS_COLOR[item.status]} label={offerStrings.progress.status[item.status]} sx={{ height: 20, fontSize: 11 }} />
          )}
          {pausedRow && (
            <Tooltip title={t.pausedTooltip} arrow>
              <Chip size="small" variant="outlined" color="warning" label={t.paused} sx={{ height: 20, fontSize: 11 }} />
            </Tooltip>
          )}
          {!pausedRow && (
            <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
              {done ? t.finishedAt(timeOf(item.updatedAt)) : t.at(timeOf(item.notBefore))}
            </Typography>
          )}
        </Stack>
        {failure && <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.25 }}>{failure}</Typography>}
      </Box>
    </ListItem>
  );
}
