import { PLANS, type Period } from '../sections/plans/data'

/** ID do GA4 (a tag gtag.js está no <head> do index.html). */
export const GA4_ID = 'G-C0DJZKPX9S'
const CAKTO_HOST = 'pay.cakto.com.br'

/** caminho do checkout → plano e período (ex.: "/a92kn9k_1291217" → LITE, anual) */
const BY_PATH = new Map<string, { plano: string; periodo: 'mensal' | 'anual' }>()
for (const plan of PLANS) {
  for (const period of ['monthly', 'annual'] as Period[]) {
    BY_PATH.set(new URL(plan.checkout[period]).pathname, { plano: plan.name, periodo: period === 'annual' ? 'anual' : 'mensal' })
  }
}

/**
 * Envia "clique_assinar" (plano, periodo) ao GA4 em QUALQUER clique num link que leva para a Cakto,
 * inclusive clique do meio / ctrl+clique (nova aba). Segue o Consent Mode: sem "Aceitar", o Google
 * recebe só o sinal sem cookies.
 */
export function initCheckoutClicks() {
  const onClick = (e: MouseEvent) => {
    if (e.type === 'auxclick' && e.button !== 1) return
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!a) return
    let url: URL
    try {
      url = new URL(a.href)
    } catch {
      return
    }
    if (url.hostname !== CAKTO_HOST) return
    const known = BY_PATH.get(url.pathname)
    const plano = known?.plano ?? a.dataset.plano
    const periodo = known?.periodo ?? a.dataset.periodo
    window.gtag?.('event', 'clique_assinar', {
      ...(plano ? { plano } : {}),
      ...(periodo ? { periodo } : {}),
      send_to: GA4_ID,
      transport_type: 'beacon',
    })
  }
  document.addEventListener('click', onClick, { capture: true })
  document.addEventListener('auxclick', onClick, { capture: true })
}
