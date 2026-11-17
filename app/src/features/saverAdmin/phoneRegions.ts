import { saverAdminStrings as s } from './strings';

/**
 * DDI (código do país) e DDD (código de área do Brasil) do telefone guardado só com dígitos. Mesma regra
 * da API (`saver/domain/services/phoneRegions.ts`): os códigos de país não são prefixo um do outro, então
 * basta conhecer os de 1 e 2 dígitos; o resto tem 3.
 */
const ONE_DIGIT_DDI = new Set(['1', '7']);
const TWO_DIGIT_DDI = new Set([
  '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47', '48', '49',
  '51', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64', '65', '66',
  '81', '82', '84', '86', '90', '91', '92', '93', '94', '95', '98',
]);

export const BRAZIL_DDI = '55';

export function ddiOf(phone: string | null | undefined): string | null {
  if (!phone || !/^\d+$/.test(phone)) return null;
  if (ONE_DIGIT_DDI.has(phone[0]!)) return phone[0]!;
  if (phone.length >= 2 && TWO_DIGIT_DDI.has(phone.slice(0, 2))) return phone.slice(0, 2);
  return phone.length >= 3 ? phone.slice(0, 3) : null;
}

/** Código inteiro de país ("5" e "551" não são). */
export function isCountryCode(ddi: string): boolean {
  return /^\d{1,3}$/.test(ddi) && ddiOf(ddi) === ddi;
}

/** Países do seletor, na ordem de exibição (Brasil primeiro). Nomes em `strings.ts`. */
export const COMMON_DDIS: readonly string[] = Object.keys(s.countries).sort(
  (a, b) => Number(b === BRAZIL_DDI) - Number(a === BRAZIL_DDI) || s.countries[a]!.localeCompare(s.countries[b]!, 'pt-BR'),
);

/** DDDs do Brasil em ordem numérica. Região em `strings.ts`. */
export const BRAZIL_DDDS: readonly string[] = Object.keys(s.dddRegions).sort();

export const countryName = (ddi: string): string => s.countries[ddi] ?? s.regions.unknownCountry;
export const dddRegion = (ddd: string): string => s.dddRegions[ddd] ?? s.regions.unknownRegion;

export interface PhoneParts {
  ddi: string | null;
  /** Só para telefone do Brasil com DDD conhecido. */
  ddd: string | null;
  /** Número local já agrupado (Brasil: 99999-0000). */
  local: string;
}

/** Separa o telefone para exibição: DDI, DDD (Brasil) e número local. */
export function splitPhone(phone: string): PhoneParts {
  const ddi = ddiOf(phone);
  if (!ddi) return { ddi: null, ddd: null, local: phone };
  const rest = phone.slice(ddi.length);
  if (ddi !== BRAZIL_DDI || rest.length < 4 || !(rest.slice(0, 2) in s.dddRegions)) return { ddi, ddd: null, local: rest };
  const number = rest.slice(2);
  const grouped = number.length === 8 || number.length === 9 ? `${number.slice(0, -4)}-${number.slice(-4)}` : number;
  return { ddi, ddd: rest.slice(0, 2), local: grouped };
}
