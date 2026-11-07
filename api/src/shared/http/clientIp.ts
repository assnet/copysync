import { isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';

/**
 * IP do cliente para limites de segurança.
 *
 * Na Render todo tráfego passa pela borda Cloudflare que ela coloca na frente do serviço: o último
 * salto do `X-Forwarded-For` (o que `request.ip` devolve com `trustProxy: 1`) é o servidor dessa
 * borda, compartilhado por muitos clientes — limite por IP somaria clientes diferentes e bloquearia
 * gente legítima. A borda Cloudflare sempre grava `cf-connecting-ip` com o IP real do cliente
 * (sobrescrevendo o que o cliente mandar), então ele é a fonte. Só se ausente ou inválido cai para
 * `request.ip`. Nunca o 1º `X-Forwarded-For`, que o cliente forja.
 */
export function resolveClientIp(request: Pick<FastifyRequest, 'ip' | 'headers'>): string | null {
  const raw = request.headers?.['cf-connecting-ip'];
  const cf = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (cf && isIP(cf)) return cf;
  return request.ip || null;
}
