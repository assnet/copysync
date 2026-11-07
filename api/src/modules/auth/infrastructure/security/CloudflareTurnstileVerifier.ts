import type { ITurnstileVerifier } from '../../domain/contracts/ILoginSecurity';
import { logger } from '../../../../shared/logger/logger';

const log = logger.child({ module: 'CloudflareTurnstileVerifier' });
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** `action` do widget do painel; token de outra ação é recusado. */
export const TURNSTILE_LOGIN_ACTION = 'login';
/** Secrets de TESTE da Cloudflare (1x/2x/3x…AA): não devolvem action/hostname reais. */
const TEST_SECRET = /^[123]x0{31}AA$/; // secrets de teste oficiais: 1x + 31 zeros + AA (35 caracteres)

export interface TurnstileVerifierOptions {
  /** Host do painel (de PANEL_URL); token emitido em outro host é recusado. */
  expectedHostname?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Verificação server-side do Turnstile. Falha-fechado: rede/timeout/resposta ruim = recusado.
 * Exige `action` = login e `hostname` = host do painel; só a secret de teste dispensa os dois.
 */
export class CloudflareTurnstileVerifier implements ITurnstileVerifier {
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly isTestSecret: boolean;

  constructor(private readonly secret: string, private readonly opts: TurnstileVerifierOptions = {}) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 8_000;
    this.isTestSecret = TEST_SECRET.test(secret);
  }

  async verify(token: string, ip: string | null): Promise<{ success: boolean; errorCodes?: string[] }> {
    if (!token) return { success: false, errorCodes: ['missing-input-response'] };
    const body = new URLSearchParams({ secret: this.secret, response: token });
    if (ip) body.append('remoteip', ip);
    let data: { success?: boolean; 'error-codes'?: string[]; action?: string; hostname?: string };
    try {
      const res = await this.fetchFn(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      data = (await res.json()) as typeof data;
    } catch (err) {
      log.error({ err: (err as Error)?.name }, 'turnstile siteverify failed');
      return { success: false, errorCodes: ['network-error'] };
    }
    if (!data.success) return { success: false, errorCodes: data['error-codes'] };
    if (this.isTestSecret) return { success: true };
    if (data.action !== TURNSTILE_LOGIN_ACTION) return { success: false, errorCodes: ['action-mismatch'] };
    if (this.opts.expectedHostname && data.hostname !== this.opts.expectedHostname) {
      return { success: false, errorCodes: ['hostname-mismatch'] };
    }
    return { success: true };
  }
}
