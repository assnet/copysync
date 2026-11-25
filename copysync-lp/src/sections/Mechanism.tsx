import { motion, useMotionValue, useScroll, useTransform, type MotionValue } from 'motion/react'
import { useRef, type ReactNode } from 'react'
import { LoopClip } from '../components/LoopClip'
import { ScreenFrame } from '../components/ScreenFrame'
import { useReducedMotionSafe } from '../lib/useReducedMotion'
import { CLIPS } from '../media/clips'
import { Checks } from './hero/ChatParts'
import { T, lerp, scrambleAt } from './hero/route'

// Ponto do scroll (0→1) em que cada cartão acende.
const LIT = [0.14, 0.5, 0.86]

/** Bloco 3 · O MECANISMO — "Rota Automática de Ofertas" */
export function Mechanism() {
  const reduce = useReducedMotionSafe()
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 78%', 'end 45%'] })
  const done = useMotionValue(1)
  const p = reduce ? done : scrollYProgress

  const pos = useTransform(p, (v) => `${Math.min(100, Math.max(0, v * 100))}%`)
  const particleOpacity = useTransform(p, [0, 0.04, 0.96, 1], [0, 1, 1, 0.6])
  const trail = useTransform(p, (v) => `${Math.min(1, Math.max(0, v)) * 100}%`)

  return (
    <section id="mecanismo" aria-labelledby="mecanismo-title" className="bg-white px-4 pb-20 pt-14 sm:px-6 sm:pb-28 sm:pt-16 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2
            id="mecanismo-title"
            className="font-display text-[2.1rem] font-extrabold leading-[1.06] tracking-[-0.03em] text-ink text-balance sm:text-5xl"
          >
            <span className="hl">Rota Automática de Ofertas</span>
          </h2>
          <p className="mt-4 text-lg text-muted sm:text-xl">Do grupo dos outros para o seu, com o seu link.</p>
        </div>

        <div ref={ref} className="relative mx-auto mt-14 max-w-md lg:mt-20 lg:max-w-none">
          {/* Linha de luz: vertical no celular, horizontal no desktop */}
          <div aria-hidden="true" className="absolute inset-y-10 left-1/2 w-[3px] -translate-x-1/2 rounded-full bg-brand/15 lg:hidden">
            <motion.div style={{ height: trail }} className="w-full rounded-full bg-[linear-gradient(180deg,#5869da,#7042e3)]" />
            <motion.span
              style={{ top: pos, opacity: particleOpacity }}
              className="absolute left-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand shadow-[0_0_0_6px_rgba(91,101,219,.18),0_0_24px_6px_rgba(91,101,219,.55)]"
            />
          </div>
          <div aria-hidden="true" className="absolute inset-x-[12%] top-[88px] hidden h-[3px] rounded-full bg-brand/15 lg:block">
            <motion.div style={{ width: trail }} className="h-full rounded-full bg-[linear-gradient(90deg,#5869da,#7042e3)]" />
            <motion.span
              style={{ left: pos, opacity: particleOpacity }}
              className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand shadow-[0_0_0_6px_rgba(91,101,219,.18),0_0_24px_6px_rgba(91,101,219,.55)]"
            />
          </div>

          <ol className="relative grid gap-10 lg:grid-cols-3 lg:gap-8">
            <StepCard n={1} p={p} at={LIT[0]} title="Monitora" line="Você escolhe os grupos de onde vêm as ofertas." icon={<RadarIcon />}>
              <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-[0.8rem] font-semibold text-ink ring-1 ring-line">
                <span className="relative flex size-2">
                  <span className="absolute inset-0 rounded-full bg-brand/50 motion-safe:animate-ping" />
                  <span className="relative size-2 rounded-full bg-brand" />
                </span>
                Grupo de Ofertas · monitorando
              </div>
            </StepCard>
            <StepCard n={2} p={p} at={LIT[1]} title="Troca o link" line="A CopySync coloca o seu link de afiliado no lugar do original." icon={<LinkIcon />}>
              <LinkSwap p={p} />
            </StepCard>
            <StepCard n={3} p={p} at={LIT[2]} title="Publica" line="A oferta vai para os seus grupos, sozinha." icon={<SendIcon />}>
              <div className="flex items-center justify-between gap-2 rounded-xl bg-brand-soft px-3 py-2 text-[0.8rem] font-semibold text-ink ring-1 ring-brand/25">
                Publicada no Seu Grupo
                <Checks />
              </div>
            </StepCard>
          </ol>
        </div>

        <figure className="mx-auto mt-14 max-w-[420px] sm:max-w-3xl lg:mt-20">
          <ScreenFrame>
            <LoopClip
              clip={CLIPS.monitoramento}
              label="Gravação do painel: lista de ofertas capturadas do Mercado Livre, cada uma marcada como Enviada para 1 de 1 grupo."
            />
          </ScreenFrame>
          <figcaption className="mt-3 text-center text-sm text-muted">Ofertas capturadas e enviadas, no painel real</figcaption>
        </figure>

        <p className="mx-auto mt-16 max-w-2xl text-center font-display text-2xl font-bold leading-snug tracking-[-0.02em] text-ink text-balance sm:mt-20 sm:text-[2rem]">
          Você escolhe as fontes uma vez. A Rota faz o resto.
        </p>
      </div>
    </section>
  )
}

