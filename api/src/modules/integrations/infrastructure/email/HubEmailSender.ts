import { logger } from '../../../../shared/logger/logger';
import { signM2MRequest } from '../../../../shared/http/m2m/m2mSignature';
import type { IEmailSender, SendEmailInput, SendEmailResult } from '../../domain/contracts/IEmailSender';
import { toHubEmailBody } from './hubEmailMapping';

const log = logger.child({ module: 'HubEmailSender' });

export const HUB_EMAIL_PATH = '/integrations/email/send';
const TIMEOUT_MS = 5_000;
const RETRY_DELAYS_MS = [300, 1_000];

export interface HubEmailSenderConfig {
  hubUrl: string;
  applicationKey: string;
  secret: string;
}

export interface HubEmailSenderDeps {
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

type Attempt = { kind: 'sent'; id?: string } | { kind: 'rejected'; status: number; code?: string } | { kind: 'retryable'; status?: number; error?: string };

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * E-mail transacional pela central: `POST {hubUrl}/integrations/email/send` com assinatura M2M.
 * Retry só em 5xx/rede/timeout (nonce e timestamp novos a cada tentativa); 4xx não repete.
 * Nunca loga segredo, destinatário nem vars (dados pessoais): só template, status e código.
 * A canônica usa o path que a central recebe: o path base de `hubUrl` (se houver) + a rota.
 */
export class HubEmailSender implements IEmailSender {
  private readonly endpoint: URL;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;

  constructor(private readonly config: HubEmailSenderConfig, deps: HubEmailSenderDeps = {}) {
    const base = new URL(config.hubUrl);
    base.pathname = `${base.pathname.replace(/\/+$/, '')}${HUB_EMAIL_PATH}`;
    base.search = '';
    this.endpoint = base;
    this.fetchFn = deps.fetchFn ?? fetch;
    this.sleep = deps.sleep ?? defaultSleep;
    this.timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const body = toHubEmailBody(input);
    if (!body) {
      log.warn({ template: input.template }, 'Email template has no hub equivalent; not sent');
      return { sent: false };
    }
    const raw = JSON.stringify(body);

    for (let attempt = 0; ; attempt++) {
      const result = await this.attempt(raw);
      if (result.kind === 'sent') {
        log.info({ template: body.template, emailId: result.id }, 'Email queued by hub');
        return { sent: true };
      }
      if (result.kind === 'rejected') {
        log.error({ template: body.template, status: result.status, code: result.code }, 'Hub rejected email request');
        return { sent: false };
      }
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) {
        log.error({ template: body.template, status: result.status, error: result.error, attempts: attempt + 1 }, 'Hub email request failed after retries');
        return { sent: false };
      }
      await this.sleep(delay);
    }
  }

  private async attempt(raw: string): Promise<Attempt> {
    const headers = signM2MRequest({
      method: 'POST',
      path: this.endpoint.pathname,
      body: raw,
      applicationKey: this.config.applicationKey,
      secret: this.config.secret,
    });
    let res: Response;
    try {
      res = await this.fetchFn(this.endpoint.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: raw,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      return { kind: 'retryable', error: err instanceof Error ? err.name : 'unknown' };
    }
    const json = await res.json().catch(() => null) as { id?: unknown; code?: unknown } | null;
    if (res.status >= 200 && res.status < 300) return { kind: 'sent', id: typeof json?.id === 'string' ? json.id : undefined };
    if (res.status >= 500) return { kind: 'retryable', status: res.status };
    // Só o código (ex. EMAIL_VAR_NOT_ALLOWED); mensagem livre pode ecoar dado pessoal
    const code = typeof json?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(json.code) ? json.code : undefined;
    return { kind: 'rejected', status: res.status, code };
  }
}
