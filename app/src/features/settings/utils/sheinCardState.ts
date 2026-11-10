import type { AffiliateCredentialItem, MarketplaceAvailability } from '@/types/api.types';
import type { ExtensionStatus } from '@/features/extension/hooks/useExtension';

/**
 * Estados do card Shein (desenho §Painel): travado por plano, sem extensão (ou sem a capacidade
 * `shein.session`), sem vínculo, pronto, conectado, recusada e reaceite (credencial existente com
 * aviso em versão nova). `checking` = extensão ainda respondendo ao handshake.
 */
export type SheinCardState =
  | 'locked'
  | 'checking'
  | 'no_extension'
  | 'outdated_extension'
  | 'no_link'
  | 'ready'
  | 'connected'
  | 'rejected'
  | 'reaccept';

export interface SheinCardStateInput {
  availability?: MarketplaceAvailability;
  item?: AffiliateCredentialItem;
  extStatus: ExtensionStatus;
  extLoading: boolean;
  /** Handshake anunciou `shein.session`. */
  supportsShein: boolean;
  /** 404 `SESSION_NOT_FOUND` no clique em "Conectar Shein", até o próximo `refresh()` ok. */
  noLinkFlag: boolean;
}

/**
 * Função pura: decide o estado a partir do que a API e a extensão já disseram. "Sem vínculo" nunca
 * nasce de sondagem a `/consent` — só de `isConnected` falso (status `detected`) ou da flag do clique.
 */
export function sheinCardState(i: SheinCardStateInput): SheinCardState {
  if (i.availability && !i.availability.enabled) return 'locked';
  // Credencial existe e o aviso vigente não tem aceite: tudo parado até o reaceite.
  if (i.item && i.availability?.riskNotice && !i.availability.riskNotice.acceptedAt) return 'reaccept';
  if (i.item?.rejectedAt) return 'rejected';
  if (i.item?.hasSession) return 'connected';
  if (i.extLoading && i.extStatus === 'unavailable') return 'checking';
  if (i.extStatus === 'unavailable' || i.extStatus === 'not_detected' || i.extStatus === 'error') return 'no_extension';
  if (!i.supportsShein) return 'outdated_extension';
  if (i.extStatus === 'detected' || i.noLinkFlag) return 'no_link';
  return 'ready';
}

/** O aviso de risco aparece em todo estado com plano liberado. */
export function showsRiskBanner(state: SheinCardState): boolean {
  return state !== 'locked';
}
