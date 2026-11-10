import { AFFILIATE_PROVIDER_FIELDS } from './affiliateProviderFields';

/** Teto do token lido: `AT` real tem ~1 KiB; o schema da rota já corta em 4096. */
const MAX_TOKEN_LENGTH = 4096;
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/**
 * ID da conta Shein (`m`) dentro do token `AT`: 2º segmento (base64url de um JSON, observado na
 * T0 com 4 segmentos, ex. `{"b":7,"g":…,"r":"…","t":2,"m":4320454940,"l":…}`).
 * Só lê — não verifica assinatura (a Shein é quem valida o token no uso).
 * Devolve a string de dígitos no formato do ID Shein, ou null (token ilegível, sem `m`, fora do formato).
 */
export function sheinSessionMemberId(token: string): string | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
  const segments = token.split('.');
  if (segments.length < 2) return null;
  const payload = segments[1]!;
  if (!BASE64URL.test(payload)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const m = (parsed as Record<string, unknown>).m;
  let id: string;
  if (typeof m === 'number' && Number.isSafeInteger(m) && m > 0) id = String(m);
  else if (typeof m === 'string') id = m;
  else return null;

  const rule = AFFILIATE_PROVIDER_FIELDS.SHEIN.publicIdentifier;
  return id.length <= rule.maxLength && rule.pattern.test(id) ? id : null;
}
