// Constantes do Caçador de Ofertas. Guardas técnicas, não limites de plano (o teto de ofertas garimpadas/dia é
// o entitlement `offer_hunter_finds_per_day`, lido a cada execução).
export const HUNTER_LIMITS = {
  topNDefault: 3,
  topNMax: 5,
  huntsPerTenantMax: 5,
  /** Guarda técnica de chamadas à Shein (HUNT-10), por tenant/dia. */
  runsPerDayMax: 24,
  pagesPerRunMax: 3,
  repeatAfterDaysDefault: 7,
  repeatAfterDaysMin: 1,
  repeatAfterDaysMax: 30,
  intervalMinutesMin: 30,
  /** 1 execução por dia no mínimo. */
  intervalMinutesMax: 1440,
  nameMaxLength: 80,
  /** Filtro "termina em até N dias". */
  endsWithinDaysMax: 90,
  /** Itens enviados à IA por execução (HUNT-06). */
  aiTopCandidates: 15,
  keywordMaxLength: 60,
} as const;