function StepCard({
  n,
  p,
  at,
  title,
  line,
  icon,
  children,
}: {
  n: number
  p: MotionValue<number>
  at: number
  title: string
  line: string
  icon: ReactNode
  children: ReactNode
}) {
  const lit = useTransform(p, [at - 0.06, at + 0.02], [0, 1])
  const scale = useTransform(lit, [0, 1], [0.98, 1])
  const iconColor = useTransform(lit, (v) => (v > 0.5 ? '#ffffff' : '#5b65db'))
  return (
    <motion.li
      style={{ scale }}
      className="relative rounded-[26px] border border-white/70 bg-white/55 p-6 shadow-[0_1px_2px_rgba(15,17,23,.04),0_20px_50px_-24px_rgba(41,48,110,.35)] backdrop-blur-xl"
    >
      {/* brilho quando a partícula passa */}
      <motion.div
        aria-hidden="true"
        style={{ opacity: lit }}
        className="pointer-events-none absolute -inset-px rounded-[26px] ring-2 ring-brand/60 shadow-[0_0_0_6px_rgba(91,101,219,.08),0_24px_60px_-20px_rgba(91,101,219,.55)]"
      />
      <div className="relative flex items-center gap-3">
        <span className="relative grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand">
          <motion.span
            aria-hidden="true"
            style={{ opacity: lit }}
            className="absolute inset-0 rounded-2xl bg-[linear-gradient(135deg,#5869da,#7042e3)]"
          />
          <motion.span style={{ color: iconColor }} className="relative">
            {icon}
          </motion.span>
        </span>
        <div>
          <p className="font-mono text-xs font-semibold text-muted">Etapa {n}</p>
          <h3 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-ink">{title}</h3>
        </div>
      </div>
      <p className="relative mt-3 text-[0.98rem] leading-relaxed text-muted">{line}</p>
      <div className="relative mt-4">{children}</div>
    </motion.li>
  )
}

/** Mesma transformação do hero: afiliado=OUTRO → afiliado=VOCÊ, guiada pelo scroll. */
function LinkSwap({ p }: { p: MotionValue<number> }) {
  // antes do cartão 2 acender: OUTRO; durante: troca de caracteres; depois: VOCÊ
  const toT = (v: number) =>
    v < 0.44 ? T.scrambleStart - 0.01 : lerp(T.scrambleStart, T.scrambleEnd, Math.min(1, (v - 0.44) / 0.1))
  const code = useTransform(p, (v) => scrambleAt(toT(v)))
  const done = useTransform(p, (v) => toT(v) >= T.scrambleEnd)
  const color = useTransform(done, (d) => (d ? '#5b65db' : '#52525b'))
  const bg = useTransform(done, (d) => (d ? 'rgba(91,101,219,.12)' : 'rgba(15,17,23,.05)'))
  return (
    <div className="rounded-xl bg-white px-3 py-2 font-mono text-[0.85rem] ring-1 ring-line">
      <span className="text-zinc-500">…/afiliado=</span>
      <motion.b style={{ color, backgroundColor: bg }} className="rounded px-1">
        {code}
      </motion.b>
    </div>
  )
}

const iconProps = {
  viewBox: '0 0 24 24',
  className: 'size-6',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

function RadarIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <path d="M12 12 18.5 5.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </svg>
  )
}

function LinkIcon() {
  return (
    <svg {...iconProps}>
      <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" />
      <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg {...iconProps}>
      <path d="M21 3 10.5 13.5" />
      <path d="M21 3 14.5 21l-4-7.5L3 9.5 21 3Z" />
    </svg>
  )
}
