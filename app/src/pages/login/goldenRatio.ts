/**
 * Proporção áurea aplicada à tela de login.
 *
 * - Layout desktop: painel visual 61,8% × formulário 38,2% (`GOLDEN_SPLIT`).
 * - Tipografia: base 16 × φ → 16 / 26 / 42 (`GOLDEN_TYPE`).
 * - Espaçamentos: 8 × φⁿ → 8 / 13 / 21 / 34 / 55 / 89 (`GOLDEN_SPACE`).
 * - Linhas áureas verticais do painel: 38,2% / 61,8% (`GOLDEN_LINE`).
 */
export const PHI = (1 + Math.sqrt(5)) / 2; // ≈ 1.618

/** Fração maior/menor do corte áureo (61,8% / 38,2%). */
export const GOLDEN_SPLIT = {
  major: `${((1 / PHI) * 100).toFixed(1)}%`, // 61.8%
  minor: `${((1 - 1 / PHI) * 100).toFixed(1)}%`, // 38.2%
} as const;

/** Linhas áureas em porcentagem (para posicionar headline/logo no painel). */
export const GOLDEN_LINE = {
  upper: `${((1 - 1 / PHI) * 100).toFixed(1)}%`, // 38.2%
  lower: `${((1 / PHI) * 100).toFixed(1)}%`, // 61.8%
} as const;

const BASE_FONT = 16;

/** Escala tipográfica em px: 16 → 26 → 42 (× φ a cada passo), e um passo abaixo (10 → 13). */
export const GOLDEN_TYPE = {
  xs: Math.round(BASE_FONT / PHI / PHI), // 6 — não usado (abaixo do mínimo legível)
  sm: Math.round(BASE_FONT / PHI), // 10 → usamos 13 como mínimo de legibilidade
  caption: 13,
  base: BASE_FONT, // 16
  lead: Math.round(BASE_FONT * PHI), // 26
  display: Math.round(BASE_FONT * PHI * PHI), // 42
} as const;

/** Espaçamentos em px, progressão 8 × φⁿ. */
export const GOLDEN_SPACE = {
  s1: 8,
  s2: Math.round(8 * PHI), // 13
  s3: Math.round(8 * PHI ** 2), // 21
  s4: Math.round(8 * PHI ** 3), // 34
  s5: Math.round(8 * PHI ** 4), // 55
  s6: Math.round(8 * PHI ** 5), // 89
} as const;
