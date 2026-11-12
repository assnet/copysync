import { useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Collapse, Stack, Tooltip, Typography } from '@mui/material';
import { Check, ChevronDown, ChevronUp, PackageSearch, RotateCcw, Star, X } from 'lucide-react';
import { AppIcon, ConfirmDialog, EmptyState } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import type { HuntFind, OfferHuntFindStatus } from '../../types';
import { offerHunterStrings as t } from '../../strings';
import { formatCents } from '../../format';
import { ProductThumb } from '../ProductThumb';
import { ScoreBar } from '../ScoreBar';

const f = t.finds;
const d = t.detail;

type Decision = 'approve' | 'dismiss' | 'resend';

const STATUS_COLOR: Record<OfferHuntFindStatus, 'default' | 'success' | 'error' | 'warning' | 'info'> = {
  PENDING_REVIEW: 'warning', APPROVED: 'info', DISMISSED: 'default', SENT: 'success', FAILED: 'error',
};

export interface HuntFindsTabProps {
  items: HuntFind[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  errorCode: string | null;
  busyFindId: string | null;
  openFindId: string | null;
  onToggleOpen: (findId: string) => void;
  onLoadMore: () => void;
  onReload: () => void;
  /** Aprovar (PENDING_REVIEW) ou reenviar (FAILED): o servidor usa o mesmo caminho. */
  onApprove: (findId: string) => Promise<unknown>;
  onDismiss: (findId: string) => Promise<unknown>;
}

const pct = (n: number | null) => (n == null ? null : `${Number.isInteger(n) ? n : n.toFixed(1)}%`);
const commissionText = (p: number | null, c: number | null) => [pct(p), formatCents(c)].filter(Boolean).join(' · ') || d.noValue;

/** Achados com aprovar/dispensar (modo revisão), reenviar quando falhou e "carregar mais" pelo cursor. */
export function HuntFindsTab(props: HuntFindsTabProps) {
  const { items, loading, loadingMore, hasMore, errorCode, busyFindId, openFindId, onToggleOpen, onLoadMore, onReload, onApprove, onDismiss } = props;
  const [confirm, setConfirm] = useState<{ id: string; action: Decision } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={28} /></Box>;
  if (errorCode && items.length === 0) {
    return <Alert severity="error" action={<Button color="inherit" size="small" onClick={onReload}>{t.page.retry}</Button>}>{d.listError}</Alert>;
  }
  if (items.length === 0) return <EmptyState icon={<AppIcon icon={PackageSearch} size="lg" />} title={f.emptyTitle} description={f.emptyHint} />;

  const pending = items.filter((x) => x.status === 'PENDING_REVIEW').length;

  const decide = async () => {
    if (!confirm) return;
    const { id, action } = confirm;
    setConfirm(null);
    setActionError(null);
    setNotice(null);
    try {
      if (action === 'dismiss') await onDismiss(id);
      else await onApprove(id);
      setNotice(action === 'dismiss' ? f.dismissed : f.approved);
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      setActionError((typeof code === 'string' && t.errors[code]) || t.errors.generic);
      if (code === 'OFFER_HUNT_FIND_INVALID_STATE') onReload();
    }
  };

  const dialog = confirm && {
    approve: { title: d.approveTitle, text: d.approveText, label: f.approve },
    resend: { title: d.resendTitle, text: d.approveText, label: d.resend },
    dismiss: { title: d.dismissTitle, text: d.dismissText, label: f.dismiss },
  }[confirm.action];

  return (
    <Box>
      {pending > 0 && <Alert severity="info" sx={{ mb: 1.5 }}>{f.pendingTitle(pending)}</Alert>}
      {actionError && <Alert severity="error" role="alert" sx={{ mb: 1.5 }} onClose={() => setActionError(null)}>{actionError}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 1.5 }} onClose={() => setNotice(null)}>{notice}</Alert>}

      <Stack component="ul" aria-label={d.findsListLabel} spacing={1} sx={{ m: 0, p: 0, listStyle: 'none' }}>
        {items.map((item) => (
          <FindItem
            key={item.id}
            item={item}
            open={openFindId === item.id}
            busy={busyFindId === item.id}
            onToggle={() => onToggleOpen(item.id)}
            onAsk={(action) => setConfirm({ id: item.id, action })}
          />
        ))}
      </Stack>

      {errorCode && <Alert severity="error" sx={{ mt: 1.5 }}>{d.loadMoreError}</Alert>}
      {hasMore && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
          <Button onClick={onLoadMore} disabled={loadingMore}>{loadingMore ? <CircularProgress size={18} /> : f.loadMore}</Button>
        </Box>
      )}

      <ConfirmDialog
        open={Boolean(dialog)}
        title={dialog?.title ?? ''}
        description={dialog?.text ?? ''}
        confirmLabel={dialog?.label ?? ''}
        cancelLabel={d.confirmCancel}
        onConfirm={() => void decide()}
        onClose={() => setConfirm(null)}
      />
    </Box>
  );
}

