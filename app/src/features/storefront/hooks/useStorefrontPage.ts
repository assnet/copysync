import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePersistedState } from '@/hooks/usePersistedState';
import { storefrontService } from '@/services/storefront.service';
import type { AddOfferDraft } from '../components/AddOfferCard';
import { isPlanFeatureUnavailable, storefrontUpgradePath } from '../planGate';
import type { StorefrontOfferTab } from '../reorder';
import {
  STOREFRONT_FORM_DEFAULTS,
  errorMessage,
  formFromOverview,
  slugChange as computeSlugChange,
  toSavePayload,
  validateForm,
  type StorefrontFormState,
} from '../storefrontForm';
import { finalizeSlug } from '@/features/linkRotation/slug';
import { storefrontStrings } from '../strings';
import type {
  SlugAvailabilityStatus,
  StorefrontApiError,
  StorefrontImageKind,
  StorefrontOffer,
  StorefrontOfferStatus,
  StorefrontOverview,
  StorefrontViewport,
  UpdateStorefrontOfferInput,
} from '../types';

const t = storefrontStrings;
export const SLUG_CHECK_DEBOUNCE_MS = 400;

export interface StorefrontToast {
  message: string;
  severity: 'success' | 'error';
}

interface SlugCheck {
  status: SlugAvailabilityStatus | null;
  checking: boolean;
  suggestions: string[];
}

const NO_SLUG_CHECK: SlugCheck = { status: null, checking: false, suggestions: [] };
const EMPTY_ADD: AddOfferDraft = { url: '', category: null };
/** Erros do "Adicionar oferta" que ficam no próprio card (os demais viram snackbar). */
const ADD_FIELD_CODES = ['OFFER_URL_UNSUPPORTED', 'OFFER_PRODUCT_NOT_FOUND', 'OFFER_LINK_NOT_OWNED', 'OFFER_LINK_NOT_AFFILIATE', 'RATE_LIMITED', 'VALIDATION_ERROR'];
/** Códigos que mostram estado no campo do nome ao salvar. */
const SLUG_SAVE_STATUS: Record<string, SlugAvailabilityStatus> = {
  LINK_SLUG_TAKEN: 'TAKEN',
  LINK_SLUG_RESERVED: 'RESERVED',
  LINK_SLUG_INVALID: 'INVALID',
  STOREFRONT_SLUG_PREMIUM: 'PREMIUM',
};

const codeOf = (err: unknown) => (err as StorefrontApiError | null)?.code;
const suggestionsOf = (err: unknown): string[] => {
  const s = (err as StorefrontApiError | null)?.meta?.suggestions;
  return Array.isArray(s) ? s.filter((v): v is string => typeof v === 'string') : [];
};

type OfferLists = StorefrontOverview['offers'];
const listKey = (status: StorefrontOfferStatus): keyof OfferLists => (status === 'DRAFT' ? 'drafts' : 'published');

/**
 * Estado e orquestração da Página de Ofertas: dado do servidor (recarregado, nunca persistido) e
 * estado de trabalho persistido na aba (rascunho/modo editar, aba, campo de adicionar, prévia,
 * oferta aberta). Regras ficam em `storefrontForm.ts`/`offerForm.ts`/`reorder.ts`.
 */
