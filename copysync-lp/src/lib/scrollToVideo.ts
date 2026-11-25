/**
 * Rola até o vídeo (id="video") deixando-o centralizado na área livre da tela,
 * descontando a barra fixa que estiver no rodapé (barra de CTA ou aviso de cookies).
 * Ao chegar, avisa o vídeo para pulsar o botão de play.
 * Retorna false se o vídeo não existir (o link segue o comportamento normal do #video).
 */
export const VIDEO_ATTENTION_EVENT = 'cs:video-attention'

export function scrollToVideo(): boolean {
  const el = document.getElementById('video')
  if (!el) return false
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const behavior: ScrollBehavior = reduce ? 'auto' : 'smooth'

  const targetTop = () => {
    const r = el.getBoundingClientRect()
    const free = window.innerHeight - bottomInset()
    const gap = Math.max(12, (free - r.height) / 2)
    const max = document.documentElement.scrollHeight - window.innerHeight
    return Math.round(Math.min(max, Math.max(0, window.scrollY + r.top - gap)))
  }

  let aim = targetTop()
  window.scrollTo({ top: aim, behavior })

  // O aviso de cookies aparece logo depois da primeira rolagem e troca de lugar com a barra de CTA:
  // corrige o alvo quando isso acontece e, no fim, confirma a posição antes do pulso.
  const reaim = () => {
    const next = targetTop()
    if (Math.abs(next - aim) > 4) {
      aim = next
      window.scrollTo({ top: aim, behavior })
      return true
    }
    return false
  }
  window.setTimeout(reaim, 180)
  waitArrival(() => aim, () => {
    if (reaim()) waitArrival(() => aim, arrive)
    else arrive()
  })

  function arrive() {
    window.dispatchEvent(new CustomEvent(VIDEO_ATTENTION_EVENT))
  }
  return true
}

/** Altura da barra fixa visível (ou prestes a ficar visível) no rodapé. */
function bottomInset() {
  const cookies = document.querySelector<HTMLElement>('[data-bottom-bar="cookies"]')
  if (cookies) return cookies.offsetHeight
  // a barra de CTA (só no celular) aparece assim que o hero sai da tela
  const cta = document.querySelector<HTMLElement>('[data-bottom-bar="cta"]')
  if (cta && getComputedStyle(cta).display !== 'none') return cta.offsetHeight
  return 0
}

/**
 * Chama `done` quando a página chega ao alvo (e para), quando a rolagem para em outro ponto
 * (a pessoa interrompeu) ou após 4 s. Usa o relógio, não os quadros, porque a página pode
 * estar ocupada durante a rolagem.
 */
function waitArrival(getAim: () => number, done: () => void) {
  const start = performance.now()
  let lastY = window.scrollY
  let lastMove = start
  const id = window.setInterval(() => {
    const now = performance.now()
    const y = window.scrollY
    if (y !== lastY) {
      lastY = y
      lastMove = now
    }
    const atAim = Math.abs(y - getAim()) <= 2
    if ((atAim && now - lastMove > 60) || now - lastMove > 700 || now - start > 4000) {
      window.clearInterval(id)
      done()
    }
  }, 30)
}
