import type { ReactNode } from 'react'

/** Moldura de janela (barra com 3 pontos) para as gravações do painel real. */
export function ScreenFrame({
  children,
  className = '',
  label = 'Painel da CopySync',
  tone = 'light',
}: {
  children: ReactNode
  className?: string
  label?: string
  tone?: 'light' | 'dark'
}) {
  const dark = tone === 'dark'
  return (
    <div
      className={`overflow-hidden rounded-[18px] ${dark ? 'bg-[#15123a] ring-1 ring-white/10' : 'bg-white ring-1 ring-line shadow-[0_1px_2px_rgba(15,17,23,.06),0_24px_50px_-28px_rgba(41,48,110,.45)]'} ${className}`}
    >
      <div
        aria-hidden="true"
        className={`flex h-7 items-center gap-1.5 border-b px-3 ${dark ? 'border-white/10 bg-[#1b1745]' : 'border-line bg-[#f7f8fb]'}`}
      >
        <span className="size-2 rounded-full bg-[#ff5f57]" />
        <span className="size-2 rounded-full bg-[#febc2e]" />
        <span className="size-2 rounded-full bg-[#28c840]" />
        <span className={`ml-auto text-[0.68rem] font-semibold tracking-wide ${dark ? 'text-slate-400' : 'text-muted'}`}>{label}</span>
      </div>
      {children}
    </div>
  )
}
