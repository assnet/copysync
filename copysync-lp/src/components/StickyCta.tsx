import { ANCHOR, PRICE_FROM } from '../config'
import { track } from '../lib/track'

/** Barra de CTA fixa no rodapé do celular, depois que o hero sai da tela. */
export function StickyCta({ visible }: { visible: boolean }) {
  return (
    <div
      inert={!visible}
      data-bottom-bar="cta"
      className={`fixed inset-x-0 bottom-0 z-50 transition-transform duration-300 ease-[cubic-bezier(.22,1,.36,1)] lg:hidden ${visible ? 'translate-y-0' : 'translate-y-full'}`}
    >
      <div className="flex items-center gap-3 border-t border-white/60 bg-white/80 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-10px_30px_-12px_rgba(41,48,110,.25)] backdrop-blur-xl backdrop-saturate-150">
        <p className="shrink-0 whitespace-nowrap text-[11px] leading-tight text-muted">
          {/* "a partir de R$ 77/mês no anual" caberia em 360px, mas espremeria o botão sem folga */}
          <strong className="font-display text-sm text-ink">{PRICE_FROM}</strong> no anual
        </p>
        <a
          href={ANCHOR.planos}
          onClick={() => track('cta_click', { block: 'barra_fixa', cta: 'quero_automatizar' })}
          className="ml-auto inline-flex h-12 flex-1 items-center justify-center rounded-xl bg-[linear-gradient(100deg,var(--color-brand-from),var(--color-brand-to))] px-4 text-center font-display text-[0.95rem] font-bold leading-tight text-white shadow-[0_8px_24px_-8px_rgba(91,101,219,.75)] active:scale-[.98]"
        >
          <span className="min-[430px]:hidden">Quero automatizar</span>
          <span className="hidden min-[430px]:inline">Quero automatizar meus grupos</span>
        </a>
      </div>
    </div>
  )
}
