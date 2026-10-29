import { useState, type CSSProperties, type HTMLAttributes, type Ref } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Avatar, Box, Button, Chip, IconButton, Stack, Tooltip, Typography, alpha } from '@mui/material';
import { ArrowDown, ArrowUp, ExternalLink, EyeOff, GripVertical, ImageOff, Pencil, Send, ShieldAlert, Trash2 } from 'lucide-react';
import { AppIcon, ConfirmDialog } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { storefrontStrings } from '../strings';
import type { StorefrontOffer } from '../types';
import type { MoveDirection } from '../reorder';
import { formatCents } from '../offerForm';

const t = storefrontStrings.offers;
export const AFFILIATE_CREDENTIALS_PATH = '/settings/affiliate-credentials';

/** Ligação com o arrastar (`useSortable` em `OfferTabs`); a linha não conhece a lib. */
export interface OfferRowDrag {
  setNodeRef: Ref<HTMLDivElement>;
  setHandleRef: Ref<HTMLButtonElement>;
  handleProps: Omit<HTMLAttributes<HTMLButtonElement>, 'color'>;
  style?: CSSProperties;
  dragging?: boolean;
}

export interface OfferRowProps {
  offer: StorefrontOffer;
  /** Rótulo já resolvido; null = sem categoria. */
  categoryLabel: string | null;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (dir: MoveDirection) => void;
  /** Publicar (rascunho) ou despublicar (publicada); a linha fica ocupada até resolver. */
  onToggleStatus: () => Promise<void>;
  onEdit: () => void;
  /** Chamado só depois da confirmação. */
  onDelete: () => Promise<void>;
  drag?: OfferRowDrag;
}

function Price({ offer }: { offer: StorefrontOffer }) {
  if (offer.priceCents === null) return <Typography variant="body2" color="text.secondary">{t.noPrice}</Typography>;
  const from = offer.originalPriceCents !== null && offer.originalPriceCents > offer.priceCents ? offer.originalPriceCents : null;
  return (
    <Stack direction="row" spacing={1} alignItems="baseline">
      {from !== null && (
        <Typography variant="caption" color="text.secondary" sx={{ textDecoration: 'line-through' }}>{formatCents(from)}</Typography>
      )}
      <Typography variant="body2" sx={{ fontWeight: 700 }} color="primary">{formatCents(offer.priceCents)}</Typography>
    </Stack>
  );
}

/** Uma oferta da lista: alça, imagem, dados, mover ▲▼ e ações. */
export function OfferRow({ offer, categoryLabel, canMoveUp, canMoveDown, onMove, onToggleStatus, onEdit, onDelete, drag }: OfferRowProps) {
  const blurTitle = useBlur('storefront.offerTitle');
  const blurImage = useBlur('storefront.offerImage');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const published = offer.status === 'PUBLISHED';

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      ref={drag?.setNodeRef}
      style={drag?.style}
      sx={(theme) => ({
        display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, borderRadius: 2, border: 1, borderColor: 'divider',
        bgcolor: 'background.paper', position: 'relative', flexWrap: { xs: 'wrap', md: 'nowrap' },
        ...(drag?.dragging && { zIndex: 1, boxShadow: theme.shadows[6], borderColor: 'primary.main' }),
        opacity: busy ? 0.6 : 1,
      })}
    >
      {drag && (
        <Tooltip title={t.dragHandle} arrow>
          <IconButton
            ref={drag.setHandleRef}
            size="small"
            aria-label={t.dragHandle}
            {...drag.handleProps}
            sx={{ cursor: drag.dragging ? 'grabbing' : 'grab', touchAction: 'none', color: 'text.secondary' }}
          >
            <AppIcon icon={GripVertical} size="sm" />
          </IconButton>
        </Tooltip>
      )}

      <Blurred when={blurImage} radius={10}>
        <Avatar
          variant="rounded"
          src={offer.imageUrl ?? undefined}
          alt=""
          sx={(theme) => ({ width: 56, height: 56, bgcolor: alpha(theme.palette.text.primary, 0.06), color: 'text.disabled' })}
        >
          <AppIcon icon={ImageOff} size="md" />
        </Avatar>
      </Blurred>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" alignItems="center" sx={{ mb: 0.5 }}>
          <Chip size="small" variant="outlined" label={t.provider(offer.provider)} />
          <Chip size="small" variant="outlined" label={categoryLabel ?? storefrontStrings.addOffer.noCategory} />
          {!offer.attributionVerified && (
            <Tooltip title={t.unverified.tooltip} arrow describeChild>
              <Chip
                size="small"
                color="warning"
                icon={<AppIcon icon={ShieldAlert} size="sm" />}
                label={t.unverified.badge}
                component={RouterLink}
                to={AFFILIATE_CREDENTIALS_PATH}
                clickable
              />
            </Tooltip>
          )}
        </Stack>
        <Blurred when={blurTitle} inline radius={5}>
          <Typography variant="subtitle2" noWrap title={offer.title} sx={{ fontWeight: 600 }}>{offer.title}</Typography>
        </Blurred>
        <Price offer={offer} />
      </Box>

      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexShrink: 0, ml: { xs: 'auto', md: 0 } }}>
        <Tooltip title={t.moveUp} arrow>
          <span>
            <IconButton size="small" aria-label={t.moveUp} disabled={!canMoveUp || busy} onClick={() => onMove('up')}>
              <AppIcon icon={ArrowUp} size="sm" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t.moveDown} arrow>
          <span>
            <IconButton size="small" aria-label={t.moveDown} disabled={!canMoveDown || busy} onClick={() => onMove('down')}>
              <AppIcon icon={ArrowDown} size="sm" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t.openLink} arrow>
          <IconButton size="small" component="a" href={offer.affiliateUrl} target="_blank" rel="noopener noreferrer" aria-label={t.openLink}>
            <AppIcon icon={ExternalLink} size="sm" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t.edit} arrow>
          <span>
            <IconButton size="small" aria-label={t.edit} disabled={busy} onClick={onEdit}>
              <AppIcon icon={Pencil} size="sm" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t.delete} arrow>
          <span>
            <IconButton size="small" color="error" aria-label={t.delete} disabled={busy} onClick={() => setConfirmDelete(true)}>
              <AppIcon icon={Trash2} size="sm" />
            </IconButton>
          </span>
        </Tooltip>
        <Button
          size="small"
          variant={published ? 'outlined' : 'contained'}
          disableElevation
          disabled={busy}
          startIcon={<AppIcon icon={published ? EyeOff : Send} size="sm" />}
          onClick={() => void run(onToggleStatus)}
          sx={{ ml: 0.5, minWidth: 116 }}
        >
          {published ? t.unpublish : t.publish}
        </Button>
      </Stack>

      <ConfirmDialog
        open={confirmDelete}
        title={t.confirmDelete.title}
        description={blurTitle ? t.confirmDelete.messageHidden : t.confirmDelete.message(offer.title)}
        confirmLabel={t.confirmDelete.confirm}
        cancelLabel={t.confirmDelete.cancel}
        confirmColor="error"
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          void run(onDelete);
        }}
      />
    </Box>
  );
}
