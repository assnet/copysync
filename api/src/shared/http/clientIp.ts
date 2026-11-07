import type { FastifyRequest } from 'fastify';

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-fA-F:]{2,45}$/;

/**
 * IP real do cliente para limites de segurança. `cf-connecting-ip` (Cloudflare) quando válido;
 * senão `request.ip`, que com `trustProxy: 1` é o salto adicionado pelo proxy da Render.
 * Nunca o 1º `X-Forwarded-For`: o cliente forja esse valor.
 */
export function resolveClientIp(request: Pick<FastifyRequest, 'headers' | 'ip'>): string | null {
  const raw = request.headers['cf-connecting-ip'];
  const cf = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (cf && (IPV4.test(cf) || IPV6.test(cf))) return cf;
  return request.ip || null;
}
