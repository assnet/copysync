import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Token do probe de domínio: `<expiraEmSegundos>.<hmac base64url>`, HMAC-SHA256 com
 * `LINK_PROBE_SECRET` sobre (domainId, hostname, expiração). Função pura: a rota pública
 * `/.well-known/link-rotation` usa `verifyProbeToken` e responde 204 quando válido.
 */
export const PROBE_TOKEN_TTL_MS = 5 * 60_000;

export interface ProbeTokenSubject {
  domainId: string;
  hostname: string;
}

function sign(subject: ProbeTokenSubject, expSec: number, secret: string): string {
  return createHmac('sha256', secret)
    .update(`${subject.domainId}\n${subject.hostname}\n${expSec}`)
    .digest('base64url');
}

export function createProbeToken(subject: ProbeTokenSubject, now: Date, secret: string): string {
  const expSec = Math.floor((now.getTime() + PROBE_TOKEN_TTL_MS) / 1000);
  return `${expSec}.${sign(subject, expSec, secret)}`;
}

/** Comparação em tempo constante; recusa expirado e expiração além do TTL (token forjado no futuro). */
export function verifyProbeToken(token: string, subject: ProbeTokenSubject, now: Date, secret: string): boolean {
  if (!secret || typeof token !== 'string') return false;
  const match = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return false;
  const expSec = Number(match[1]);
  const nowMs = now.getTime();
  if (expSec * 1000 < nowMs || expSec * 1000 > nowMs + PROBE_TOKEN_TTL_MS + 1000) return false;
  const expected = Buffer.from(sign(subject, expSec, secret));
  const given = Buffer.from(match[2]!);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
