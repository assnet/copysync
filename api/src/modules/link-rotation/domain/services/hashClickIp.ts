import { createHash } from 'node:crypto';

/** Dia UTC `YYYY-MM-DD`: o hash muda à meia-noite UTC (o mesmo IP não é rastreável entre dias). */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * `sha256(ip + dia UTC + salt)` em hex. Nunca gravar o IP cru (LROT-10). O salt vem de
 * `LINK_CLICK_SALT` por injeção; a regra não lê env. IP é normalizado (trim + minúsculo, IPv6).
 */
export function hashClickIp(ip: string, at: Date, salt: string): string {
  return createHash('sha256').update(`${ip.trim().toLowerCase()}${utcDay(at)}${salt}`).digest('hex');
}
