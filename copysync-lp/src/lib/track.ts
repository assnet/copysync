// Camada mínima de eventos no dataLayer (prontos para um GTM no futuro).
// A tag do Google (gtag.js, GA4 + Ads) está no index.html; o "clique_assinar" vai ao GA4 por lib/checkoutClicks.ts.

declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[]
  }
}

export type TrackEvent = 'cta_click' | 'video_play' | 'video_50' | 'plan_select' | 'checkout_start'

export function track(event: TrackEvent, params: Record<string, unknown> = {}) {
  window.dataLayer = window.dataLayer ?? []
  window.dataLayer.push({ event, ...params })
}

/** Parâmetros só da LP (não vão ao checkout). Todo o resto da URL é repassado. Mesma regra no index.html. */
const LP_ONLY = /^(borrao)$/

/** Anexa os parâmetros da URL atual ao link do checkout (UTMs, gclid, fbclid, src, sck e quaisquer outros). */
export function withCampaignParams(url: string) {
  if (typeof window === 'undefined') return url
  const target = new URL(url)
  new URLSearchParams(window.location.search).forEach((value, key) => {
    if (!LP_ONLY.test(key) && !target.searchParams.has(key)) target.searchParams.set(key, value)
  })
  return target.toString()
}
