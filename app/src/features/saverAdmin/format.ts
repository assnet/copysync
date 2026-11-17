const DATE_TIME = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Data e hora local (pt-BR). Vazio/inválido = null (a tela mostra o traço). */
export function formatDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : DATE_TIME.format(d);
}

/** `<a download>` com object URL, revogado no próximo tick. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

const INTEGER = new Intl.NumberFormat('pt-BR');
const PERCENT = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });

/** Inteiro com separador de milhar (pt-BR). */
export const formatCount = (n: number): string => INTEGER.format(n);

/** Parte de um total em porcentagem (pt-BR, até 1 casa). Total zero = null; parte pequena nunca vira "0%". */
export function formatShare(part: number, total: number): string | null {
  if (total <= 0) return null;
  const ratio = Math.min(part / total, 1);
  return ratio > 0 && ratio < 0.0005 ? `<${PERCENT.format(0.001)}` : PERCENT.format(ratio);
}
