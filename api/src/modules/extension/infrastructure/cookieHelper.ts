import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../../../shared/config/env';

const COOKIE_NAME_SECURE = '__Host-ext_session';
const COOKIE_NAME_DEV = 'ext_session';

export function getExtSessionCookieName(): string {
  return env.NODE_ENV === 'production' ? COOKIE_NAME_SECURE : COOKIE_NAME_DEV;
}

export function parseExtSessionCookie(request: FastifyRequest): string | null {
  const header = request.headers.cookie;
  if (!header) return null;

  const name = getExtSessionCookieName();
  for (const pair of header.split(';')) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    const key = pair.slice(0, eqIdx).trim();
    if (key === name) {
      return decodeURIComponent(pair.slice(eqIdx + 1).trim());
    }
  }
  return null;
}

export function setExtSessionCookie(reply: FastifyReply, token: string, maxAgeSeconds: number): void {
  const name = getExtSessionCookieName();
  const isSecure = env.NODE_ENV === 'production';

  const parts = [
    `${name}=${encodeURIComponent(token)}`,
    `HttpOnly`,
    `Path=/`,
    `Max-Age=${maxAgeSeconds}`,
    isSecure ? 'Secure' : '',
    isSecure ? 'SameSite=Strict' : 'SameSite=Lax',
  ].filter(Boolean);

  reply.header('Set-Cookie', parts.join('; '));
}

export function clearExtSessionCookie(reply: FastifyReply): void {
  const name = getExtSessionCookieName();
  const isSecure = env.NODE_ENV === 'production';

  const parts = [
    `${name}=`,
    `HttpOnly`,
    `Path=/`,
    `Max-Age=0`,
    isSecure ? 'Secure' : '',
    isSecure ? 'SameSite=Strict' : 'SameSite=Lax',
  ].filter(Boolean);

  reply.header('Set-Cookie', parts.join('; '));
}
