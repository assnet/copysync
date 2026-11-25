import { useEffect, useState } from 'react'

/**
 * Aviso de cookies. "Aceitar" e "Recusar cookies não necessários" têm o mesmo destaque.
 * Consent Mode do Google:
 *  1) o <head> (index.html) define tudo como "denied" antes de qualquer tag e reaplica a escolha salva;
 *  2) ao escolher aqui, `updateConsent` chama gtag('consent', 'update', …) e, no "Aceitar", carrega o Clarity; grava a escolha;
 *     nas próximas visitas o aviso não aparece.
 */
type Choice = 'granted' | 'denied'
const KEY = 'cs-consent'

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
    clarity?: (...args: unknown[]) => void
    csLoadClarity?: () => void
    csClarityLoaded?: boolean
  }
}

export function updateConsent(choice: Choice) {
  window.gtag?.('consent', 'update', {
    ad_storage: choice,
    ad_user_data: choice,
    ad_personalization: choice,
    analytics_storage: choice,
  })
  // Microsoft Clarity: só é baixado depois do "Aceitar" (o carregador está no index.html)
  if (choice === 'granted') window.csLoadClarity?.()
  else if (window.csClarityLoaded) window.clarity?.('consentv2', { ad_Storage: 'denied', analytics_Storage: 'denied' })
  try {
    localStorage.setItem(KEY, choice)
  } catch {
    /* navegação privada: a escolha vale só para esta visita */
  }
}

const SHOW_AFTER_MS = 6000
const SHOW_AFTER_SCROLL_PX = 40

/**
 * Mostra o aviso só para quem ainda não escolheu, e só depois que a pessoa rolar a página
 * ou depois de ~6 s (o que vier primeiro), para a animação do hero ser vista antes.
 * Até a escolha, o Consent Mode continua negando tudo (nada é medido).
 * `onVisibleChange` avisa a página para esconder a barra fixa de CTA enquanto o aviso estiver na tela.
 */
export function CookieConsent({ onVisibleChange }: { onVisibleChange?: (visible: boolean) => void }) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    let saved: string | null = null
    try {
      saved = localStorage.getItem(KEY)
    } catch {
      /* sem acesso ao armazenamento: pergunta de novo */
    }
    const preview = import.meta.env.DEV && new URLSearchParams(window.location.search).get('cookies') === 'previa'
    if (preview) return setShow(true)
    if (saved === 'granted' || saved === 'denied') return

    let done = false
    const reveal = () => {
      if (done) return
      done = true
      setShow(true)
      cleanup()
    }
    const onScroll = () => window.scrollY > SHOW_AFTER_SCROLL_PX && reveal()
    const timer = window.setTimeout(reveal, SHOW_AFTER_MS)
    window.addEventListener('scroll', onScroll, { passive: true })
    const cleanup = () => {
      window.clearTimeout(timer)
      window.removeEventListener('scroll', onScroll)
    }
    return cleanup
  }, [])

  useEffect(() => onVisibleChange?.(show), [show, onVisibleChange])

  return show ? <CookieBanner onClose={() => setShow(false)} /> : null
}

/**
 * Faixa fina no rodapé: uma linha de texto e "Aceitar" / "Recusar" lado a lado, com o MESMO destaque.
 * Não bloqueia a rolagem nem escurece a página.
 */
export function CookieBanner({ onClose }: { onClose?: () => void }) {
  const choose = (c: Choice) => {
    updateConsent(c)
    onClose?.()
  }
  const btn =
    'inline-flex h-10 min-w-0 flex-1 items-center justify-center rounded-xl border border-ink/15 bg-white px-4 text-[0.9rem] font-semibold text-ink shadow-[0_1px_2px_rgba(15,17,23,.06)] transition hover:border-brand/40 hover:bg-brand-soft active:scale-[.99] sm:h-9 sm:w-28 sm:flex-none'
  return (
    <div
      role="region"
      aria-label="Aviso de cookies"
      data-bottom-bar="cookies"
      className="fixed inset-x-0 bottom-0 z-[60] border-t border-ink/10 bg-white/95 shadow-[0_-8px_24px_-12px_rgba(41,48,110,.25)] backdrop-blur-xl motion-safe:animate-[cs-rise_.35s_cubic-bezier(.22,1,.36,1)]"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 pb-[max(0.625rem,env(safe-area-inset-bottom))] pt-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6 sm:py-2.5 lg:px-8">
        <p className="text-[0.8125rem] leading-snug text-muted">
          Usamos cookies para medir nossos anúncios.{' '}
          <a href="/privacidade/" className="font-semibold text-brand underline underline-offset-2">
            Saiba mais
          </a>
        </p>
        <div className="flex shrink-0 gap-2">
          <button type="button" className={btn} onClick={() => choose('granted')}>
            Aceitar
          </button>
          <button type="button" className={btn} onClick={() => choose('denied')}>
            Recusar
          </button>
        </div>
      </div>
    </div>
  )
}
