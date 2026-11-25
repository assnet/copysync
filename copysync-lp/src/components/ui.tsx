import type { ComponentProps, MouseEvent, ReactNode } from 'react'
import { track } from '../lib/track'

/** Botão principal (gradiente da marca, igual ao "Assinar PRO" do app). */
export function CtaButton({
  href,
  block,
  cta,
  children,
  icon = 'arrow',
  className = '',
  destino,
  onClick,
}: {
  href: string
  block: string
  cta: string
  /** destino do clique, enviado no evento cta_click (ex.: "video") */
  destino?: string
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void
  children: ReactNode
  icon?: 'arrow' | 'down' | 'none'
  className?: string
}) {
  return (
    <a
      href={href}
      onClick={(e) => {
        track('cta_click', destino ? { block, cta, destino } : { block, cta })
        onClick?.(e)
      }}
      className={`group inline-flex min-h-14 items-center justify-center gap-2.5 rounded-2xl bg-[linear-gradient(100deg,var(--color-brand-from),var(--color-brand-to))] px-7 py-3 text-center font-display text-[1.05rem] font-bold text-white shadow-[0_1px_0_rgba(255,255,255,.25)_inset,0_10px_30px_-10px_rgba(91,101,219,.75),0_4px_10px_-4px_rgba(112,66,227,.4)] transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand active:scale-[.98] ${className}`}
    >
      {children}
      {icon !== 'none' && (
        <svg
          viewBox="0 0 24 24"
          className={`size-5 shrink-0 transition-transform ${icon === 'down' ? 'motion-safe:group-hover:translate-y-0.5' : 'motion-safe:group-hover:translate-x-0.5'}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {icon === 'down' ? <path d="M12 5v14M6 13l6 6 6-6" /> : <path d="M5 12h14M13 6l6 6-6 6" />}
        </svg>
      )}
    </a>
  )
}

export function ShieldIcon(props: ComponentProps<'svg'>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" {...props}>
      <path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Z" strokeLinejoin="round" />
      <path d="m9 12 2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Linha "Planos a partir de R$ 77/mês no anual · 7 dias de garantia" (link para os planos). LITE anual = 12x de R$ 77. */
export function PriceLine({ block, className = '' }: { block: string; className?: string }) {
  return (
    <a
      href="#planos"
      onClick={() => track('cta_click', { block, cta: 'planos_texto' })}
      className={`block text-center text-sm text-muted text-balance underline-offset-4 transition hover:text-ink hover:underline ${className}`}
    >
      {/* escudo dentro do texto: se a linha quebrar no celular, ele acompanha a primeira palavra */}
      <ShieldIcon className="mr-1.5 inline-block size-4 align-[-3px] text-brand" />
      Planos a partir de R$&nbsp;77/mês no anual · 7&nbsp;dias de garantia
    </a>
  )
}

export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p className={`font-display text-[0.8rem] font-bold uppercase tracking-[0.16em] text-brand ${className}`}>
      {children}
    </p>
  )
}
