import type { ITurnstileVerifier } from '../../domain/contracts/ILoginSecurity';
import { logger } from '../../../../shared/logger/logger';

const log = logger.child({ module: 'CloudflareTurnstileVerifier' });
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** `action` do widget do painel; token de outra ação é recusado. */
export const TURNSTILE_LOGIN_ACTION = 'login';

/**
 * Verificação server-side do Turnstile. Falha-fechado: rede/timeout/resposta ruim = recusado.
 * A secret de TESTE da Cloudflare não devolve `action`: ausente é aceito (dev).
 */
export class CloudflareTurnstileVerifier implements ITurnstileVerifier {
  constructor(
    private readonly secret: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly timeoutMs = 8_000,
  ) {}

  async verify(token: string, ip: string | null): Promise<{ success: boolean; errorCodes?: string[] }> {
    if (!token) return { success: false, errorCodes: ['missing-input-response'] };
    const body = new URLSearchParams({ secret: this.secret, response: token });
    if (ip) body.append('remoteip', ip);
    try {
      const res = await this.fetchFn(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const data = (await res.json()) as { success?: boolean; 'error-codes'?: string[]; action?: string };
      const actionOk = data.action === undefined || data.action === TURNSTILE_LOGIN_ACTION;
      return { success: !!data.success && actionOk, errorCodes: actionOk ? data['error-codes'] : ['action-mismatch'] };
    } catch (err) {
      log.error({ err: (err as Error)?.name }, 'turnstile siteverify failed');
      return { success: false, errorCodes: ['network-error'] };
    }
  }
}
