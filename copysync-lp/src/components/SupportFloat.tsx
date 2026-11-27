import { SUPPORT } from '../config'
import { track } from '../lib/track'
import channelIcons from '../assets/channel_icons.json'

/**
 * Botão flutuante de suporte no WhatsApp (canto inferior direito) com o balão "Tem alguma dúvida?".
 * `raised`: a barra fixa de CTA do celular está na tela, então o botão sobe para não cobri-la.
 * `hidden`: o aviso de cookies ocupa o rodapé; o botão sai até ele fechar.
 */
export function SupportFloat({ raised, hidden }: { raised: boolean; hidden: boolean }) {
  return (
    <a
      href={SUPPORT.whatsappUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Tem alguma dúvida? Fale com o suporte no WhatsApp"
      inert={hidden}
      onClick={() => track('support_click', { block: 'botao_flutuante' })}
      className={`group fixed right-4 z-40 flex items-center gap-2 transition-[bottom,opacity,transform] duration-300 ease-[cubic-bezier(.22,1,.36,1)] sm:right-6 ${
        raised ? 'bottom-[calc(5.5rem+env(safe-area-inset-bottom))] lg:bottom-6' : 'bottom-[max(1rem,env(safe-area-inset-bottom))] sm:bottom-6'
      } ${hidden ? 'pointer-events-none translate-y-4 opacity-0' : 'opacity-100'}`}
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
