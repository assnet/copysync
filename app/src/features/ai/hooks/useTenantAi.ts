import { useCallback, useEffect, useState } from 'react';
import { aiService } from '@/services/ai.service';
import type { AiProviderTestResult, TenantAiStatus, UpsertTenantAiCredentialRequest } from '@/types/api.types';
import { aiErrorMessage } from '../strings';

/** Status de IA do cliente e ações da chave própria. Salvar/remover recarregam o status (o modo pode mudar). */
export function useTenantAi() {
  const [status, setStatus] = useState<TenantAiStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiProviderTestResult | null>(null);

  const refresh = useCallback(async () => {
    setStatus(await aiService.getStatus());
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      await refresh();
    } catch (err) {
      setLoadError(aiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  useEffect(() => {
    void load();
  }, [load]);

  const test = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await aiService.testCredential());
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      setTestResult({ ok: false, errorCode: typeof code === 'string' ? code : undefined });
    } finally {
      setTesting(false);
    }
  }, []);

  /** Lança em erro (o formulário mostra a mensagem); em sucesso testa a chave salva. */
  const save = useCallback(async (body: UpsertTenantAiCredentialRequest) => {
    await aiService.saveCredential(body);
    await refresh().catch(() => undefined);
    await test();
  }, [refresh, test]);

  const remove = useCallback(async () => {
    await aiService.removeCredential();
    setTestResult(null);
    await refresh().catch(() => undefined);
  }, [refresh]);

  return { status, loading, loadError, reload: load, save, remove, test, testing, testResult };
}
