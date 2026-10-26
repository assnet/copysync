import { useEffect, useMemo, useState } from 'react';
import type { OfferItem, UpdateOfferRequest } from '@/types/api.types';

export const OFFER_TEXT_MAX = 4096;

export interface OfferDraft {
  title: string;
  priceCents: number | null;
  originalPriceCents: number | null;
  text: string;
}

const fromOffer = (offer: OfferItem | null): OfferDraft => ({
  title: offer?.title ?? '',
  priceCents: offer?.priceCents ?? null,
  originalPriceCents: offer?.originalPriceCents ?? null,
  text: offer?.text ?? '',
});

/** Só o que mudou em relação à oferta salva; `{}` = nada a salvar. */
export function diffDraft(offer: OfferItem, draft: OfferDraft): UpdateOfferRequest {
  const patch: UpdateOfferRequest = {};
  const title = draft.title.trim() || null;
  if (title !== (offer.title ?? null)) patch.title = title;
  if (draft.priceCents !== offer.priceCents) patch.priceCents = draft.priceCents;
  if (draft.originalPriceCents !== offer.originalPriceCents) patch.originalPriceCents = draft.originalPriceCents;
  if (draft.text !== offer.text) patch.text = draft.text;
  return patch;
}

/**
 * Rascunho local dos campos editáveis. Volta ao valor salvo sempre que a oferta muda no servidor
 * (salvar, trocar foto): o texto remontado pela API aparece sem o operador fazer nada.
 */
export function useOfferDraft(offer: OfferItem | null) {
  const [draft, setDraft] = useState<OfferDraft>(() => fromOffer(offer));

  useEffect(() => {
    setDraft(fromOffer(offer));
    // `updatedAt` muda a cada gravação; o objeto inteiro mudaria também a cada polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer?.id, offer?.updatedAt]);

  const patch = useMemo(() => (offer ? diffDraft(offer, draft) : {}), [offer, draft]);
  const dirty = Object.keys(patch).length > 0;
  const textTooLong = draft.text.length > OFFER_TEXT_MAX;
  const missingLink = Boolean(offer && !draft.text.includes(offer.affiliateUrl));

  return {
    draft,
    setField: <K extends keyof OfferDraft>(key: K, value: OfferDraft[K]) =>
      setDraft((prev) => ({ ...prev, [key]: value })),
    patch,
    dirty,
    textTooLong,
    missingLink,
  };
}
