import { useCallback, useEffect, useState } from 'react';
import { authService } from '@/services/auth.service';
import { FALLBACK_TURNSTILE_SITE_KEY } from './config';

/**
 * Site key do Turnstile vinda da API (`GET /auth/login/config`). A API só a devolve quando exige o
 * desafio, então painel e API nunca divergem. Se a config falhar, usa `VITE_TURNSTILE_SITE_KEY`.
 */
export function useLoginConfig() {
  const [siteKey, setSiteKey] = useState<string>('');
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      const config = await authService.loginConfig();
      setSiteKey(config.turnstileSiteKey ?? '');
    } catch {
      setSiteKey(FALLBACK_TURNSTILE_SITE_KEY);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  return { siteKey, loaded, reload };
}
