/**
 * Contador anônimo do funil, para TODOS os visitantes (não depende do aviso de cookies).
 * Cada etapa vira um pedido GET para /b.gif, que fica no registro de acesso do servidor:
 *   /b.gif?e=load|stay5|scroll50|assinar&c=<utm_content>&r=<número aleatório>
 * Sem cookies (credentials: 'omit'), sem localStorage, sem identificador do visitante e sem Referer
 * (a URL da página pode ter gclid). Cada etapa no máximo uma vez por carregamento da página.
 * fetch com keepalive: o pedido continua mesmo se a página for trocada (clique para a Cakto) e não
 * atrasa nada; sem fetch, cai num new Image().
 */
type Step = 'load' | 'stay5' | 'scroll50' | 'assinar'

const CAKTO_HOST = 'pay.cakto.com.br'
const sent = new Set<Step>()

function utmContent() {
  try {
    return (new URLSearchParams(location.search).get('utm_content') ?? '').slice(0, 120)
  } catch {
    return ''
  }
}

function send(step: Step) {
  if (sent.has(step)) return
  sent.add(step)
  const url = `/b.gif?e=${step}&c=${encodeURIComponent(utmContent())}&r=${Math.floor(Math.random() * 1e10)}`
  try {
    if (typeof fetch === 'function') {
      fetch(url, { method: 'GET', keepalive: true, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }).catch(() => {})
      return
    }
  } catch {
    /* segue para o Image */
  }
  const img = new Image()
  img.referrerPolicy = 'no-referrer'
  img.src = url
}

export function initFunnelBeacon() {
  // e=load: quando a página termina de carregar (não disputa banda com a primeira tela)
  if (document.readyState === 'complete') send('load')
  else addEventListener('load', () => send('load'), { once: true })

  // e=stay5: 5 segundos com a aba visível (o tempo com a aba escondida não conta)
  let visibleMs = 0
  let since = 0
  let timer = 0
  const tick = () => {
    if (document.visibilityState === 'visible') {
      since = performance.now()
      timer = window.setTimeout(() => {
        send('stay5')
        document.removeEventListener('visibilitychange', onVisibility)
      }, Math.max(0, 5000 - visibleMs))
    }
  }
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      window.clearTimeout(timer)
      if (since) visibleMs += performance.now() - since
      since = 0
    } else tick()
  }
  document.addEventListener('visibilitychange', onVisibility)
  tick()

  // e=scroll50: passou da metade da rolagem possível
  let frame = 0
  const checkScroll = () => {
    frame = 0
    const max = document.documentElement.scrollHeight - innerHeight
    if (max > 0 && scrollY / max >= 0.5) {
      send('scroll50')
      removeEventListener('scroll', onScroll)
    }
  }
  const onScroll = () => {
    if (!frame) frame = requestAnimationFrame(checkScroll)
  }
  addEventListener('scroll', onScroll, { passive: true })

  // e=assinar: qualquer clique (inclusive do meio / nova aba) num link para a Cakto. Não segura a navegação.
  const onClick = (e: MouseEvent) => {
    if (e.type === 'auxclick' && e.button !== 1) return
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!a) return
    try {
      if (new URL(a.href).hostname === CAKTO_HOST) send('assinar')
    } catch {
      /* link inválido */
    }
  }
  document.addEventListener('click', onClick, { capture: true })
  document.addEventListener('auxclick', onClick, { capture: true })
}
