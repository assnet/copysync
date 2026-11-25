import { motion, useInView, useScroll, useTransform, type MotionValue } from 'motion/react'
import { useRef, type ReactNode } from 'react'
import { BrandIcon } from '../components/BrandMark'
import { useElapsed } from '../lib/useElapsed'
import { useReducedMotionSafe } from '../lib/useReducedMotion'
import sapatilha from '../assets/media/sapatilha-thumb.jpg'

// Tempos ILUSTRATIVOS (ms). Nenhum número de tempo aparece na tela (brief, Bloco 2).
const STEP_AT = [900, 1900, 2900, 3900, 4900]
const PUBLISHED_AT = 1300
const SOLD_OUT_AT = 5300
const BUYER_AT = 5900
const PUNCHLINE_AT = 6700
const END = 7200

const STEPS = ['Viu a oferta', 'Copiou', 'Gerou seu link', 'Colou', 'Enviou']

/** Bloco 2 · O PROBLEMA ESCONDIDO — "A Corrida do Link" (única seção escura). */
export function ProblemRace() {
  const reduce = useReducedMotionSafe()
  const raceRef = useRef<HTMLDivElement>(null)
  const started = useInView(raceRef, { once: true, amount: 0.45 })
  const ms = useElapsed(started, END, reduce)

  const checked = STEP_AT.filter((t) => ms >= t).length
  const published = ms >= PUBLISHED_AT
  const soldOut = ms >= SOLD_OUT_AT
  const buyer = ms >= BUYER_AT
  const punchline = ms >= PUNCHLINE_AT
  const clockRunning = started && !soldOut && !reduce

  // "Luzes se apagando": progresso do painel atravessando a tela → escuridão 0…1…0
  const panelRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: panelRef, offset: ['start end', 'end start'] })
  const dark = useTransform(scrollYProgress, [0.05, 0.28, 0.74, 0.96], [0, 1, 1, 0])
  const rise = useTransform(scrollYProgress, [0, 0.22], [36, 0])
  const riseScale = useTransform(scrollYProgress, [0, 0.22], [0.965, 1])

  return (
    <section
      id="problema"
      aria-labelledby="problema-title"
      className="relative bg-white px-2 py-3 text-white sm:px-4 sm:py-4 lg:px-6"
    >
      {!reduce && <LightsOut dark={dark} />}

      {/* Painel escuro flutuante: "sobe" sobre o fundo claro */}
      <motion.div ref={panelRef} style={reduce ? undefined : { y: rise, scale: riseScale }} className="relative z-[31] mx-auto max-w-[1400px]">
        <PanelHalo />
        <div className="relative overflow-hidden rounded-[32px] bg-navy shadow-[0_1px_2px_rgba(11,18,32,.10),0_30px_60px_-28px_rgba(76,70,214,.38),0_70px_120px_-50px_rgba(112,66,227,.32)] ring-1 ring-inset ring-white/[0.07] lg:rounded-[56px]">
          {/* halo da marca na borda de cima e de baixo (por dentro) */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_65%_100%_at_50%_0%,rgba(91,101,219,.26),rgba(91,101,219,0)_72%)]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-[radial-gradient(ellipse_65%_100%_at_50%_100%,rgba(112,66,227,.22),rgba(112,66,227,0)_72%)]"
          />
          {/* ruído sutil contra faixas no degradê */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.06] mix-blend-overlay [background-image:var(--noise)]" />

      <div className="relative mx-auto max-w-5xl px-3 pb-16 pt-16 sm:px-6 sm:pb-20 sm:pt-20 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="inline-flex items-center gap-2 rounded-full border border-amber/40 bg-amber/10 px-3.5 py-1.5 font-display text-xs font-extrabold uppercase tracking-[0.18em] text-amber">
            <StopwatchIcon className="size-4" />A corrida do link
          </p>
          <h2
            id="problema-title"
            className="mt-5 font-display text-[2rem] font-extrabold leading-[1.08] tracking-[-0.03em] text-balance sm:text-5xl"
          >
            Achadinho Tem Dono: Quem Posta Primeiro.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-[1.0625rem] leading-relaxed text-slate-300 text-pretty">
            Oferta relâmpago acaba. Cupom esgota. E se o seu membro também está em outro grupo, ele compra pelo link de
            quem postou antes de você.
          </p>
        </div>

        {/* Corrida em tela dividida */}
        <div
          ref={raceRef}
          className="relative mx-auto mt-10 grid max-w-4xl grid-cols-2 gap-2.5 sm:gap-5"
          role="img"
          aria-label="Comparação: no manual, você ainda está nos cinco passos quando a oferta esgota e o membro compra pelo link de outro grupo. Com a CopySync, a mesma oferta já foi publicada no seu grupo."
        >
          {/* Esquerda: manual */}
          <Lane
            tone="amber"
            title="Você, no manual"
            badge={<AmberClock running={clockRunning} />}
          >
            <div className="relative">
              <MiniOffer dim={soldOut} />
              <motion.div
                aria-hidden="true"
                initial={false}
                animate={soldOut ? { opacity: 1, scale: 1, rotate: -12 } : { opacity: 0, scale: 1.8, rotate: -4 }}
                transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 18 }}
                className="pointer-events-none absolute inset-0 grid place-items-center"
              >
                <span className="rounded-lg border-[3px] border-alarm px-2.5 py-1 font-display text-lg font-black uppercase tracking-[0.14em] text-alarm shadow-[0_0_24px_rgba(239,68,68,.45)] backdrop-blur-[1px] sm:text-2xl">
                  Esgotado
                </span>
              </motion.div>
            </div>

            <ol className="mt-3 space-y-1.5 sm:mt-4 sm:space-y-2">
              {STEPS.map((label, i) => {
                const done = i < checked
                const current = i === checked && started && !soldOut
                return (
                  <li
                    key={label}
                    className={`flex items-center gap-2 rounded-lg px-1.5 py-1 text-[0.8rem] transition-colors duration-500 sm:px-2.5 sm:py-1.5 sm:text-[0.95rem] ${done ? 'text-white' : 'text-slate-400'} ${current ? 'bg-amber/10' : ''}`}
                  >
                    <span
                      className={`grid size-4 shrink-0 place-items-center rounded-[5px] border transition-colors duration-500 sm:size-5 ${done ? 'border-amber bg-amber text-navy' : 'border-slate-600'}`}
                    >
                      {done && <CheckIcon className="size-3 sm:size-3.5" />}
                    </span>
                    {label}
                  </li>
                )
              })}
            </ol>

            <motion.div
              initial={false}
              animate={buyer ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
              transition={{ duration: reduce ? 0 : 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="mt-3 w-fit max-w-full rounded-2xl rounded-tl-md bg-slate-700/70 px-2.5 py-2 text-[0.78rem] leading-snug text-slate-100 ring-1 ring-white/10 sm:text-sm"
            >
              <span className="block text-[0.68rem] font-semibold text-sky-300 sm:text-xs">Membro do grupo</span>
              comprei pelo link do outro grupo 😅
            </motion.div>
          </Lane>

          {/* Direita: CopySync */}
          <Lane tone="brand" title="Com a CopySync" badge={<BrandIcon size={22} className="rounded-md" />}>
            <MiniOffer />
            <div className="relative mx-auto my-2 h-14 w-0.5 overflow-hidden rounded-full bg-brand/25 sm:my-3 sm:h-16">
              <motion.span
                initial={false}
                animate={started ? { y: ['-100%', '400%'] } : { y: '-100%' }}
                transition={reduce ? { duration: 0 } : { duration: 0.7, delay: 0.4, ease: 'easeIn' }}
                className="absolute inset-x-0 top-0 h-5 rounded-full bg-brand-light shadow-[0_0_12px_#8b96f0]"
              />
              <span className="absolute left-1/2 top-1/2 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center" />
            </div>
            <motion.div
              initial={false}
              animate={published ? { scale: 1 } : { scale: 0.97 }}
              transition={{ duration: reduce ? 0 : 0.35 }}
              className="relative overflow-hidden rounded-2xl bg-white/[0.06] p-2.5 ring-1 ring-white/10 sm:p-3"
            >
              <motion.span
                aria-hidden="true"
                initial={false}
                animate={published && !reduce ? { opacity: [0.9, 0] } : { opacity: 0 }}
                transition={{ duration: 0.9 }}
                className="absolute inset-0 bg-ok/60"
              />
              <p
                className={`relative flex items-center gap-1.5 text-[0.8rem] font-bold sm:text-sm ${published ? 'text-emerald-300' : 'text-slate-300'}`}
              >
                <span
                  className={`grid size-4 place-items-center rounded-full text-white sm:size-5 ${published ? 'bg-ok' : 'bg-slate-600'}`}
                >
                  {published && <CheckIcon className="size-2.5 sm:size-3" />}
                </span>
                {published ? 'Publicada no seu grupo' : 'Passando pela Rota…'}
              </p>
              <p className="relative mt-1.5 font-mono text-[0.7rem] text-slate-400 sm:text-xs">
                …/afiliado=<b className="rounded bg-brand/25 px-1 text-[#b4bbf7]">VOCÊ</b>
              </p>
            </motion.div>
            <p className="mt-3 text-[0.78rem] leading-snug text-slate-400 sm:text-sm">
              A mesma oferta passa pela Rota e chega ao seu grupo enquanto ainda está valendo.
            </p>
          </Lane>
        </div>

        <motion.p
          initial={false}
          animate={punchline ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
          transition={{ duration: reduce ? 0 : 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto mt-14 max-w-3xl text-center font-display text-[2.1rem] font-extrabold leading-[1.08] tracking-[-0.03em] text-balance sm:text-6xl"
        >
          Você não perdeu tempo. Perdeu{' '}
          <span className="bg-[linear-gradient(100deg,#f5a524,#ef4444)] bg-clip-text text-transparent">a venda.</span>
        </motion.p>
      </div>
        </div>
      </motion.div>
    </section>
  )
}

/**
 * Camada fixa que escurece tudo em volta do painel (o painel fica acima dela).
 * Cor interpolada em oklch passando por um índigo profundo — nunca por cinza — e aplicada em "multiply":
 * no branco vira exatamente a cor da camada; texto escuro continua escuro. Só muda uma cor; nada de layout.
 */
function LightsOut({ dark }: { dark: MotionValue<number> }) {
  const backgroundColor = useTransform(dark, lightsColor)
  const visibility = useTransform(dark, (d) => (d > 0.002 ? 'visible' : 'hidden'))
  return (
    <motion.div
      aria-hidden="true"
      style={{ backgroundColor, visibility }}
      className="pointer-events-none fixed inset-0 z-30 mix-blend-multiply"
    />
  )
}

// claro → índigo profundo → azul-marinho do painel (#0b1220 ≈ oklch(0.19 0.032 262))
const STOPS = [
  [1, 0, 280],
  [0.84, 0.07, 280],
  [0.56, 0.13, 282],
  [0.19, 0.032, 262],
] as const

function lightsColor(d: number) {
  const t = d * d * (3 - 2 * d) // suaviza começo e fim
  const seg = Math.min(STOPS.length - 2, Math.floor(t * (STOPS.length - 1)))
  const f = t * (STOPS.length - 1) - seg
  const [a, b] = [STOPS[seg], STOPS[seg + 1]]
  const mix = (i: number) => a[i] + (b[i] - a[i]) * f
  return `oklch(${mix(0).toFixed(4)} ${mix(1).toFixed(4)} ${mix(2).toFixed(2)})`
}

/** Brilho índigo/violeta por fora, nas bordas de cima e de baixo do painel. */
function PanelHalo() {
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-[10%] -top-8 h-20 rounded-[50%] bg-[radial-gradient(closest-side,rgba(99,102,241,.32),rgba(99,102,241,0))] blur-2xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-[10%] -bottom-8 h-20 rounded-[50%] bg-[radial-gradient(closest-side,rgba(124,58,237,.30),rgba(124,58,237,0))] blur-2xl"
      />
    </>
  )
}

function Lane({
  tone,
  title,
  badge,
  children,
}: {
  tone: 'amber' | 'brand'
  title: string
  badge: ReactNode
  children: ReactNode
}) {
  return (
    <div
      className={`rounded-[22px] p-2.5 ring-1 sm:rounded-[28px] sm:p-5 ${tone === 'amber' ? 'bg-[#141b2b] ring-amber/20' : 'bg-[#121a33] ring-brand/30'}`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <p
          className={`font-display text-[0.82rem] font-bold leading-tight sm:text-base ${tone === 'amber' ? 'text-amber' : 'text-brand-light'}`}
        >
          {title}
        </p>
        {badge}
      </div>
      {children}
    </div>
  )
}

function MiniOffer({ dim = false }: { dim?: boolean }) {
  return (
    <div
      className={`rounded-2xl bg-white p-2 text-ink transition-opacity duration-700 sm:flex sm:items-center sm:gap-3 sm:p-3 ${dim ? 'opacity-50' : ''}`}
    >
      <div className="flex items-center gap-2 sm:contents">
        <img src={sapatilha} alt="" width={56} height={56} loading="lazy" decoding="async" className="size-9 shrink-0 rounded-lg bg-white object-contain ring-1 ring-line sm:size-14" />
        <p className="min-w-0 text-[0.72rem] font-semibold leading-tight sm:hidden">Sapatilha Aquática Preta</p>
      </div>
      <div className="mt-1.5 min-w-0 sm:mt-0">
        <p className="hidden truncate text-sm font-semibold sm:block">Sapatilha Aquática Preta</p>
        <p className="text-[0.62rem] leading-tight text-zinc-500 sm:text-xs">
          de <s>R$ 60,00</s>
        </p>
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 whitespace-nowrap">
          <b className="font-display text-[0.95rem] sm:text-lg">R$ 37,73</b>
          <span className="rounded bg-ink px-1 text-[0.6rem] font-extrabold text-white sm:text-[0.7rem]">37% OFF</span>
        </p>
        <p className="text-[0.62rem] font-semibold uppercase tracking-wide text-red-600 sm:text-[0.7rem]">Menor valor da semana</p>
      </div>
    </div>
  )
}

/** Relógio âmbar correndo (sem números: os tempos são ilustrativos). */
function AmberClock({ running }: { running: boolean }) {
  return (
    <span className="relative grid size-7 place-items-center rounded-full border-2 border-amber sm:size-8" aria-hidden="true">
      <span
        className="absolute bottom-1/2 left-1/2 h-[38%] w-[2px] origin-bottom -translate-x-1/2 rounded-full bg-amber"
        style={{ animation: running ? 'spin 1.1s linear infinite' : 'none', transformOrigin: '50% 100%' }}
      />
      <span className="size-1.5 rounded-full bg-amber" />
    </span>
  )
}

function CheckIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  )
}

function StopwatchIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 9.5v4l2.5 1.5M9.5 2.5h5M19 6l1.5-1.5" />
    </svg>
  )
}
