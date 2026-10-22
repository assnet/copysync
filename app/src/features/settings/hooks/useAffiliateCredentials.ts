import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { affiliateCredentialService } from '@/services/affiliateCredential.service';
import type {
  AffiliateCredentialItem,
  AffiliateCredentialStatus,
  AffiliateProvider,
  UpsertAffiliateCredentialRequest,
} from '@/types/api.types';
import { AFFILIATE_PROVIDERS, type AffiliateProviderSpec } from '../affiliateProviders';
import { affiliateErrorMessage } from '../strings';

export interface AffiliateCredentialEntry {
  spec: AffiliateProviderSpec;
  item?: AffiliateCredentialItem;
}

type ItemsByProvider = Partial<Record<AffiliateProvider, AffiliateCredentialItem>>;

/**
 * Estado local das credenciais de afiliado (sem store global).
 * - remover e trocar status são otimistas, com rollback e `actionError` se a API falhar
 * - salvar não é otimista: `upsert` só atualiza a lista após 2xx e repassa o erro ao diálogo
 */
/** Credencial apagada noutro lugar: o estado certo é "não configurado", não o anterior. */
function isNotFound(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === 'AFFILIATE_CREDENTIAL_NOT_FOUND';
}

export function useAffiliateCredentials() {
  const [items, setItems] = useState<ItemsByProvider>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Partial<Record<AffiliateProvider, boolean>>>({});
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await affiliateCredentialService.list();
      setItems(Object.fromEntries(list.map((i) => [i.provider, i])) as ItemsByProvider);
    } catch (err) {
      setLoadError(affiliateErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setOne = (provider: AffiliateProvider, item: AffiliateCredentialItem | undefined) =>
    setItems((prev) => {
      const next = { ...prev };
      if (item) next[provider] = item;
      else delete next[provider];
      return next;
    });

  const setBusyFor = (provider: AffiliateProvider, value: boolean) =>
    setBusy((prev) => ({ ...prev, [provider]: value }));

  const upsert = useCallback(async (provider: AffiliateProvider, body: UpsertAffiliateCredentialRequest) => {
    const saved = await affiliateCredentialService.upsert(provider, body);
    setOne(provider, saved);
  }, []);

  const remove = useCallback(async (provider: AffiliateProvider) => {
    const previous = itemsRef.current[provider];
    setOne(provider, undefined);
    setBusyFor(provider, true);
    try {
      await affiliateCredentialService.remove(provider);
    } catch (err) {
      // Já removida em outra aba: não ressuscita o card.
      if (!isNotFound(err)) setOne(provider, previous);
      setActionError(affiliateErrorMessage(err));
    } finally {
      setBusyFor(provider, false);
    }
  }, []);

  const setStatus = useCallback(async (provider: AffiliateProvider, status: AffiliateCredentialStatus) => {
    const previous = itemsRef.current[provider];
    if (!previous) return;
    setOne(provider, { ...previous, status });
    setBusyFor(provider, true);
    try {
      setOne(provider, await affiliateCredentialService.setStatus(provider, status));
    } catch (err) {
      setOne(provider, isNotFound(err) ? undefined : previous);
      setActionError(affiliateErrorMessage(err));
    } finally {
      setBusyFor(provider, false);
    }
  }, []);

  const entries: AffiliateCredentialEntry[] = useMemo(
    () => AFFILIATE_PROVIDERS.map((spec) => ({ spec, item: items[spec.provider] })),
    [items],
  );

  return {
    entries,
    loading,
    loadError,
    reload: load,
    busy,
    upsert,
    remove,
    setStatus,
    actionError,
    clearActionError: () => setActionError(null),
  };
}
