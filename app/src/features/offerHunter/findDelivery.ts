import { offerHunterStrings } from './strings';
import { formatDateTime } from './format';
import type { HuntFind } from './types';

const t = offerHunterStrings;

export type FindChipColor = 'default' | 'success' | 'error' | 'warning' | 'info';

/**
 * Rótulo e cor do estado do achado. Com oferta, vale o envio real (`dispatchStatus`): QUEUED/SENDING =
 * "Na fila de envio", SENT = "Enviado" (com hora no detalhe), FAILED = "Falhou ao enviar", SKIPPED/CANCELLED =
 * "Não enviado". Sem disparo, o estado do achado (o `SENT` dele só quer dizer "entregue à fila").
 */
export function findStatusChip(find: HuntFind): { label: string; color: FindChipColor } {
  const d = t.finds.dispatch;
  switch (find.dispatchStatus) {
    case 'QUEUED':
    case 'SENDING':
      return { label: d.queued, color: 'info' };
    case 'SENT':
      return { label: d.sent, color: 'success' };
    case 'FAILED':
      return { label: d.failed, color: 'error' };
    case 'SKIPPED':
    case 'CANCELLED':
      return { label: d.notSent, color: 'default' };
    default:
      break;
  }
  const color: Record<HuntFind['status'], FindChipColor> = {
    PENDING_REVIEW: 'warning', APPROVED: 'info', DISMISSED: 'default', SENT: 'info', FAILED: 'error',
  };
  // Achado SENT sem disparo lido = só entregue à fila
  return { label: find.status === 'SENT' ? d.queued : t.findStatus[find.status], color: color[find.status] };
}

/** "Enviado em 12/11/26 15:00" (só com SENT e hora). */
export function findSentAtLabel(find: HuntFind): string | null {
  const when = find.dispatchStatus === 'SENT' ? formatDateTime(find.sentAt) : null;
  return when ? t.finds.dispatch.sentAt(when) : null;
}

/** Reenviar: achado com oferta; travado enquanto o envio anterior está na fila. */
export function findResendState(find: HuntFind): 'hidden' | 'pending' | 'ready' {
  if (!find.offerId) return 'hidden';
  return find.dispatchStatus === 'QUEUED' || find.dispatchStatus === 'SENDING' ? 'pending' : 'ready';
}
