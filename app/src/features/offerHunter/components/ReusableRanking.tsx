import { useMemo, useState } from 'react';
import { Alert, AlertTitle, Box, Button, CircularProgress, Snackbar, Stack, Tooltip, Typography } from '@mui/material';
import { SendHorizontal } from 'lucide-react';
import { AppIcon, ConfirmDialog } from '@/components';
import { useAuth } from '@/contexts/AuthContext';
import { Blurred, useBlur } from '@/features/privacy';
import type { HuntRankingItem } from '../types';
import { offerHunterStrings as t, rankingReuseErrorMessage } from '../strings';
import { useRankingSend } from '../hooks/useRankingSend';
import { RankingTable } from './RankingTable';

const ru = t.rankingReuse;

export interface ReusableRankingProps {
  huntId: string;
  runId: string;
  items: HuntRankingItem[];
  /** Produtos com achado desta execução (`sentProductIds` do `GET /:id/runs/:runId`). */
  sentProductIds: readonly string[];
  /** Execução com até 48 h (`rankingReusable`). */
  reusable: boolean;
  /** Grupo de destino atual do caçador (texto da confirmação; some com a flag de borrar). */
  destinationGroupName: string | null;
  /** Após enviar (ou o servidor dizer que já foi/expirou): recarregar a execução e os achados. */
  onChanged: (sentProductIds: string[]) => void;
}

type Confirm = { kind: 'one'; item: HuntRankingItem } | { kind: 'all'; count: number };

/**
 * Ranking com reaproveitamento: "Enviar" em cada item não escolhido e não enviado (confirmação leve) e,
 * só para super admin, "Enviar todas as não escolhidas" com o resumo do que foi pulado.
 */
export function ReusableRanking({ huntId, runId, items, sentProductIds, reusable, destinationGroupName, onChanged }: ReusableRankingProps) {
  const { user } = useAuth();
  const isSuperAdmin = user?.isSuperAdmin === true;
  const blurGroup = useBlur('offerHunter.groupNames');
  const blurText = useBlur('offerHunter.productText');
  const sender = useRankingSend(huntId, runId);
  // Marcados aqui na hora; a execução recarregada traz a lista oficial
  const [justSent, setJustSent] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<{ productId: string; reason: string }[]>([]);

  const sent = useMemo(() => new Set([...sentProductIds, ...justSent]), [sentProductIds, justSent]);
  const pendingCount = items.filter((i) => !i.chosen && !sent.has(i.productId)).length;
  const group = blurGroup ? null : destinationGroupName;
  const titleOf = (productId: string) => items.find((i) => i.productId === productId)?.title || t.ranking.noTitle;

  const markSent = (ids: string[]) => {
    if (ids.length) setJustSent((s) => [...s, ...ids]);
  };

  const sendOne = async (item: HuntRankingItem) => {
    setError(null);
    const out = await sender.sendOne(item.productId);
    if (out.ok) {
      markSent([item.productId]);
      setToast(ru.sentNotice);
      onChanged([item.productId]);
      return;
    }
    setError(rankingReuseErrorMessage(out.code));
    if (out.code === 'OFFER_HUNT_ALREADY_SENT') {
      markSent([item.productId]);
      onChanged([item.productId]);
    } else if (out.code === 'OFFER_HUNT_RANKING_EXPIRED') {
      onChanged([]);
    }
  };

  const sendAll = async () => {
    setError(null);
    setSkipped([]);
    const pending = items.filter((i) => !i.chosen && !sent.has(i.productId)).map((i) => i.productId);
    const out = await sender.sendAll();
    if (!out.ok) {
      setError(rankingReuseErrorMessage(out.code));
      onChanged([]);
      return;
    }
    const skippedIds = new Set(out.result.skipped.map((s) => s.productId));
    // Marca na hora só quando a conta fecha (parar num portão deixa itens sem tentar); senão espera a execução recarregada
    const done = pending.filter((id) => !skippedIds.has(id));
    const confirmed = done.length === out.result.sent ? done : [];
    markSent(confirmed);
    setSkipped(out.result.skipped);
    setToast(ru.sendAllResult(out.result.sent, out.result.skipped.length));
    onChanged(confirmed);
  };

  const onConfirm = () => {
    const c = confirm;
    setConfirm(null);
    if (!c) return;
    if (c.kind === 'one') void sendOne(c.item);
    else void sendAll();
  };

  return (
    <Stack spacing={1.25}>
      {isSuperAdmin && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Tooltip title={!reusable ? ru.expiredTooltip : pendingCount === 0 ? ru.sendAllNone : ru.sendAllTooltip} arrow describeChild enterTouchDelay={0}>
            <span>
              <Button
                size="small"
                variant="contained"
                disableElevation
                disabled={!reusable || pendingCount === 0 || sender.busy}
                onClick={() => setConfirm({ kind: 'all', count: pendingCount })}
                startIcon={sender.sendingAll ? <CircularProgress size={14} color="inherit" aria-hidden /> : <AppIcon icon={SendHorizontal} size="inline" />}
              >
                {sender.sendingAll ? ru.sending : ru.sendAll}
              </Button>
            </span>
          </Tooltip>
        </Box>
      )}

      {error && <Alert severity="error" role="alert" onClose={() => setError(null)}>{error}</Alert>}

      {skipped.length > 0 && (
        <Alert severity="warning" onClose={() => setSkipped([])}>
          <AlertTitle>{ru.skippedTitle}</AlertTitle>
          <Box component="ul" aria-label={ru.skippedLabel} sx={{ m: 0, pl: 2 }}>
            {skipped.map((s) => (
              <Typography component="li" variant="body2" key={s.productId}>
                <Blurred when={blurText} radius={5} inline>{titleOf(s.productId)}</Blurred>
                {`: ${rankingReuseErrorMessage(s.reason)}`}
              </Typography>
            ))}
          </Box>
        </Alert>
      )}

      <RankingTable
        items={items}
        reuse={{
          sentProductIds: sent,
          reusable,
          busyProductId: sender.busyProductId,
          busy: sender.busy || confirm !== null,
          onSend: (item) => setConfirm({ kind: 'one', item }),
        }}
      />

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === 'all' ? ru.sendAllTitle(confirm.count) : ru.confirmTitle}
        description={confirm?.kind === 'all' ? ru.sendAllText(confirm.count, group) : ru.confirmText(group)}
        confirmLabel={confirm?.kind === 'all' ? ru.sendAllConfirm : ru.confirmSend}
        cancelLabel={ru.confirmCancel}
        onConfirm={onConfirm}
        onClose={() => setConfirm(null)}
      />

      <Snackbar open={toast !== null} autoHideDuration={5000} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="success" variant="filled" onClose={() => setToast(null)}>{toast}</Alert>
      </Snackbar>
    </Stack>
  );
}
