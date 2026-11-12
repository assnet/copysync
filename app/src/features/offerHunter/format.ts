/** Formatação de valores do caçador (centavos → R$, datas no fuso do navegador). */

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brlWhole = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const decimal1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const fixed1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Centavos → "R$ 12,90"; null → null. */
export function formatCents(cents: number | null | undefined): string | null {
  return cents == null ? null : brl.format(cents / 100);
}

/** Centavos → "R$ 50" (rótulo de escala). */
export function formatCentsWhole(cents: number): string {
  return brlWhole.format(cents / 100);
}

export function formatDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : dateTime.format(d);
}

/** Pontuação/percentual com até 1 casa no padrão pt-BR: 86 → "86", 18.5 → "18,5". */
export function formatDecimal(n: number): string {
  return decimal1.format(n);
}

/** Nota sempre com 1 casa: 4 → "4,0". */
export function formatRating(n: number): string {
  return fixed1.format(n);
}
