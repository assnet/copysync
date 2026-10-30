import type { RateLimitOptions } from '@fastify/rate-limit';
import { RateLimitedError } from '../errors/internal/ResourceErrors';

export const rateLimitPresets = {
  lifecycle: {
    max: 30,
    timeWindow: '1 minute',
  },
  extensionAuth: {
    max: 10,
    timeWindow: '1 minute',
  },
  extensionSync: {
    max: 60,
    timeWindow: '1 minute',
  },
  /** Página pública do rodízio de links (por IP). */
  publicLink: {
    max: 60,
    timeWindow: '1 minute',
  },
  /** Página de Ofertas, por tenant (`perTenantRateLimit`): checar nome do endereço. */
  storefrontSlug: {
    max: 30,
    timeWindow: '1 minute',
  },
  /** Página de Ofertas: prévia do form (debounce no painel). */
  storefrontPreview: {
    max: 60,
    timeWindow: '1 minute',
  },
  /** Página de Ofertas: extrair oferta de link (conta a requisição, não as expansões). */
  storefrontExtract: {
    max: 60,
    timeWindow: '1 hour',
  },
  /**
   * Story de Oferta: gerar arte (extração + IA + render na CPU). Por tenant por instância; teto
   * efetivo = 60 × instâncias http (risco aceito, como a vitrine).
   */
  offerStoryRender: {
    max: 60,
    timeWindow: '1 hour',
  },
  general: {
    max: 120,
    timeWindow: '1 minute',
  },
} as const satisfies Record<string, RateLimitOptions>;

/**
 * Limite por tenant numa rota com `preHandler: [authHook, tenantHook]`. O plugin anexa o próprio
 * hook ao FIM do `preHandler` da rota, então roda depois do tenant resolvido (o global é por IP no
 * `onRequest`, antes do auth). Sem tenant (não deveria ocorrer) cai no IP. Store em memória por
 * instância, como o global (ver docs/arquitetura-escala.md). Estouro → 429 `RATE_LIMITED`.
 */
export function perTenantRateLimit(preset: RateLimitOptions): RateLimitOptions {
  return {
    ...preset,
    hook: 'preHandler',
    keyGenerator: (request) => request.tenantContext?.tenantId ?? request.ip,
    errorResponseBuilder: (_request, context) => new RateLimitedError(Math.max(1, Math.ceil(context.ttl / 1000))),
  };
}
