import { useState } from 'react';
import { alpha, darken, lighten, useTheme, type Theme } from '@mui/material/styles';
import {
  Alert, Avatar, Box, Button, Chip, CircularProgress, IconButton, Skeleton, Snackbar, Stack, Tooltip, Typography,
} from '@mui/material';
import { ImageOff, Inbox, RefreshCw, RotateCcw, Tag } from 'lucide-react';
import { AppIcon, CooldownBar, EmptyState, SectionCard } from '@/components';
import { GroupAvatar } from '@/features/offers/components/GroupChip';
import { Blurred, useBlur } from '@/features/privacy';
import { serverNow, serverToLocal } from '@/services/serverClock';
import type { CapturedOfferItem, CapturedOfferStatus } from '@/types/api.types';
import { OfferControlButtons, OfferControlFeedback, isControllableOffer, useOfferControl, type OfferControl } from '@/features/sendQueue/components/OfferControls';
import { useCapturedOffers } from '../hooks/useCapturedOffers';
import { monitoringStrings } from '../strings';
import { RETRYABLE_REASONS } from '../utils/settingsDraft';
import { uiErrorMessage } from '../utils/apiErrors';

const t = monitoringStrings.captured;

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'error';

const STATUS_TONE: Record<CapturedOfferStatus, Tone> = {
  PENDING: 'neutral', PROCESSING: 'info', QUEUED: 'success', SKIPPED: 'warning', FAILED: 'error',
};

/** Cor de texto com contraste AA no tema atual (âmbar/verde puros não passam sobre fundo claro). */
function toneText(theme: Theme, tone: Tone): string {
  if (tone === 'neutral') return theme.palette.text.secondary;
  const main = theme.palette[tone].main;
  return theme.palette.mode === 'dark' ? lighten(main, 0.25) : darken(main, 0.4);
}

function StatusChip({ status }: { status: CapturedOfferStatus }) {
  const theme = useTheme();
  const tone = STATUS_TONE[status];
  const color = toneText(theme, tone);
  return (
    <Tooltip title={t.statusHelp[status]} arrow describeChild>
      <Chip
        size="small"
        label={t.status[status]}
        sx={{
          color,
          backgroundColor: tone === 'neutral' ? 'action.selected' : alpha(theme.palette[tone].main, theme.palette.mode === 'dark' ? 0.18 : 0.12),
          border: '1px solid',
          borderColor: tone === 'neutral' ? 'divider' : alpha(theme.palette[tone].main, 0.4),
        }}
      />
    </Tooltip>
  );
}

/** Espera até o 1º envio: começa a barra de quando a tela viu o item (não da captura), senão nasce quase vazia e vermelha. */
function StartCooldownBar({ capturedAt, startsAt }: { capturedAt: string; startsAt: string }) {
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
      tooltip={t.startsAt(timeOf(startsAt))}
    />
  );
}