function FindItem({ item, open, busy, onToggle, onAsk }: {
  item: HuntFind; open: boolean; busy: boolean; onToggle: () => void; onAsk: (a: Decision) => void;
}) {
  const blur = useBlur('offerHunter.productText');
  const price = formatCents(item.priceCents);
  const original = item.originalPriceCents != null && item.originalPriceCents > (item.priceCents ?? 0) ? formatCents(item.originalPriceCents) : null;
  const facts: string[] = [
    item.salesBucket != null ? f.sales(item.salesBucket) : '',
    item.reviewsBucket != null ? f.reviews(item.reviewsBucket) : '',
  ].filter(Boolean);
  const detailsId = `find-${item.id}-details`;

  return (
    <Box component="li" data-testid="hunt-find" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'auto 1fr', sm: 'auto 1fr 150px' }, columnGap: 1.5, rowGap: 1, alignItems: 'start' }}>
        <ProductThumb src={null} size={56} />
        <Box sx={{ minWidth: 0 }}>
          <Blurred when={blur} radius={5}>
            <Typography variant="body2" sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
              {item.title || t.ranking.noTitle}
            </Typography>
          </Blurred>
          <Box sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 1, rowGap: 0.25, mt: 0.25 }}>
            {price && (
              <Blurred when={blur} radius={5} inline>
                <Typography component="span" variant="subtitle2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{price}</Typography>
              </Blurred>
            )}
            {original && (
              <Typography component="span" variant="caption" color="text.secondary" sx={{ textDecoration: 'line-through' }}>
                <Blurred when={blur} radius={5} inline>{original}</Blurred>
              </Typography>
            )}
            {item.discountPercent != null && item.discountPercent > 0 && <Chip size="small" color="success" variant="outlined" label={f.discount(item.discountPercent)} sx={{ height: 20 }} />}
            {item.rating != null && (
              <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }} aria-label={`${f.rating} ${item.rating.toFixed(1)}`}>
                <AppIcon icon={Star} size="inline" />{item.rating.toFixed(1)}
              </Typography>
            )}
            {facts.length > 0 && <Typography component="span" variant="caption" color="text.secondary">{facts.join(' · ')}</Typography>}
          </Box>
        </Box>
        <Box sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' } }}>
          <ScoreBar score={item.score} factors={item.factors} emphasis={item.status !== 'DISMISSED'} />
        </Box>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 1, mt: 1.25 }}>
        <Fact label={d.newCommission} value={commissionText(item.commissionPercent, item.commissionCents)} />
        <Fact label={f.returningCommission} value={commissionText(item.returningCommissionPercent, item.returningCommissionCents)} />
        <Fact label={f.extraCommission} value={formatCents(item.extraCommissionCents) ?? d.noValue} />
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mt: 1.25 }}>
        <Chip size="small" color={STATUS_COLOR[item.status]} label={t.findStatus[item.status]} />
        <Button
          size="small"
          color="inherit"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={detailsId}
          endIcon={<AppIcon icon={open ? ChevronUp : ChevronDown} size="sm" />}
        >
          {open ? d.hideDetails : d.showDetails}
        </Button>
        <Box sx={{ flex: 1 }} />
        {busy && <CircularProgress size={18} />}
        {item.status === 'PENDING_REVIEW' && (
          <>
            <Tooltip title={f.dismissTooltip} arrow describeChild>
              <Button size="small" color="inherit" variant="outlined" disabled={busy} onClick={() => onAsk('dismiss')} startIcon={<AppIcon icon={X} size="sm" />}>{f.dismiss}</Button>
            </Tooltip>
            <Tooltip title={f.approveTooltip} arrow describeChild>
              <Button size="small" variant="contained" disableElevation disabled={busy} onClick={() => onAsk('approve')} startIcon={<AppIcon icon={Check} size="sm" />}>{f.approve}</Button>
            </Tooltip>
          </>
        )}
        {item.status === 'FAILED' && (
          <Tooltip title={d.resendTooltip} arrow describeChild>
            <Button size="small" variant="outlined" disabled={busy} onClick={() => onAsk('resend')} startIcon={<AppIcon icon={RotateCcw} size="sm" />}>{d.resend}</Button>
          </Tooltip>
        )}
      </Box>

      <Collapse in={open} unmountOnExit>
        <Box id={detailsId} sx={{ mt: 1.25, pt: 1.25, borderTop: '1px solid', borderColor: 'divider' }}>
          {item.aiReason && (
            <Typography variant="body2" sx={{ mb: 1 }}>
              <Box component="span" sx={{ fontWeight: 600 }}>{`${f.aiReason}: `}</Box>
              <Blurred when={blur} radius={5} inline>{item.aiReason}</Blurred>
            </Typography>
          )}
          {item.status === 'FAILED' && item.failureReason && (
            <Typography variant="body2" color="error" sx={{ mb: 1 }}>
              {`${f.failure}: ${t.errors[item.failureReason] ?? d.unknownError(item.failureReason)}`}
            </Typography>
          )}
          <Stack component="ul" spacing={0.5} sx={{ m: 0, p: 0, listStyle: 'none' }}>
            {item.factors.map((x) => (
              <Box component="li" key={x.key} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                <Tooltip title={t.factors[x.key].hint} arrow describeChild enterTouchDelay={0}>
                  <Typography variant="caption" sx={{ fontWeight: 600, textDecoration: 'underline dotted', cursor: 'help' }} tabIndex={0}>{t.factors[x.key].label}</Typography>
                </Tooltip>
                <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>{t.factorPoints(x.points, x.max)}</Typography>
              </Box>
            ))}
          </Stack>
        </Box>
      </Collapse>
    </Box>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  const blur = useBlur('offerHunter.productText');
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" component="p">{label}</Typography>
      <Blurred when={blur} radius={5}>
        <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
      </Blurred>
    </Box>
  );
}
