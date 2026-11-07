import { signM2MRequest } from '../../../../shared/http/m2m/m2mSignature';
import type { HubSubscriptionsResult, IHubSubscriptionsClient } from '../../application/ports/IHubSubscriptionsClient';
import type { HubSubscription } from '../../domain/services/subscriptionReconcile';

export const HUB_SUBSCRIPTIONS_PATH = '/integrations/subscriptions';
const DEFAULT_TIMEOUT_MS = 5_000;

export interface HubSubscriptionsClientConfig {
  hubUrl: string;
  applicationKey: string;
  secret: string;
  timeoutMs?: number;
}

const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';
const isOptStr = (v: unknown): v is string | null | undefined => v === undefined || isStrOrNull(v);

function parseSubscription(v: unknown): HubSubscription | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || !isStrOrNull(o.planSlug) || !isStrOrNull(o.billingStatus)
    || !isStrOrNull(o.expiresAt) || !isStrOrNull(o.deletedAt)
    || !isOptStr(o.canceledAt) || !isOptStr(o.refundedAt) || !isOptStr(o.chargedbackAt)) return null;
  return {
    id: o.id, planSlug: o.planSlug, billingStatus: o.billingStatus, expiresAt: o.expiresAt, deletedAt: o.deletedAt,
    // Opcionais: a central ainda não expõe; presentes, cortam na hora
    ...(o.canceledAt !== undefined && { canceledAt: o.canceledAt }),
    ...(o.refundedAt !== undefined && { refundedAt: o.refundedAt }),
    ...(o.chargedbackAt !== undefined && { chargedbackAt: o.chargedbackAt }),
  };
}

/**
 * `GET {hubUrl}/integrations/subscriptions?externalUserId=` com assinatura M2M (mesma do `HubEmailSender`).
 * Sem retry: a próxima passada repete. Nunca lança nem devolve corpo (pode ter dado pessoal).
 * A canônica usa o path que a central recebe: path base de `hubUrl` + rota; query entra ordenada.
 */
export class HubSubscriptionsClient implements IHubSubscriptionsClient {
  private readonly basePath: string;
  private readonly origin: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: HubSubscriptionsClientConfig, private readonly fetchFn: typeof fetch = fetch) {
    const base = new URL(config.hubUrl);
    this.origin = base.origin;
    this.basePath = `${base.pathname.replace(/\/+$/, '')}${HUB_SUBSCRIPTIONS_PATH}`;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async fetchByCustomer(externalUserId: string): Promise<HubSubscriptionsResult> {
    const query = new URLSearchParams({ externalUserId }).toString();
    const headers = signM2MRequest({
      method: 'GET', path: this.basePath, query, applicationKey: this.config.applicationKey, secret: this.config.secret,
    });
    let res: Response;
    try {
      res = await this.fetchFn(`${this.origin}${this.basePath}?${query}`, {
        method: 'GET',
        headers: { Accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      return { ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network' };
    }
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'unauthorized', status: res.status };
    if (res.status !== 200) return { ok: false, reason: 'http_error', status: res.status };

    const json = await res.json().catch(() => null) as Record<string, unknown> | null;
    if (!json || json.externalUserId !== externalUserId || !Array.isArray(json.subscriptions)) {
      return { ok: false, reason: 'invalid_response', status: res.status };
    }
    const subscriptions = json.subscriptions.map(parseSubscription);
    const lastSeq = json.lastSeq;
    const seqOk = lastSeq === null || (typeof lastSeq === 'number' && Number.isSafeInteger(lastSeq) && lastSeq >= 0);
    if (subscriptions.some((s) => s === null) || !seqOk) return { ok: false, reason: 'invalid_response', status: res.status };
    return {
      ok: true,
      snapshot: {
        externalUserId,
        subscriptions: subscriptions as HubSubscription[],
        lastSeq: lastSeq === null ? null : BigInt(lastSeq as number),
      },
    };
  }
}
