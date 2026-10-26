/**
 * Regras puras do número de WhatsApp declarado pelo operador ao criar a sessão.
 * Sem dependência de banco ou engine — testável isoladamente.
 */

/**
 * Normaliza um telefone brasileiro para `55` + DDD + número (só dígitos).
 *
 * - 10–11 dígitos (DDD + número) → recebe o prefixo `55`
 * - 12–13 dígitos começando com `55` → mantidos
 * - qualquer outro formato → `null`
 */
export function normalizeBrazilPhone(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return digits;
  return null;
}

/**
 * Extrai os dígitos do telefone gravado pela engine. A Baileys guarda o número a partir
 * do JID (`5511987654321:12@s.whatsapp.net` → `5511987654321`); o sufixo de aparelho e o
 * domínio são descartados por segurança, mesmo que já cheguem limpos.
 */
function engineDigits(phone: string): string {
  return phone.split('@')[0].split(':')[0].replace(/\D/g, '');
}

/**
 * True só quando os dois números existem e são diferentes.
 *
 * Celular brasileiro pode ter o JID sem o nono dígito (`55` + DDD + 8 dígitos) mesmo
 * quando o operador digitou com ele; nesse caso, mesmo DDD e mesmos 8 últimos dígitos
 * contam como o mesmo número.
 */
export function hasPhoneMismatch(
  phone: string | null | undefined,
  declaredPhone: string | null | undefined,
): boolean {
  if (!phone || !declaredPhone) return false;
  const connected = engineDigits(phone);
  const declared = normalizeBrazilPhone(declaredPhone) ?? declaredPhone.replace(/\D/g, '');
  if (!connected || !declared) return false;
  if (connected === declared) return false;

  const isBr = (d: string) => d.startsWith('55') && (d.length === 12 || d.length === 13);
  if (isBr(connected) && isBr(declared)) {
    const sameArea = connected.slice(0, 4) === declared.slice(0, 4);
    const sameLine = connected.slice(-8) === declared.slice(-8);
    if (sameArea && sameLine) return false;
  }
  return true;
}
