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

const PASS_THROUGH = /^(utm_|gclid$|gbraid$|wbraid$|fbclid$|src$|sck$)/

/** Anexa os parâmetros de campanha da URL atual ao link do checkout. */
export function withCampaignParams(url: string) {
  if (typeof window === 'undefined') return url
  const target = new URL(url)
  new URLSearchParams(window.location.search).forEach((value, key) => {
    if (PASS_THROUGH.test(key) && !target.searchParams.has(key)) target.searchParams.set(key, value)
  })
  return target.toString()
}