export function useStorefrontPage() {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<StorefrontOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // null = fora do modo editar
  const [draft, setDraft, clearDraft] = usePersistedState<StorefrontFormState | null>('storefront.form', null);
  const [tab, setTab] = usePersistedState<StorefrontOfferTab>('storefront.tab', 'drafts');
  const [addDraft, setAddDraft] = usePersistedState<AddOfferDraft>('storefront.addOffer', EMPTY_ADD);
  const [viewport, setViewport] = usePersistedState<StorefrontViewport>('storefront.previewViewport', 'mobile');
  const [editOfferId, setEditOfferId, clearEditOffer] = usePersistedState<string | null>('storefront.editOffer', null);

  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [slugCheck, setSlugCheck] = useState<SlugCheck>(NO_SLUG_CHECK);
  const [addError, setAddError] = useState<string | null>(null);
  const [imageErrors, setImageErrors] = useState<Partial<Record<StorefrontImageKind, string | null>>>({});
  const [toast, setToast] = useState<StorefrontToast | null>(null);

  const notify = (message: string, severity: StorefrontToast['severity'] = 'success') => setToast({ message, severity });

  /** Sem plano em qualquer chamada: vai para os planos. Retorna true se redirecionou. */
  const redirectIfNoPlan = useCallback((err: unknown) => {
    if (!isPlanFeatureUnavailable(err)) return false;
    navigate(storefrontUpgradePath, { replace: true });
    return true;
  }, [navigate]);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setOverview(await storefrontService.getStorefront());
    } catch (err) {
      if (!redirectIfNoPlan(err)) setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [redirectIfNoPlan]);

  useEffect(() => { void load(); }, [load]);

  const fail = (err: unknown) => {
    if (redirectIfNoPlan(err)) return;
    const code = codeOf(err);
    if (code === 'STOREFRONT_NOT_FOUND' || code === 'STOREFRONT_ORDER_INVALID') void load();
    notify(errorMessage(err), 'error');
  };

  const saved = useMemo(() => (overview ? formFromOverview(overview) : STOREFRONT_FORM_DEFAULTS), [overview]);
  const editing = draft !== null;
  const form = draft ?? saved;
  const formErrors = useMemo(() => validateForm(form), [form]);
  const page = overview?.storefront ?? null;

  // Nome: checa com debounce só no modo editar, quando mudou em relação ao salvo e é válido.
  const finalSlug = finalizeSlug(form.slug);
  const slugValid = !formErrors.slug;
  const unchanged = finalSlug === page?.slug && form.domainId === page?.domainId;
  useEffect(() => {
    if (!editing || !slugValid || unchanged) {
      setSlugCheck(NO_SLUG_CHECK);
      return;
    }
    let cancelled = false;
    setSlugCheck((s) => ({ ...s, checking: true }));
    const timer = setTimeout(() => {
      storefrontService.checkSlug(finalSlug, form.domainId || undefined).then(
        (r) => { if (!cancelled) setSlugCheck({ status: r.status, checking: false, suggestions: r.suggestions }); },
        () => { if (!cancelled) setSlugCheck(NO_SLUG_CHECK); },
      );
    }, SLUG_CHECK_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [editing, slugValid, unchanged, finalSlug, form.domainId]);

  const changeField = <K extends keyof StorefrontFormState>(field: K, value: StorefrontFormState[K]) =>
    setDraft((d) => (d ? { ...d, [field]: value } : d));

  const startEdit = () => {
    setSubmitted(false);
    setDraft(saved);
  };

  const cancelEdit = () => {
    setSubmitted(false);
    clearDraft();
  };

  const save = async () => {
    if (!draft || saving) return;
    setSubmitted(true);
    if (Object.keys(validateForm(draft)).length) return;
    setSaving(true);
    try {
      await storefrontService.saveStorefront(toSavePayload(draft));
      setSubmitted(false);
      clearDraft();
      notify(t.config.saved);
      await load();
    } catch (err) {
      const status = SLUG_SAVE_STATUS[codeOf(err) ?? ''];
      if (status) setSlugCheck({ status, checking: false, suggestions: suggestionsOf(err) });
      fail(err);
    } finally {
      setSaving(false);
    }
  };

  const uploadImage = async (kind: StorefrontImageKind, uploadId: string) => {
    setImageErrors((e) => ({ ...e, [kind]: null }));
    try {
      await storefrontService.setImage(kind, uploadId);
      notify(t.toast.imageSaved);
      await load();
    } catch (err) {
      if (redirectIfNoPlan(err)) return;
      setImageErrors((e) => ({ ...e, [kind]: errorMessage(err) }));
    }
  };

  const removeImage = async (kind: StorefrontImageKind) => {
    try {
      await storefrontService.removeImage(kind);
      notify(t.toast.imageRemoved);
      await load();
    } catch (err) {
      fail(err);
    }
  };

  const updateOffers = (fn: (offers: OfferLists) => OfferLists) =>
    setOverview((prev) => (prev ? { ...prev, offers: fn(prev.offers) } : prev));

  const extract = async (url: string, category: string | null) => {
    setAddError(null);
    try {
      const created = await storefrontService.extractOffer(url, category);
      updateOffers((o) => ({ ...o, drafts: [...o.drafts, created] }));
      setAddDraft((a) => ({ ...a, url: '' }));
      setTab('drafts');
      notify(t.addOffer.added);
    } catch (err) {
      if (redirectIfNoPlan(err)) return;
      if (ADD_FIELD_CODES.includes(codeOf(err) ?? '')) setAddError(errorMessage(err));
      else fail(err);
    }
  };

  const toggleStatus = async (offer: StorefrontOffer) => {
    const next: StorefrontOfferStatus = offer.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED';
    try {
      const moved = await storefrontService.setOfferStatus(offer.id, next);
      updateOffers((o) => {
        const drafts = o.drafts.filter((x) => x.id !== offer.id);
        const published = o.published.filter((x) => x.id !== offer.id);
        return next === 'DRAFT' ? { drafts: [...drafts, moved], published } : { drafts, published: [...published, moved] };
      });
      notify(next === 'PUBLISHED' ? t.toast.published : t.toast.unpublished);
    } catch (err) {
      fail(err);
    }
  };

  const saveOffer = async (id: string, input: UpdateStorefrontOfferInput) => {
    try {
      const updated = await storefrontService.updateOffer(id, input);
      updateOffers((o) => ({
        drafts: o.drafts.map((x) => (x.id === id ? updated : x)),
        published: o.published.map((x) => (x.id === id ? updated : x)),
      }));
      clearEditOffer();
      notify(t.editOffer.saved);
    } catch (err) {
      fail(err);
    }
  };

  const deleteOffer = async (offer: StorefrontOffer) => {
    try {
      await storefrontService.deleteOffer(offer.id);
      updateOffers((o) => ({ drafts: o.drafts.filter((x) => x.id !== offer.id), published: o.published.filter((x) => x.id !== offer.id) }));
      if (editOfferId === offer.id) clearEditOffer();
      notify(t.toast.deleted);
    } catch (err) {
      fail(err);
    }
  };

  /** Otimista: aplica a ordem na hora; se a API recusar, recarrega a lista. */
  const reorder = async (status: StorefrontOfferStatus, ids: string[]) => {
    const key = listKey(status);
    updateOffers((o) => {
      const byId = new Map(o[key].map((x) => [x.id, x]));
      const ordered = ids.map((id) => byId.get(id)).filter((x): x is StorefrontOffer => Boolean(x));
      return { ...o, [key]: ordered };
    });
    try {
      await storefrontService.reorderOffers(status, ids);
    } catch (err) {
      if (redirectIfNoPlan(err)) return;
      notify(errorMessage(err), 'error');
      void load();
    }
  };

  const allOffers = overview ? [...overview.offers.drafts, ...overview.offers.published] : [];
  const editingOffer = editOfferId ? (allOffers.find((o) => o.id === editOfferId) ?? null) : null;

  return {
    overview, loading, failed, reload: load,
    // configuração
    form, editing, saving, errors: submitted ? formErrors : {}, slugCheck,
    slugChange: overview && editing ? computeSlugChange(form, overview) : null,
    changeField, startEdit, cancelEdit, save,
    imageErrors, uploadImage, removeImage,
    // ofertas
    tab, setTab,
    addDraft, setAddDraft, addError, extract,
    toggleStatus, deleteOffer, reorder,
    editingOffer, openEditOffer: (o: StorefrontOffer) => setEditOfferId(o.id), closeEditOffer: clearEditOffer, saveOffer,
    // prévia e avisos
    viewport, setViewport,
    toast, notify, closeToast: () => setToast(null),
  };
}
