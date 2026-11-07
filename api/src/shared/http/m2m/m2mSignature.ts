/**
 * Assinatura de saída das rotas M2M da central (`/integrations/*`). Espelha a verificação da central;
 * vetor compartilhado em `__fixtures__/m2m-vector.json` (cópia do vetor oficial da central).
 *
 * Canônica (linhas unidas por "\n", sem "\n" final):
 *   METHOD maiúsculo · path sem query · query ordenada (vazia = "") · timestamp em segundos ·
 *   nonce (uuid v4) · sha256 hex minúsculo do corpo bruto (GET/HEAD ou sem corpo = sha256("")).
 * `X-Signature: sha256=<hex HMAC-SHA256(segredo, canônica)>`. Funções puras, exceto `signM2MRequest`
 * (relógio e nonce, injetáveis).
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';

export const M2M_SIGNATURE_PREFIX = 'sha256=';
const BODYLESS_METHODS = new Set(['GET', 'HEAD']);

export interface M2MHeaders {
  'X-Application-Key': string;
  'X-Timestamp': string;
  'X-Nonce': string;
  'X-Signature': string;
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Pares decodificados ordenados por chave e valor, cada lado com `encodeURIComponent`. */
export function canonicalM2MQuery(query: string | null | undefined): string {
  if (!query) return '';
  const raw = query.startsWith('?') ? query.slice(1) : query;
  return Array.from(new URLSearchParams(raw).entries())
    .sort((a, b) => byCodeUnit(a[0], b[0]) || byCodeUnit(a[1], b[1]))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

export function m2mBodyHash(method: string, body: string | null | undefined): string {
  const hash = createHash('sha256');
  if (!BODYLESS_METHODS.has(method.toUpperCase()) && body != null) hash.update(body, 'utf8');
  return hash.digest('hex');
}

export function buildM2MCanonical(input: {
  method: string;
  path: string;
  query?: string | null;
  timestamp: string;
  nonce: string;
  body?: string | null;
}): string {
  const method = input.method.toUpperCase();
  return [method, input.path.split('?')[0], canonicalM2MQuery(input.query), input.timestamp, input.nonce, m2mBodyHash(method, input.body)].join('\n');
}

export function signM2MCanonical(secret: string, canonical: string): string {
  return M2M_SIGNATURE_PREFIX + createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
}

/** Timestamp do header: segundos Unix (10 dígitos), nunca ISO nem milissegundos. */
export function m2mTimestamp(nowMs: number = Date.now()): string {
  return String(Math.floor(nowMs / 1000));
}

/** Headers assinados de uma requisição. Cada chamada gera nonce e timestamp novos (retry inclusive). */
export function signM2MRequest(opts: {
  method: string;
  path: string;
  query?: string | null;
  body?: string | null;
  applicationKey: string;
  secret: string;
  nowMs?: number;
  nonce?: string;
}): M2MHeaders {
  const timestamp = m2mTimestamp(opts.nowMs);
  const nonce = opts.nonce ?? randomUUID();
  const canonical = buildM2MCanonical({ method: opts.method, path: opts.path, query: opts.query, timestamp, nonce, body: opts.body });
  return {
    'X-Application-Key': opts.applicationKey,
    'X-Timestamp': timestamp,
    'X-Nonce': nonce,
    'X-Signature': signM2MCanonical(opts.secret, canonical),
  };
}
