const SUFFIX: Record<string, number> = { k: 1_000, mil: 1_000, m: 1_000_000, mi: 1_000_000 };
const BUCKET = /^(\d+(?:[.,]\d+)*)\s*(k|mil|mi|m)?\+?$/;

/**
 * Faixa textual da Shein → piso numérico. "1000+" → 1000; "1,2mil+" → 1200; "1.000+" → 1000; "1.5k" → 1500.
 * Com sufixo, `.`/`,` é decimal; sem sufixo, separador seguido de exatamente 3 dígitos é de milhar.
 * Número cru é aceito (piso). Vazio/ilegível/negativo → 0.
 */
export function parseSalesBucket(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  if (typeof raw !== 'string') return 0;
  const m = BUCKET.exec(raw.trim().toLowerCase().replace(/\s+/g, ''));
  if (!m) return 0;
  const [, digits, suffix] = m;
  let n: number;
  if (suffix) {
    // round: 1.15 * 1000 = 1149.999… em ponto flutuante
    n = Math.round(Number(digits.replace(',', '.')) * SUFFIX[suffix]!);
  } else if (/^\d{1,3}([.,]\d{3})+$/.test(digits)) {
    n = Number(digits.replace(/[.,]/g, ''));
  } else {
    n = Number(digits.replace(',', '.'));
  }
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
