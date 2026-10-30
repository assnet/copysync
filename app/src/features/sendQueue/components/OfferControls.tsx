import { useCallback, useState } from 'react';
import { Alert, Button, CircularProgress, IconButton, Stack, Tooltip } from '@mui/material';
import { Pause, Play, Square } from 'lucide-react';
import { AppIcon, ConfirmDialog } from '@/components';
import { offerService } from '@/services/offer.service';
import type { OfferItem, OfferStatus } from '@/types/api.types';
import { sendQueueStrings as t } from '../strings';

/** Spinner parado com movimento reduzido (a raiz gira e o círculo pulsa). */
const SPINNER_SX = { '@media (prefers-reduced-motion: reduce)': { animation: 'none', '& .MuiCircularProgress-circle': { animation: 'none' } } };

export type OfferControlAction = 'pause' | 'resume' | 'cancel';

export interface OfferControl {
  /** Oferta com chamada em curso (desabilita os botões dela). */
  busyOfferId: string | null;
  confirmStop: string | null;
  error: boolean;
  run: (action: OfferControlAction, offerId: string) => void;
  askStop: (offerId: string) => void;
  confirmStopNow: () => void;
  closeConfirm: () => void;
  dismissError: () => void;
}

/**
 * Pausar / retomar / parar agem na OFERTA (todos os envios dela), pelos mesmos endpoints do
 * gerador. 409 `OFFER_INVALID_STATE` = o estado mudou antes do clique (terminou, outra aba parou):
 * só recarrega, sem erro. Parar é final e pede confirmação (`OfferControlFeedback`).
 */
export function useOfferControl(refresh: () => Promise<void>): OfferControl {
  const [busyOfferId, setBusy] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const run = useCallback((action: OfferControlAction, offerId: string) => {
    setBusy(offerId);
    setError(false);
    const call: Promise<OfferItem> = offerService[action](offerId);
    call
      .catch((err: unknown) => {
        if ((err as { code?: unknown } | null)?.code !== 'OFFER_INVALID_STATE') setError(true);
      })
      .then(() => refresh())
      .finally(() => setBusy((cur) => (cur === offerId ? null : cur)));
  }, [refresh]);

  const confirmStopNow = useCallback(() => {
    if (confirmStop) run('cancel', confirmStop);
    setConfirmStop(null);
  }, [confirmStop, run]);

  return {
    busyOfferId,
    confirmStop,
    error,
    run,
    askStop: setConfirmStop,
    confirmStopNow,
    closeConfirm: () => setConfirmStop(null),
    dismissError: () => setError(false),
  };
}

/** Oferta que ainda tem o que segurar: enviando ou pausada. */
export function isControllableOffer(status: OfferStatus | null | undefined): boolean {
  return status === 'SENDING' || status === 'PAUSED';
}

interface ButtonsProps {
  offerId: string;
  offerStatus: OfferStatus;
  control: OfferControl;
  /** `icon`: só ícones (linha da fila). `text`: botões com rótulo (card da captura). */
  variant: 'icon' | 'text';
  /** Envios aguardando desta oferta, para o tooltip dizer o alcance do clique. */
  waitingCount?: number;
}

/** Pausar ou retomar + parar, para uma oferta. Renderiza nada se a oferta já terminou. */
export function OfferControlButtons({ offerId, offerStatus, control, variant, waitingCount }: ButtonsProps) {
  if (!isControllableOffer(offerStatus)) return null;
  const busy = control.busyOfferId === offerId;
  const paused = offerStatus === 'PAUSED';
  const scope = waitingCount != null ? t.control.scope(waitingCount) : '';
  const main = paused
    ? { label: t.control.resume, tip: t.control.resumeTooltip + scope, icon: Play, onClick: () => control.run('resume', offerId) }
    : { label: t.control.pause, tip: t.control.pauseTooltip + scope, icon: Pause, onClick: () => control.run('pause', offerId) };
  const stop = { label: t.control.stop, tip: t.control.stopTooltip + scope, icon: Square, onClick: () => control.askStop(offerId) };

  if (variant === 'icon') {
    const icon = (a: typeof main, color?: 'error') => (
      <Tooltip title={a.tip} arrow describeChild>
        <span>
          <IconButton size="small" aria-label={a.label} onClick={a.onClick} disabled={busy} color={color}>
            <AppIcon icon={a.icon} size="sm" />
          </IconButton>
        </span>
      </Tooltip>
    );
    return <Stack direction="row" spacing={0}>{icon(main)}{icon(stop, 'error')}</Stack>;
  }

  const button = (a: typeof main, color: 'primary' | 'error') => (
    <Tooltip title={a.tip} arrow describeChild>
      <span>
        <Button
          size="small"
          variant="outlined"
          color={color}
          onClick={a.onClick}
          disabled={busy}
          startIcon={busy ? <CircularProgress size={14} color="inherit" sx={SPINNER_SX} /> : <AppIcon icon={a.icon} size="sm" />}
        >
          {a.label}
        </Button>
      </span>
    </Tooltip>
  );
  return <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>{button(main, 'primary')}{button(stop, 'error')}</Stack>;
}

/** Diálogo de "parar" e alerta de erro: uma vez por tela que usa `useOfferControl`. */
export function OfferControlFeedback({ control }: { control: OfferControl }) {
  return (
    <>
      {control.error && (
        <Alert severity="error" sx={{ mt: 2 }} onClose={control.dismissError}>{t.controlError}</Alert>
      )}
      <ConfirmDialog
        open={control.confirmStop !== null}
        title={t.stopConfirmTitle}
        description={t.stopConfirmDescription}
        confirmLabel={t.stopConfirm}
        cancelLabel={t.stopCancel}
        confirmColor="error"
        onConfirm={control.confirmStopNow}
        onClose={control.closeConfirm}
      />
    </>
  );
}
