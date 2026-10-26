import { useCallback, useEffect, useRef, useState } from 'react';
import { offerService } from '@/services/offer.service';
import { mediaService } from '@/services/media.service';
import { uploadInParts } from '@/features/chat/media/chunkedUpload';
import type { OfferDestinationItem, OfferItem, OfferUsage, UpdateOfferRequest } from '@/types/api.types';
import { toOfferError, type OfferErrorView } from '../utils/offerErrors';

/** Intervalo do polling de progresso enquanto a oferta está `SENDING`. */
const POLL_INTERVAL_MS = 3_000;

/**
 * Estado do gerador (sem store global): oferta atual, uso do dia e destinos.
 * Componentes só leem e chamam ações; toda chamada HTTP passa por aqui.
 * Ações que falham devolvem `OfferErrorView` em `error` e rejeitam, para o formulário reagir.
 */
export function useOfferGenerator() {
  const [offer, setOffer] = useState<OfferItem | null>(null);
  const [needsManualData, setNeedsManualData] = useState(false);
  const [usage, setUsage] = useState<OfferUsage | null>(null);
  const [destinations, setDestinations] = useState<OfferDestinationItem[]>([]);
  const [destinationsLoaded, setDestinationsLoaded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [imageProgress, setImageProgress] = useState<number | null>(null);
  const [error, setError] = useState<OfferErrorView | null>(null);
  const usageRef = useRef(usage);
  usageRef.current = usage;
  const uploadAbort = useRef<AbortController | null>(null);

  const fail = useCallback((err: unknown): never => {
    const view = toOfferError(err, usageRef.current?.limit);
    setError(view);
    throw view;
  }, []);

  const loadUsage = useCallback(async () => {
    try {
      setUsage(await offerService.usage());
    } catch {
      // Uso é informativo: sem ele o chip some e o servidor ainda barra no limite.
    }
  }, []);

  const loadDestinations = useCallback(async () => {
    try {
      setDestinations(await offerService.listDestinations());
    } catch (err) {
      setError(toOfferError(err));
    } finally {
      setDestinationsLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadUsage();
    void loadDestinations();
  }, [loadUsage, loadDestinations]);

  useEffect(() => () => uploadAbort.current?.abort(), []);

  const generate = useCallback(async (url: string) => {
    setGenerating(true);
    setError(null);
    try {
      const res = await offerService.generate(url);
      setOffer(res.offer);
      setNeedsManualData(res.needsManualData);
    } catch (err) {
      fail(err);
    } finally {
      setGenerating(false);
      void loadUsage();
    }
  }, [fail, loadUsage]);

  const update = useCallback(async (body: UpdateOfferRequest): Promise<OfferItem> => {
    if (!offer) throw new Error('no offer');
    setSaving(true);
    setError(null);
    try {
      const saved = await offerService.update(offer.id, body);
      setOffer(saved);
      return saved;
    } catch (err) {
      return fail(err);
    } finally {
      setSaving(false);
    }
  }, [offer, fail]);

  const replaceImage = useCallback(async (file: File) => {
    if (!offer) return;
    uploadAbort.current?.abort();
    const controller = new AbortController();
    uploadAbort.current = controller;
    setImageProgress(0);
    setError(null);
    try {
      const { uploadId } = await uploadInParts({
        file,
        fileName: file.name,
        purpose: 'media',
        declaredMimeType: file.type || undefined,
        client: mediaService,
        signal: controller.signal,
        onProgress: setImageProgress,
      });
      setOffer(await offerService.update(offer.id, { imageUploadId: uploadId }));
    } catch (err) {
      if (!controller.signal.aborted) fail(err);
    } finally {
      if (uploadAbort.current === controller) uploadAbort.current = null;
      setImageProgress(null);
    }
  }, [offer, fail]);

  /** Salva o que mudou (se algo) e dispara o envio. */
  const send = useCallback(async (pending?: UpdateOfferRequest) => {
    if (!offer) return;
    setSending(true);
    setError(null);
    try {
      if (pending && Object.keys(pending).length > 0) {
        setOffer(await offerService.update(offer.id, pending));
      }
      const res = await offerService.send(offer.id);
      setOffer({ ...res.offer, dispatches: res.dispatches });
    } catch (err) {
      fail(err);
    } finally {
      setSending(false);
    }
  }, [offer, fail]);

  const saveDestinations = useCallback(async (conversationIds: string[]) => {
    try {
      setDestinations(await offerService.replaceDestinations(conversationIds));
    } catch (err) {
      throw toOfferError(err);
    }
  }, []);

  const reset = useCallback(() => {
    uploadAbort.current?.abort();
    setOffer(null);
    setNeedsManualData(false);
    setError(null);
  }, []);

  // Progresso por polling enquanto `SENDING`; `setTimeout` encadeado para não sobrepor chamadas.
  const offerId = offer?.id;
  const isSending = offer?.status === 'SENDING';
  useEffect(() => {
    if (!offerId || !isSending) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const fresh = await offerService.get(offerId);
        if (!cancelled) setOffer(fresh);
      } catch {
        // Falha pontual: tenta de novo no próximo ciclo.
      }
      if (!cancelled) timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
    };
    timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [offerId, isSending]);

  return {
    offer,
    needsManualData,
    usage,
    destinations,
    destinationsLoaded,
    generating,
    saving,
    sending,
    imageProgress,
    error,
    clearError: () => setError(null),
    generate,
    update,
    replaceImage,
    send,
    saveDestinations,
    reset,
  };
}

export type OfferGenerator = ReturnType<typeof useOfferGenerator>;
