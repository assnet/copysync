import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePersistedState } from '@/hooks/usePersistedState';
import { storefrontService } from '@/services/storefront.service';
import type { AddOfferDraft } from '../components/AddOfferCard';
import { PLAN_FEATURE_KEYS, isPlanFeatureUnavailable, isSheinUnavailable } from '@/features/plans/planGate';
import { storefrontUpgradePath } from '../planGate';
import type { StorefrontOfferTab } from '../reorder';
import {
  STOREFRONT_FORM_DEFAULTS,
  errorAction,
  errorMessage,
  formFromOverview,
  isStaleDraft,
  withTitle,
  slugChange as computeSlugChange,
  toSavePayload,
  validateForm,
  type StorefrontFormState,
  type StorefrontErrorAction,
} from '../storefrontForm';
import { finalizeSlug } from '@/features/linkRotation/slug';
import { AFFILIATE_LINK_ERROR_CODES } from '@/features/affiliateLinks/linkErrors';
import { storefrontStrings } from '../strings';
import type {
  SlugAvailabilityStatus,
  StorefrontApiError,
  StorefrontImageKind,
  StorefrontOffer,
  StorefrontOfferProvider,
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
const ADD_FIELD_CODES: readonly string[] = [
  'OFFER_URL_UNSUPPORTED', 'OFFER_PRODUCT_NOT_FOUND', 'RATE_LIMITED', 'VALIDATION_ERROR',
  // Credencial faltando/recusada, aceite de risco e loja sem resposta (texto do módulo comum);
  // credencial e aceite ganham o botão para as credenciais sob o campo
  ...AFFILIATE_LINK_ERROR_CODES,
  // Etiqueta da conta do ML: não vinculada (vincular) ou sem vaga no plano (planos), com botão sob o campo
  'AFFILIATE_IDENTIFIER_NOT_LINKED', 'PLAN_LIMIT_REACHED',
];
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
  const [tab, setTab, clearTab] = usePersistedState<StorefrontOfferTab>('storefront.tab', 'drafts');
  const [addDraft, setAddDraft, clearAddDraft] = usePersistedState<AddOfferDraft>('storefront.addOffer', EMPTY_ADD);
  const [viewport, setViewport] = usePersistedState<StorefrontViewport>('storefront.previewViewport', 'mobile');
  const [editOfferId, setEditOfferId, clearEditOffer] = usePersistedState<string | null>('storefront.editOffer', null);

  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [slugCheck, setSlugCheck] = useState<SlugCheck>(NO_SLUG_CHECK);
  const [addError, setAddError] = useState<string | null>(null);
  const [addErrorAction, setAddErrorAction] = useState<StorefrontErrorAction | null>(null);
  /** Código e `meta` do erro de adicionar: escolhem o rótulo do botão de conectar a loja. */
  const [addErrorSource, setAddErrorSource] = useState<Pick<StorefrontApiError, 'code' | 'meta'> | null>(null);
  /** Loja do último item adicionado com link recriado (aviso no card; dado do servidor, não persiste). */
  const [addRebuiltProvider, setAddRebuiltProvider] = useState<StorefrontOfferProvider | null>(null);
  const [imageErrors, setImageErrors] = useState<Partial<Record<StorefrontImageKind, string | null>>>({});
  const [toast, setToast] = useState<StorefrontToast | null>(null);
  /** Diálogo de excluir a página: não persiste (reload fecha a ação destrutiva; a senha vive só no diálogo). */
  const [deleteOpen, setDeleteOpen] = useState(false);

  const notify = (message: string, severity: StorefrontToast['severity'] = 'success') => setToast({ message, severity });

  /** Página de Ofertas fora do plano em qualquer chamada: vai para os planos. Retorna true se redirecionou. */
  const redirectIfNoPlan = useCallback((err: unknown) => {
    if (!isPlanFeatureUnavailable(err, PLAN_FEATURE_KEYS.storefront)) return false;
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

  /** Erro de ação na lista/página → snackbar. `STOREFRONT_OFFER_LINK_UNVERIFIED` (publicar) tem texto próprio em `errorMessage`. */
  const fail = (err: unknown) => {
    if (redirectIfNoPlan(err)) return;
    const code = codeOf(err);
    if (code === 'STOREFRONT_NOT_FOUND' || code === 'STOREFRONT_ORDER_INVALID') void load();
    notify(errorMessage(err), 'error');
  };

  // Reload com rascunho persistido igual ao salvo: sai do modo editar (só na 1ª carga).
  const draftChecked = useRef(false);
  useEffect(() => {
    if (!overview || draftChecked.current) return;
    draftChecked.current = true;
    if (isStaleDraft(draft, overview)) clearDraft();
  }, [overview, draft, clearDraft]);

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

  const creating = overview !== null && !overview.storefront;
  const changeField = <K extends keyof StorefrontFormState>(field: K, value: StorefrontFormState[K]) =>
    setDraft((d) => {
      if (!d) return d;
      // Na criação o endereço acompanha o nome até ser editado (`withTitle`).
      if (field === 'title') return withTitle(d, value as string, creating);
      return { ...d, [field]: value };
    });

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

  /** Edição do card de adicionar: mexer no link apaga o aviso de "link recriado" do item anterior. */
  const editAddDraft = (next: AddOfferDraft) => {
    if (next.url !== addDraft.url) setAddRebuiltProvider(null);
    setAddDraft(next);
  };

  const updateOffers = (fn: (offers: OfferLists) => OfferLists) =>
    setOverview((prev) => (prev ? { ...prev, offers: fn(prev.offers) } : prev));

  const extract = async (url: string, category: string | null) => {
    setAddError(null);
    setAddErrorAction(null);
    setAddErrorSource(null);
    setAddRebuiltProvider(null);
    try {
      const { linkRebuilt, ...created } = await storefrontService.extractOffer(url, category);
      updateOffers((o) => ({ ...o, drafts: [...o.drafts, created] }));
      if (linkRebuilt) setAddRebuiltProvider(created.provider);
      setAddDraft((a) => ({ ...a, url: '' }));
      setTab('drafts');
      notify(t.addOffer.added);
    } catch (err) {
      if (redirectIfNoPlan(err)) return;
      if (isSheinUnavailable(err) || ADD_FIELD_CODES.includes(codeOf(err) ?? '')) {
        const e = err as StorefrontApiError;
        setAddError(errorMessage(err));
        setAddErrorAction(errorAction(err));
        setAddErrorSource({ code: e.code, meta: e.meta });
      } else fail(err);
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

  /**
   * Exclui a página com a senha de quem está logado. Sucesso (ou página que já não existe): fecha o
   * diálogo, limpa o estado de trabalho persistido e recarrega para o estado "criar página". Os
   * demais erros sobem para o diálogo, que mostra o texto de cada código.
   */
  const deletePage = async (password: string) => {
    let gone = false;
    try {
      await storefrontService.deleteStorefront(password);
    } catch (err) {
      if (codeOf(err) !== 'STOREFRONT_NOT_FOUND') throw err;
      gone = true;
    }
    setDeleteOpen(false);
    clearDraft();
    clearTab();
    clearAddDraft();
    clearEditOffer();
    setSubmitted(false);
    setSlugCheck(NO_SLUG_CHECK);
    setAddError(null);
    setAddErrorAction(null);
    setAddErrorSource(null);
    setAddRebuiltProvider(null);
    setImageErrors({});
    notify(gone ? t.deletePage.alreadyDeleted : t.deletePage.done);
    await load();
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
    addDraft, setAddDraft, editAddDraft, addError, addErrorAction, addErrorSource, addRebuiltProvider, extract,
    toggleStatus, deleteOffer, reorder,
    editingOffer, openEditOffer: (o: StorefrontOffer) => setEditOfferId(o.id), closeEditOffer: clearEditOffer, saveOffer,
    // exclusão da página
    deleteOpen, openDelete: () => setDeleteOpen(true), closeDelete: () => setDeleteOpen(false), deletePage,
    // prévia e avisos
    viewport, setViewport,
    toast, notify, closeToast: () => setToast(null),
  };
}