const timeOf = (iso: string) => serverToLocal(Date.parse(iso)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** SKIPPED/FAILED cuja causa o usuário pode corrigir: vale "Tentar de novo". */
export function canRetryCaptured(item: Pick<CapturedOfferItem, 'status' | 'reason'>): boolean {
  return (item.status === 'SKIPPED' || item.status === 'FAILED')
    && item.reason !== null
    && (RETRYABLE_REASONS as readonly string[]).includes(item.reason);
}

function CapturedOfferRow({ item, onRetry, control }: { item: CapturedOfferItem; onRetry: (id: string) => Promise<void>; control: OfferControl }) {
  const blurText = useBlur('monitoring.capturedText');
  const blurImage = useBlur('monitoring.capturedImages');
  const blurGroup = useBlur('monitoring.groupNames');
  const theme = useTheme();
  const [retrying, setRetrying] = useState(false);
  const waitingStart = item.status === 'QUEUED' && item.startsAt !== null && Date.parse(item.startsAt) > serverNow();
  const queued = item.status === 'QUEUED' && item.offerId !== null && item.offerStatus !== null;
  const controllable = queued && isControllableOffer(item.offerStatus);

  const retry = async () => {
    setRetrying(true);
    try {
      await onRetry(item.id);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <Box component="li" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, py: 1.5, listStyle: 'none', minWidth: 0 }}>
      <Avatar
        variant="rounded"
        src={item.imageUrl && !item.imageUnavailable ? item.imageUrl : undefined}
        alt=""
        sx={{ width: 64, height: 64, bgcolor: 'action.hover', color: 'text.disabled', flexShrink: 0, ...(blurImage && { filter: 'blur(12px)' }) }}
      >
        <AppIcon icon={ImageOff} size="md" />
      </Avatar>

      <Box sx={{ flex: '1 1 0', minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.5 }}>
          <StatusChip status={item.status} />
          {item.marketplace && <Chip size="small" variant="outlined" label={t.marketplace[item.marketplace]} />}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
            <GroupAvatar title={item.sourceGroupTitle} avatarUrl={item.sourceGroupAvatarUrl} size={20} blurFlag="monitoring.groupAvatars" />
            <Blurred when={blurGroup} inline radius={5}>
              <Typography variant="caption" color="text.secondary" noWrap>{item.sourceGroupTitle || t.unknownGroup}</Typography>
            </Blurred>
          </Box>
        </Box>

        {item.reason && (
          <Typography variant="body2" sx={{ fontWeight: 600, color: toneText(theme, item.status === 'FAILED' ? 'error' : 'warning') }}>
            {t.reason[item.reason]}
          </Typography>
        )}

        <Blurred when={blurText} radius={5}>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
          >
            {item.textPreview}
          </Typography>
        </Blurred>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 0.75 }}>
          {item.coupon && (
            <Chip
              size="small"
              variant="outlined"
              icon={<AppIcon icon={Tag} size="sm" />}
              sx={{ color: 'text.primary', '& .MuiChip-icon': { color: 'text.secondary' } }}
              label={<Blurred when={blurText} inline radius={5}>{t.coupon(item.coupon)}</Blurred>}
            />
          )}
          {item.imageUnavailable && (
            <Tooltip title={t.imageUnavailableTooltip} arrow>
              <Chip
                size="small"
                variant="outlined"
                icon={<AppIcon icon={ImageOff} size="sm" />}
                label={t.imageUnavailable}
                sx={{ color: 'text.secondary', '& .MuiChip-icon': { color: 'text.secondary' } }}
              />
            </Tooltip>
          )}
          <Typography variant="caption" color="text.secondary">{t.capturedAt(timeOf(item.capturedAt))}</Typography>
          {item.startsAt && !waitingStart && (
            <Typography variant="caption" color="text.secondary">{t.startsAt(timeOf(item.startsAt))}</Typography>
          )}
          {item.expiresAt && <Typography variant="caption" color="text.secondary">{t.expiresAt(timeOf(item.expiresAt))}</Typography>}
          {item.textSource && (
            <Tooltip title={t.textSourceTooltip[item.textSource]} arrow describeChild>
              <Chip size="small" variant="outlined" label={t.textSource[item.textSource]} sx={{ color: 'text.secondary' }} />
            </Tooltip>
          )}
          {item.aiErrorCode && (
            <Tooltip title={t.aiFallbackTooltip(item.aiErrorCode)} arrow describeChild>
              <Chip size="small" variant="outlined" color="warning" label={t.aiFallback} />
            </Tooltip>
          )}
          {queued && item.totalCount > 0 && (
            <Tooltip title={t.progressTooltip} arrow describeChild>
              <Chip size="small" variant="outlined" label={t.progress(item.sentCount, item.totalCount)} sx={{ color: 'text.secondary' }} />
            </Tooltip>
          )}
          {queued && item.offerStatus === 'PAUSED' && (
            <Chip size="small" variant="outlined" color="warning" label={t.offerPaused} />
          )}
          {queued && (item.offerStatus === 'CANCELLED' || item.offerStatus === 'SENT' || item.offerStatus === 'FAILED') && (
            <Chip size="small" variant="outlined" label={t.offerStatus[item.offerStatus]} sx={{ color: 'text.secondary' }} />
          )}
        </Box>

        {waitingStart && item.startsAt && (
          <Box sx={{ mt: 1, maxWidth: 360 }}>
            <StartCooldownBar capturedAt={item.capturedAt} startsAt={item.startsAt} />
          </Box>
        )}
      </Box>

      {controllable && item.offerId && item.offerStatus && (
        <Box sx={{ alignSelf: 'center', flexShrink: 0, flexBasis: { xs: '100%', sm: 'auto' }, pl: { xs: '76px', sm: 0 } }}>
          <OfferControlButtons offerId={item.offerId} offerStatus={item.offerStatus} control={control} variant="text" waitingCount={item.totalCount - item.sentCount} />
        </Box>
      )}

      {canRetryCaptured(item) && (
        // Celular: desce para baixo do conteúdo, alinhado ao texto (64 px da foto + 12 px do vão)
        <Box sx={{ alignSelf: 'center', flexShrink: 0, flexBasis: { xs: '100%', sm: 'auto' }, pl: { xs: '76px', sm: 0 } }}>
          <Tooltip title={t.retryItemTooltip} arrow describeChild>
            <span>
              <Button
                size="small"
                variant="outlined"
                onClick={() => void retry()}
                disabled={retrying}
                startIcon={retrying ? <CircularProgress size={14} color="inherit" /> : <AppIcon icon={RotateCcw} size="sm" />}
              >
                {t.retryItem}
              </Button>
            </span>
          </Tooltip>
        </Box>
      )}
    </Box>
  );
}

