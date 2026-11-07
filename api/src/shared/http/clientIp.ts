import type { FastifyRequest } from 'fastify';

/**
 * IP do cliente para limites de segurança: `request.ip`, que com `trustProxy: 1` (app.ts) é o
 * salto adicionado pelo proxy da Render — nunca o 1º `X-Forwarded-For`, que o cliente forja.
 * `cf-connecting-ip` NÃO é lido: a borda Cloudflare é da Render, não de uma zona nossa, então o
 * cabeçalho pode chegar do cliente sem ser sobrescrito.
 */
export function resolveClientIp(request: Pick<FastifyRequest, 'ip'>): string | null {
  return request.ip || null;
}
