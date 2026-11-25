// Peças de uma interface de chat GENÉRICA (sem cores, ícones ou layout de apps reais).
import { motion, type MotionValue } from 'motion/react'
import sapatilha from '../../assets/media/sapatilha-thumb.jpg'
import type { ReactNode } from 'react'

type Who = 'OUTRO' | 'VOCÊ'

export function AffiliateLink({ who, size = 10 }: { who: Who; size?: number }) {
  const mine = who === 'VOCÊ'
  return (
    <p className="whitespace-nowrap font-mono leading-[1.4]" style={{ fontSize: size }}>
      <span className="text-zinc-500">…/afiliado=</span>
      <span className={`rounded-[3px] px-[3px] font-bold ${mine ? 'bg-brand/12 text-brand' : 'bg-zinc-100 text-zinc-600'}`}>
        {who}
      </span>
    </p>
  )
}

/** Duplo check genérico. Fica verde quando publicado. */
export function Checks({
  second = 1,
  lit = 1,
  first = 1,
}: {
  first?: number | MotionValue<number>
  second?: number | MotionValue<number>
  lit?: number | MotionValue<number>
}) {
  return (
    <span className="relative inline-block h-[9px] w-[15px]">
      {(['#a1a1aa', '#1f9d55'] as const).map((color, i) => (
        <motion.svg
          key={color}
          viewBox="0 0 16 10"
          className="absolute inset-0 size-full"
          style={{ opacity: i === 0 ? 1 : lit }}
          fill="none"
          stroke={color}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <motion.path d="M1 5.5 3.8 8.3 9.5 1.7" style={{ opacity: first }} />
          <motion.path d="M6.5 7.6l.7.7 5.7-6.6" style={{ opacity: second }} />
        </motion.svg>
      ))}
    </span>
  )
}

export function ProductThumb({ className = '' }: { className?: string }) {
  // Fone de ouvido genérico desenhado em SVG (sem foto de marca).
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="thumb-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#eef1f7" />
          <stop offset="1" stopColor="#dde2ec" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="9" fill="url(#thumb-bg)" />
      <rect x="11" y="20" width="26" height="17" rx="8.5" fill="#ffffff" stroke="#c9d0dc" />
      <path d="M11.5 26h25" stroke="#d7dce5" />
      <ellipse cx="18" cy="17" rx="4.6" ry="5.4" fill="#ffffff" stroke="#c9d0dc" />
      <ellipse cx="30" cy="17" rx="4.6" ry="5.4" fill="#ffffff" stroke="#c9d0dc" />
      <circle cx="18" cy="16" r="1.5" fill="#9aa3b2" />
      <circle cx="30" cy="16" r="1.5" fill="#9aa3b2" />
      <circle cx="24" cy="31" r="1.2" fill="#5b65db" />
    </svg>
  )
}

const bubbleShape = (mine: boolean) =>
  mine
    ? 'rounded-[14px] rounded-tr-[4px] bg-brand-soft ring-1 ring-brand/30'
    : 'rounded-[14px] rounded-tl-[4px] bg-white ring-1 ring-line shadow-[0_1px_2px_rgba(15,17,23,.05)]'

/** Balão da oferta principal (148×132). */
export function OfferBubble({ mine = false, checks }: { mine?: boolean; checks?: ReactNode }) {
  return (
    <div className={`relative h-[132px] w-[148px] p-2 text-left ${bubbleShape(mine)}`}>
      <p className={`mb-1 text-[8.5px] font-semibold leading-none ${mine ? 'text-brand' : 'text-sky-700'}`}>
        {mine ? 'publicado pela Rota' : 'Admin Ofertas'}
      </p>
      <div className="flex gap-2">
        <img src={sapatilha} alt="" width={48} height={48} decoding="async" className="size-12 shrink-0 rounded-[9px] bg-white object-contain ring-1 ring-line" />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold leading-[1.2] text-ink">Sapatilha Aquática Preta</p>
          <span className="mt-1 inline-block rounded-[4px] bg-ink px-1 py-[1px] text-[8.5px] font-extrabold text-white">
            37% OFF
          </span>
        </div>
      </div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <s className="text-[9px] text-zinc-400">R$ 60,00</s>
        <b className="font-display text-[14px] font-bold text-ink">R$ 37,73</b>
      </div>
      <div className="mt-1">
        <AffiliateLink who={mine ? 'VOCÊ' : 'OUTRO'} />
      </div>
      <div className="absolute bottom-1.5 right-2 flex items-center gap-1 text-[8px] text-zinc-400">10:42 {checks}</div>
    </div>
  )
}

