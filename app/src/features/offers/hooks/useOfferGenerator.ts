import { useCallback, useEffect, useRef, useState } from 'react';
import { offerService } from '@/services/offer.service';
import { mediaService } from '@/services/media.service';
import { uploadInParts } from '@/features/chat/media/chunkedUpload';
import type { GenerateOfferRequest, OfferAudience, OfferItem, OfferUsage, UpdateOfferRequest } from '@/types/api.types';
import { toOfferError, type OfferErrorView } from '../utils/offerErrors';
import { usePersistedState } from '@/hooks/usePersistedState';

/** Intervalo do polling de progresso enquanto a oferta está `SENDING`. */
const POLL_INTERVAL_MS = 3_000;

/**
 * Estado do gerador (sem store global): oferta atual e uso do dia. Destinos vêm da configuração
 * (`useOfferConfig`).
 * Componentes só leem e chamam ações; toda chamada HTTP passa por aqui.
 * Ações que falham devolvem `OfferErrorView` em `error` e rejeitam, para o formulário reagir.
 */
export function useOfferGenerator() {
  const [offer, setOffer] = useState<OfferItem | null>(null);
  // Id da oferta aberta sobrevive a reload; a oferta em si é recarregada da API
  const [openOfferId, setOpenOfferId, clearOpenOfferId] = usePersistedState<string | null>('offers.openOffer', null);
  const [needsManualData, setNeedsManualData] = useState(false);
  const [usage, setUsage] = useState<OfferUsage | null>(null);
  const [aiFallback, setAiFallback] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [mentionSaving, setMentionSaving] = useState(false);
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

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  useEffect(() => () => uploadAbort.current?.abort(), []);

  useEffect(() => {
    if (offer) setOpenOfferId(offer.id);
  }, [offer, setOpenOfferId]);

  // Reload com oferta aberta: recarrega; se sumiu (404) ou falhou, esquece o id
  const restoreId = useRef(openOfferId);
  useEffect(() => {
    const id = restoreId.current;
    if (!id) return;
    let cancelled = false;
    offerService.get(id)
      .then((fresh) => { if (!cancelled) setOffer(fresh); })
      .catch(() => { if (!cancelled) clearOpenOfferId(); });
    return () => { cancelled = true; };
  }, [clearOpenOfferId]);

  const generate = useCallback(async (body: GenerateOfferRequest) => {
    setGenerating(true);
    setError(null);
    try {
      const res = await offerService.generate(body);
      setOffer(res.offer);
      setNeedsManualData(res.needsManualData);
      setAiFallback(res.aiFallback);
    } catch (err) {
      fail(err);
    } finally {
      setGenerating(false);
      void loadUsage();
    }
  }, [fail, loadUsage]);

  /** Novo texto para o público dado (ou o atual). Não conta no limite de ofertas. */
  const regenerate = useCallback(async (audience?: OfferAudience) => {
    if (!offer) return;
    setRegenerating(true);
    setError(null);
    try {
      const res = await offerService.regenerate(offer.id, audience);
      setOffer(res.offer);
      setAiFallback(res.aiFallback);
    } catch (err) {
      fail(err);
    } finally {
      setRegenerating(false);
    }
  }, [offer, fail]);

  /**
   * Digitação: atualiza na hora e grava em seguida. Cliques rápidos no contador disparam
   * vários PATCH; só a resposta do último vale (as anteriores voltariam o número).
   */
  const typingSeq = useRef(0);
  const setTyping = useCallback(async (patch: Pick<UpdateOfferRequest, 'simulateTyping' | 'typingSeconds'>) => {
    if (!offer) return;
    const previous = offer;
    const seq = ++typingSeq.current;
    setOffer({ ...offer, ...patch });
    setError(null);
    try {
      const saved = await offerService.update(offer.id, patch);
      if (seq === typingSeq.current) setOffer(saved);
    } catch (err) {
      if (seq === typingSeq.current) setOffer(previous);
      fail(err);
    }
  }, [offer, fail]);

  /** Liga/desliga "marcar todos" na hora; volta ao valor anterior se a API recusar. */
  const setMentionAll = useCallback(async (value: boolean) => {
    if (!offer) return;
    const previous = offer;
    setOffer({ ...offer, mentionAll: value });
    setMentionSaving(true);
    setError(null);
    try {
      setOffer(await offerService.update(offer.id, { mentionAll: value }));
    } catch (err) {
      setOffer(previous);
      fail(err);
    } finally {
      setMentionSaving(false);
    }
  }, [offer, fail]);

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

  /**
   * Pausar / retomar / parar. 409 OFFER_INVALID_STATE = o estado mudou (ex.: terminou antes
   * do clique): recarrega a oferta em vez de mostrar erro.
   */
  const [controlling, setControlling] = useState(false);
  const control = useCallback(async (action: 'pause' | 'resume' | 'cancel') => {
    if (!offer) return;
    setControlling(true);
    setError(null);
    try {
      setOffer(await offerService[action](offer.id));
    } catch (err) {
      if ((err as { code?: unknown } | null)?.code === 'OFFER_INVALID_STATE') {
        try { setOffer(await offerService.get(offer.id)); } catch { /* polling recupera */ }
        return;
      }
      fail(err);
    } finally {
      setControlling(false);
    }
  }, [offer, fail]);

  /** Abre uma oferta pelo id (ex.: item da fila de envio vindo de outra aba). */
  const openSeq = useRef(0);
  const open = useCallback(async (offerId: string) => {
    uploadAbort.current?.abort();
    setError(null);
    // Cliques rápidos em ofertas diferentes: só a última resposta vale
    const seq = ++openSeq.current;
    try {
      const fresh = await offerService.get(offerId);
      if (seq !== openSeq.current) return;
      setOffer(fresh);
      setNeedsManualData(false);
      setAiFallback(false);
    } catch (err) {
      fail(err);
    }
  }, [fail]);

  const reset = useCallback(() => {
    uploadAbort.current?.abort();
    setOffer(null);
    clearOpenOfferId();
    setNeedsManualData(false);
    setAiFallback(false);
    setError(null);
  }, [clearOpenOfferId]);

  // Progresso por polling enquanto `SENDING`/`PAUSED` (pausado ainda pode ter um envio em curso
  // terminando); `setTimeout` encadeado para não sobrepor chamadas.
  const offerId = offer?.id;
  const isSending = offer?.status === 'SENDING' || offer?.status === 'PAUSED';
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
    aiFallback,
    generating,
    regenerating,
    mentionSaving,
    saving,
    sending,
    imageProgress,
    error,
    clearError: () => setError(null),
    generate,
    regenerate,
    setMentionAll,
    setTyping,
    update,
    replaceImage,
    send,
    control,
    controlling,
    open,
    reset,
  };
}

export type OfferGenerator = ReturnType<typeof useOfferGenerator>;
