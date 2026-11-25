import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

/**
 * Linha com tooltip no estilo do app (caixa cinza-escura com seta, acima da linha, centralizada).
 * Abre ao passar o mouse na linha, ou ao tocar/focar o ícone ⓘ (celular e teclado).
 */
export function HintRow({
  hint,
  label,
  children,
  className = '',
  iconClassName = '',
}: {
  hint?: string
  label: string
  children: ReactNode
  className?: string
  iconClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  const pointer = useRef('')

  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  if (!hint) return <div className={className}>{children}</div>

  return (
    <div
      ref={ref}
      className={`relative ${className}`}
      onPointerEnter={(e) => e.pointerType === 'mouse' && setOpen(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setOpen(false)}
    >
      {children}
      <button
        type="button"
        aria-label={`Mais informações: ${label}`}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onPointerDown={(e) => (pointer.current = e.pointerType)}
        onClick={() => setOpen((o) => (pointer.current === 'mouse' ? true : !o))}
        onFocus={(e) => e.currentTarget.matches(':focus-visible') && setOpen(true)}
        onBlur={() => setOpen(false)}
        className={`absolute right-0 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-[#55596a] outline-none focus-visible:ring-2 focus-visible:ring-brand ${iconClassName}`}
      >
        <InfoIcon />
      </button>
      {open && (
        <div
          role="tooltip"
          id={id}
          className="absolute bottom-full left-1/2 z-30 mb-2 w-max max-w-[min(290px,calc(100vw-40px))] -translate-x-1/2 rounded-[4px] bg-[rgba(97,97,97,.94)] px-2 py-1 text-[11.5px] font-medium leading-[1.45] text-white shadow-[0_2px_8px_rgba(0,0,0,.15)]"
        >
          {hint}
          <span className="absolute left-1/2 top-full -mt-px size-0 -translate-x-1/2 border-x-[6px] border-t-[6px] border-x-transparent border-t-[rgba(97,97,97,.94)]" />
        </div>
      )}
    </div>
  )
}

export function InfoIcon({ className = 'size-[15px]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="9.2" />
      <path d="M12 11v5.2" strokeLinecap="round" />
      <circle cx="12" cy="7.8" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  )
}