/** Ofertas que chegaram dos grupos monitorados e o que aconteceu com cada uma. */
export function CapturedOffersList({ sessionId }: { sessionId: string }) {
  const { items, nextCursor, loading, loadingMore, failed, refresh, loadMore, retry } = useCapturedOffers(sessionId);
  const [toast, setToast] = useState<{ message: string; severity: 'success' | 'error' } | null>(null);
  const control = useOfferControl(refresh);

  const onRetry = async (id: string) => {
    try {
      await retry(id);
      setToast({ message: t.retryDone, severity: 'success' });
    } catch (err) {
      setToast({ message: uiErrorMessage(err, { scope: 'captured' }), severity: 'error' });
    }
  };

  return (
    <SectionCard
      title={t.title}
      subtitle={t.subtitle}
      action={
        <Tooltip title={t.refresh} arrow>
          <span>
            <IconButton size="small" aria-label={t.refresh} onClick={() => void refresh()} disabled={loading}>
              <AppIcon icon={RefreshCw} size="sm" />
            </IconButton>
          </span>
        </Tooltip>
      }
    >
      {loading && items.length === 0 ? (
        <Stack spacing={1}>{[0, 1, 2].map((k) => <Skeleton key={k} variant="rounded" height={80} />)}</Stack>
      ) : failed && items.length === 0 ? (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void refresh()}>{t.retry}</Button>}>
          {t.loadError}
        </Alert>
      ) : items.length === 0 ? (
        <EmptyState icon={<AppIcon icon={Inbox} size="lg" />} title={t.empty} description={t.emptyDescription} />
      ) : (
        <>
          <Box component="ul" sx={{ m: 0, p: 0, '& > li + li': { borderTop: 1, borderColor: 'divider' } }}>
            {items.map((item) => <CapturedOfferRow key={item.id} item={item} onRetry={onRetry} control={control} />)}
          </Box>
          {failed && <Alert severity="error" sx={{ mt: 1 }}>{t.loadError}</Alert>}
          {nextCursor && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1.5 }}>
              <Button
                onClick={() => void loadMore()}
                disabled={loadingMore}
                startIcon={loadingMore ? <CircularProgress size={14} color="inherit" /> : undefined}
              >
                {t.loadMore}
              </Button>
            </Box>
          )}
        </>
      )}

      <OfferControlFeedback control={control} />
      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        {toast ? <Alert severity={toast.severity} onClose={() => setToast(null)} sx={{ width: '100%' }}>{toast.message}</Alert> : undefined}
      </Snackbar>
    </SectionCard>
  );
}
