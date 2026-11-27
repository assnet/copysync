import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { offerWatermarkService } from '../offerWatermark.service';
import type { OfferWatermark } from '../types';
import { useOfferWatermarkAccess } from './useOfferWatermarkAccess';

/** Mesma condição do `applies(tenantId)` da API: ligada e com o dado do tipo escolhido. */
export function previewWatermarkOf(w: OfferWatermark): OfferWatermark | null {
  if (!w.enabled) return null;
  if (w.kind === 'IMAGE') return w.imageUrl ? w : null;
  return (w.text ?? '').trim() !== '' ? w : null;
}

/**
 * Marca d'água para a prévia da oferta no gerador. Só consulta `GET /offer-watermark` quando a audiência deixa
 * ver o recurso; lida de novo a cada montagem (por usuário + tenant), nunca guardada no navegador.
 * Desligada, sem logo/texto, sem plano (403), fora da audiência (404) ou erro de rede = `null`: a prévia sai sem marca.
 */
export function useOfferPreviewWatermark(): OfferWatermark | null {
  const { visible } = useOfferWatermarkAccess();
  const { user } = useAuth();
  const { activeTenantId } = useTenant();
  const key = visible && user ? `${user.id}:${activeTenantId ?? ''}` : null;
  const [state, setState] = useState<{ key: string; mark: OfferWatermark | null } | null>(null);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    offerWatermarkService.get()
      .then((w) => previewWatermarkOf(w))
      .catch(() => null)
      .then((mark) => {
        if (!cancelled) setState({ key, mark });
      });
    return () => { cancelled = true; };
  }, [key]);

  return key && state?.key === key ? state.mark : null;
}
