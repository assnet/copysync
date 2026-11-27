import { useEffect, useState } from 'react'
import { SUPPORT } from '../config'
import { track } from '../lib/track'
import channelIcons from '../assets/channel_icons.json'

/**
 * Botão flutuante de suporte no WhatsApp (canto inferior direito) com o balão "Tem alguma dúvida?".
 * `raised`: a barra fixa de CTA do celular está na tela, então o botão sobe para não cobri-la.
 * `aboveCookies`: o aviso de cookies está na tela; o botão fica logo acima dele (altura medida) e
 * volta ao canto quando o aviso fecha.
 */
export function SupportFloat({ raised, aboveCookies }: { raised: boolean; aboveCookies: boolean }) {
  const cookiesHeight = useBottomBarHeight('cookies', aboveCookies)
  const lifted = aboveCookies && cookiesHeight > 0
  return (
    <a
      href={SUPPORT.whatsappUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Tem alguma dúvida? Fale com o suporte no WhatsApp"
      style={lifted ? { bottom: cookiesHeight + 12 } : undefined}
      onClick={() => track('support_click', { block: 'botao_flutuante' })}
      className={`group fixed right-4 z-40 flex items-center gap-2 transition-[bottom] duration-300 ease-[cubic-bezier(.22,1,.36,1)] sm:right-6 ${
        raised ? 'bottom-[calc(5.5rem+env(safe-area-inset-bottom))] lg:bottom-6' : 'bottom-[max(1rem,env(safe-area-inset-bottom))] sm:bottom-6'
      }`}
    >
      <span className="rounded-full border border-line bg-white px-3.5 py-2 text-sm font-medium text-ink shadow-[0_8px_24px_-10px_rgba(41,48,110,.35)] transition-transform group-hover:-translate-x-0.5">
        Tem alguma dúvida?
      </span>
      <span className="grid size-14 shrink-0 place-items-center rounded-full bg-[#25D366] shadow-[0_10px_28px_-8px_rgba(18,140,126,.7)] transition-transform group-hover:scale-105 group-active:scale-95">
        <svg viewBox="0 0 24 24" className="size-8" aria-hidden="true">
          <path d={channelIcons.whatsapp} fill="#fff" />
        </svg>
      </span>
    </a>
  )
}

/** Altura da barra fixa do rodapé marcada com `data-bottom-bar`, acompanhando mudanças de tamanho. */
function useBottomBarHeight(bar: string, active: boolean) {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    if (!active) return setHeight(0)
    const el = document.querySelector<HTMLElement>(`[data-bottom-bar="${bar}"]`)
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [bar, active])
  return height
}