/** Oferta antiga, compacta (136×52). */
export function OldOffer({ title, off, mine = false }: { title: string; off?: string; mine?: boolean }) {
  return (
    <div className={`relative h-[52px] w-[136px] px-2 py-1.5 ${bubbleShape(mine)}`}>
      <div className="flex items-center gap-1.5">
        <span className="size-[18px] shrink-0 rounded-[5px] bg-gradient-to-br from-zinc-200 to-zinc-300" />
        <p className="truncate text-[9.5px] font-semibold text-ink">{title}</p>
        {off && <span className="ml-auto shrink-0 text-[8px] font-bold text-zinc-500">{off}</span>}
      </div>
      <div className="mt-1.5">
        <AffiliateLink who={mine ? 'VOCÊ' : 'OUTRO'} size={9} />
      </div>
      {mine && (
        <span className="absolute bottom-1 right-1.5">
          <Checks />
        </span>
      )}
    </div>
  )
}

export function TextBubble({ children }: { children: ReactNode }) {
  return (
    <div className="w-fit max-w-[136px] rounded-[12px] rounded-tl-[4px] bg-white px-2 py-1.5 text-[9.5px] leading-tight text-ink ring-1 ring-line">
      {children}
    </div>
  )
}

export function ChatHeader({
  title,
  subtitle,
  icon,
  accent = false,
  live,
}: {
  title: string
  subtitle: string
  icon: ReactNode
  accent?: boolean
  live?: ReactNode
}) {
  return (
    <div className="flex h-11 items-center gap-2 border-b border-line px-2.5">
      <span
        className={`grid size-7 shrink-0 place-items-center rounded-full ${accent ? 'bg-brand-soft text-brand ring-1 ring-brand/40' : 'bg-zinc-100 text-zinc-500'}`}
      >
        {icon}
      </span>
      <div className="min-w-0 leading-none">
        <p className="truncate text-[11px] font-bold text-ink">{title}</p>
        <p className={`mt-1 truncate text-[8.5px] ${accent ? 'text-brand' : 'text-zinc-500'}`}>{subtitle}</p>
      </div>
      {live}
    </div>
  )
}

export function StatusBar() {
  return (
    <div className="absolute inset-x-0 top-0 flex h-7 items-center justify-between px-6 text-[10px] font-semibold text-ink">
      <span>9:41</span>
      <span className="absolute left-1/2 top-[7px] h-[20px] w-[78px] -translate-x-1/2 rounded-full bg-black" />
      <span className="flex items-center gap-1">
        <span className="flex items-end gap-[1.5px]">
          {[3, 5, 7, 9].map((h) => (
            <span key={h} className="w-[2.5px] rounded-[1px] bg-ink" style={{ height: h }} />
          ))}
        </span>
        <span className="ml-1 flex h-[9px] w-[18px] items-center rounded-[3px] border border-ink/50 p-[1px]">
          <span className="h-full w-[70%] rounded-[1.5px] bg-ink" />
        </span>
      </span>
    </div>
  )
}

export const TagIcon = (
  <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" strokeLinejoin="round" />
    <circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" stroke="none" />
  </svg>
)

export const GroupIcon = (
  <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5" strokeLinecap="round" />
    <path d="M16 5.2a3 3 0 0 1 0 5.6M18 14.4c1.6.7 2.7 2.2 3 4.6" strokeLinecap="round" />
  </svg>
)
