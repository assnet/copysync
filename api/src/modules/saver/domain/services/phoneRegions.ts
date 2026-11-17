/**
 * DDI (código do país) e DDD (código de área do Brasil) a partir do telefone guardado só com dígitos.
 *
 * O DDI tem 1 a 3 dígitos e os códigos da ITU (E.164) não são prefixo um do outro. Por isso basta conhecer
 * os de 1 dígito (1 e 7) e os de 2 dígitos: o que não começa por nenhum deles tem DDI de 3 dígitos.
 * Nunca recortar `substring(phone, 1, 2)` às cegas: `351…` (Portugal) viraria "35".
 */
const ONE_DIGIT_DDI = new Set(['1', '7']);
const TWO_DIGIT_DDI = new Set([
  '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47', '48', '49',
  '51', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64', '65', '66',
  '81', '82', '84', '86', '90', '91', '92', '93', '94', '95', '98',
]);

export const BRAZIL_DDI = '55';

/** DDDs em uso no Brasil (Anatel). */
export const BRAZIL_DDDS: readonly string[] = [
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '21', '22', '24', '27', '28',
  '31', '32', '33', '34', '35', '37', '38', '41', '42', '43', '44', '45', '46', '47', '48', '49',
  '51', '53', '54', '55', '61', '62', '63', '64', '65', '66', '67', '68', '69',
  '71', '73', '74', '75', '77', '79', '81', '82', '83', '84', '85', '86', '87', '88', '89',
  '91', '92', '93', '94', '95', '96', '97', '98', '99',
];
const BRAZIL_DDD_SET = new Set(BRAZIL_DDDS);

/** DDI do telefone (ou de um prefixo dele com 3+ dígitos). `null` = não dá para saber. */
export function ddiOf(phone: string | null | undefined): string | null {
  if (!phone || !/^\d+$/.test(phone)) return null;
  if (ONE_DIGIT_DDI.has(phone[0]!)) return phone[0]!;
  if (phone.length >= 2 && TWO_DIGIT_DDI.has(phone.slice(0, 2))) return phone.slice(0, 2);
  return phone.length >= 3 ? phone.slice(0, 3) : null;
}

/** `ddi` é um código de país inteiro: "5" e "551" não são (casariam vários países ou parte de um). */
export function isCountryCode(ddi: string): boolean {
  return /^\d{1,3}$/.test(ddi) && ddiOf(ddi) === ddi;
}

/** DDD de um telefone do Brasil (`55` + DDD em uso); outro país ou DDD inexistente = `null`. */
export function brazilDddOf(phone: string | null | undefined): string | null {
  if (!phone || ddiOf(phone) !== BRAZIL_DDI || phone.length < 4) return null;
  const ddd = phone.slice(2, 4);
  return BRAZIL_DDD_SET.has(ddd) ? ddd : null;
}

export interface PhonePrefixCount {
  /** Primeiros dígitos do telefone (3, ou 4 quando o DDD interessa); `null` = contato sem telefone (só LID). */
  prefix: string | null;
  count: number;
}

export interface PhoneRegionSummary {
  filtered: number;
  withPhone: number;
  lidOnly: number;
  topDdi: { ddi: string; count: number }[];
  topDdd: { ddd: string; count: number }[];
  /** Universo do ranking de países: contatos com telefone, sem o filtro de DDI/DDD (base das porcentagens). */
  ddiBase: number;
  /** Universo do ranking de DDD: telefones do Brasil, sem o filtro de DDD; 0 fora do `ddi = 55`. */
  dddBase: number;
}

export const TOP_DDI_LIMIT = 5;
export const TOP_DDD_LIMIT = 8;

const top = (totals: Map<string, number>, limit: number): [string, number][] =>
  [...totals.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, limit);

/** Prefixo pedido ao banco: 4 dígitos alcançam o DDD do Brasil e bastam para qualquer DDI (1 a 3). */
export const PHONE_PREFIX_LENGTH = 4;

/**
 * Dobra a contagem por prefixo (vinda do banco SEM o filtro de DDI/DDD) em totais e rankings.
 * Os totais valem para o `ddi`/`ddd` pedidos; os rankings mostram o quadro inteiro, para a tela destacar o
 * item filtrado sem as outras barras sumirem: DDIs de todos os países e, com `ddi = 55`, DDDs do Brasil.
 * Prefixo sem DDI reconhecível entra no total sem filtro, fora do ranking. Com DDI, contato só com LID não casa.
 */
export function summarizePhonePrefixes(
  rows: readonly PhonePrefixCount[],
  filter: { ddi: string | null; ddd: string | null },
): PhoneRegionSummary {
  let withPhone = 0;
  let lidOnly = 0;
  const byDdi = new Map<string, number>();
  const byDdd = new Map<string, number>();
  let ddiBase = 0;
  let dddBase = 0;
  const wanted = filter.ddi ? `${filter.ddi}${filter.ddd ?? ''}` : null;
  for (const { prefix, count } of rows) {
    if (prefix === null) {
      if (!wanted) lidOnly += count;
      continue;
    }
    ddiBase += count;
    const ddi = ddiOf(prefix);
    if (filter.ddi === BRAZIL_DDI && ddi === BRAZIL_DDI) dddBase += count;
    if (ddi) byDdi.set(ddi, (byDdi.get(ddi) ?? 0) + count);
    const ddd = filter.ddi === BRAZIL_DDI ? brazilDddOf(prefix) : null;
    if (ddd) byDdd.set(ddd, (byDdd.get(ddd) ?? 0) + count);
    if (!wanted || (ddi === filter.ddi && prefix.startsWith(wanted))) withPhone += count;
  }
  return {
    filtered: withPhone + lidOnly,
    withPhone,
    lidOnly,
    topDdi: top(byDdi, TOP_DDI_LIMIT).map(([ddi, count]) => ({ ddi, count })),
    topDdd: top(byDdd, TOP_DDD_LIMIT).map(([ddd, count]) => ({ ddd, count })),
    ddiBase,
    dddBase,
  };
}
