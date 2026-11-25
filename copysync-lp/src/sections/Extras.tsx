import { animate, motion, useInView, useMotionValue, useScroll, useSpring, useTransform } from 'motion/react'
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { LoopClip } from '../components/LoopClip'
import { ScreenFrame } from '../components/ScreenFrame'
import { CtaButton } from '../components/ui'
import { ANCHOR } from '../config'
import { useMediaQuery } from '../lib/useMediaQuery'
import { useReducedMotionSafe } from '../lib/useReducedMotion'
import { CLIPS, type Clip } from '../media/clips'

/** Cor de destaque de cada recurso (nunca o gradiente índigo dos botões de compra). */
type Accent = { from: string; to: string; text: string }
const ACCENTS = {
  story: { from: '#ff4f8b', to: '#ff8a3d', text: '#ffb199' },
  gerador: { from: '#16a34a', to: '#4ade80', text: '#86efac' },
  pagina: { from: '#2563eb', to: '#38bdf8', text: '#93c5fd' },
  intercalar: { from: '#8b5cf6', to: '#2dd4bf', text: '#99f6e4' },
} satisfies Record<string, Accent>

type Extra = { title: string; plan: string; before: string; after: string; clip: Clip; label: string; accent: Accent }

// Planos conferidos no bloco de planos: Story de Oferta só no MAX ("Template para Instagram", exclusivo);
// Gerador de ofertas no LITE (logo, em todos); Página de Ofertas no PRO e no MAX; Intercalar = Cross Session, exclusivo do MAX.
const EXTRAS: Extra[] = [
  {
    title: 'Story de Oferta',
    plan: 'Plano MAX',
    before: 'Abrir o Canva, montar a arte e ajustar preço para cada oferta.',
    after: 'Cola o link, escolhe um dos 8 modelos e a arte sai pronta, com foto, preço e cupom, no tamanho do Story.',
    clip: CLIPS.story,
    label: 'Gravação do painel: grade com os 8 modelos de arte do Story de Oferta.',
    accent: ACCENTS.story,
  },
  {
    title: 'Gerador de Ofertas',
    plan: 'Todos os planos',
    before: 'Escrever cada oferta à mão: título, preço de e por, cupom e link.',
    after: 'Cola o link e a oferta sai montada, entra na fila e é enviada nos seus grupos, mesmo com o navegador fechado.',
    clip: CLIPS.gerador,
    label: 'Gravação do painel: fila de envio do Gerador de Ofertas, com 2 aguardando e 156 enviados hoje no grupo Achei Presente.',
    accent: ACCENTS.gerador,
  },
  {
    title: 'Página de Ofertas',
    plan: 'A partir do PRO',
    before: 'Quem chega pela sua bio não tem onde ver suas ofertas.',
    after: 'Uma página com as suas ofertas, pronta para a bio do Instagram e do WhatsApp.',
    clip: CLIPS.pagina,
    label: 'Gravação do painel: prévia em tempo real da Página de Ofertas, com produtos e botão Ver oferta.',
    accent: ACCENTS.pagina,
  },
  {
    title: 'Intercalar Sessões',
    plan: 'Plano MAX',
    before: 'Um número só para escutar as ofertas e para publicar em tudo.',
    after: 'Um número escuta as ofertas e outro publica nos seus grupos.',
    clip: CLIPS.intercalar,
    label: 'Gravação do painel: seletor de sessões do Monitoramento, com sessões de WhatsApp e Telegram conectadas.',
    accent: ACCENTS.intercalar,
  },
]

/** Palco dos recursos: fundo índigo-violeta com "chão" em perspectiva, contador e cartões com inclinação 3D. */
export function Extras() {
  return (
    <section id="recursos" aria-labelledby="recursos-title" className="bg-white px-2 py-3 sm:px-4 sm:py-4 lg:px-6">
      <div className="relative isolate mx-auto max-w-[1400px] overflow-hidden rounded-[32px] bg-[linear-gradient(180deg,#1c1850_0%,#29176a_48%,#1a1446_100%)] text-white shadow-[0_30px_70px_-34px_rgba(46,16,101,.55)] lg:rounded-[56px]">
        <StageBackdrop />

        <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-14 sm:px-6 sm:pb-20 sm:pt-20 lg:px-8">
          <Counter />

          <div className="mx-auto mt-14 max-w-2xl text-center sm:mt-16">
            <h2
              id="recursos-title"
              className="font-display text-[2.1rem] font-extrabold leading-[1.06] tracking-[-0.03em] text-white text-balance sm:text-5xl"
            >
              E Ainda Vem Junto
            </h2>
            <p className="mt-4 text-lg text-slate-300">Gravações do painel real. Cada recurso mostra o plano em que entra.</p>
          </div>

          <ul className="mx-auto mt-12 grid max-w-[440px] gap-10 [perspective:1400px] sm:mt-14 sm:max-w-none sm:grid-cols-2 sm:gap-x-8 sm:gap-y-12">
            {EXTRAS.map((x, i) => (
              <TiltCard key={x.title} index={i} accent={x.accent}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <h3 className="font-display text-xl font-bold tracking-[-0.01em] text-white">{x.title}</h3>
                  <span
                    className="rounded-full px-2.5 py-0.5 text-xs font-bold ring-1"
                    style={{ color: x.accent.text, backgroundColor: `${x.accent.from}26`, ['--tw-ring-color' as string]: `${x.accent.from}66` } as CSSProperties}
                  >
                    {x.plan}
                  </span>
                </div>
                <p className="mt-3 flex gap-2 text-[0.82rem] leading-snug text-slate-400">
                  <span aria-hidden="true" className="mt-[2px] grid size-[15px] shrink-0 place-items-center rounded-full text-[9px] ring-1 ring-slate-500/70">
                    ✕
                  </span>
                  <span>
                    <span className="font-semibold">Antes:</span> {x.before}
                  </span>
                </p>
                <p className="mt-1.5 text-[0.95rem] leading-snug text-slate-100">
                  <span className="font-bold" style={{ color: x.accent.text }}>
                    Com a CopySync:
                  </span>{' '}
                  {x.after}
                </p>
                <ScreenFrame tone="dark" className="mt-4">
                  <LoopClip clip={x.clip} label={x.label} />
                </ScreenFrame>
              </TiltCard>
            ))}
          </ul>

          <div className="mt-14 flex flex-col items-center gap-3 text-center sm:mt-16">
            <CtaButton href={ANCHOR.planos} block="recursos" cta="ver_planos" className="w-full max-w-sm sm:w-auto">
              Ver planos
            </CtaButton>
            <p className="text-[0.95rem] text-slate-300">Tudo isso a partir de R$ 77/mês no plano anual</p>
          </div>
        </div>
      </div>
    </section>
  )
}

/** Gradiente, brilhos suaves e uma grade em perspectiva como "chão" 3D (só CSS). */
function StageBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
      <div className="absolute -right-32 -top-40 h-[34rem] w-[34rem] rounded-full bg-[radial-gradient(closest-side,rgba(255,79,139,.20),transparent)]" />
      <div className="absolute -left-40 top-1/3 h-[36rem] w-[36rem] rounded-full bg-[radial-gradient(closest-side,rgba(45,212,191,.13),transparent)]" />
      <div className="absolute left-1/2 top-24 h-[22rem] w-[44rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(167,139,250,.22),transparent)]" />
      {/* chão em perspectiva */}
      <div className="absolute inset-x-0 bottom-0 h-[58%] overflow-hidden [perspective:620px]">
        <div className="absolute -inset-x-[40%] bottom-[-10%] top-0 origin-bottom [transform:rotateX(64deg)] [background-image:linear-gradient(rgba(196,181,253,.20)_1px,transparent_1px),linear-gradient(90deg,rgba(196,181,253,.20)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:linear-gradient(to_top,black_10%,transparent_85%)]" />
      </div>
      <div className="absolute inset-0 opacity-[0.07] mix-blend-overlay [background-image:var(--noise)]" />
    </div>
  )
}

/** Ofertas enviadas num só dia no Achei Presente (gravação do Gerador: "156 enviados hoje"). */
const SENT_IN_A_DAY = 156

/** Número grande de 0 a 156 quando entra na tela (parado em 156 com "reduzir movimento" ou sem JS). */
function Counter() {
  const reduce = useReducedMotionSafe()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.6 })
  const [n, setN] = useState(SENT_IN_A_DAY)
  const armed = useRef(false)

  // fora da tela, prepara o zero (sem piscar na frente da pessoa)
  useEffect(() => {
    if (reduce || armed.current) return
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.top > window.innerHeight || r.bottom < 0) {
      armed.current = true
      setN(0)
    }
  }, [reduce])

  // "reduzir movimento" (pode chegar depois da hidratação): número final, parado
  useEffect(() => {
    if (!reduce) return
    armed.current = false
    setN(SENT_IN_A_DAY)
  }, [reduce])

  useEffect(() => {
    if (!inView || reduce || !armed.current) return
    const controls = animate(0, SENT_IN_A_DAY, { duration: 1.8, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => setN(Math.round(v)) })
    return () => controls.stop()
  }, [inView, reduce])

  return (
    <div ref={ref} className="text-center">
      <p className="font-display text-[5.5rem] font-extrabold leading-none tracking-[-0.04em] tabular-nums sm:text-[8.5rem]">
        <span aria-hidden="true" className="bg-[linear-gradient(180deg,#ffffff_30%,#c4b5fd)] bg-clip-text text-transparent">
          {n}
        </span>
        <span className="sr-only">{SENT_IN_A_DAY}</span>
      </p>
      <p className="mx-auto mt-2 max-w-md text-lg font-medium text-slate-200 text-balance sm:text-xl">
        ofertas enviadas em um único grupo, num só dia
      </p>
      <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-slate-300/90 text-balance sm:text-base">
        No Achei Presente, o nosso grupo, e o dia ainda nem tinha acabado. Cada oferta capturada vai para todos os seus
        grupos de disparo de uma vez.
      </p>
    </div>
  )
}

/** Cartão com borda, brilho e etiqueta na cor do recurso. Entra inclinado ao rolar; no desktop, inclina com o mouse. */
function TiltCard({ index, accent, children }: { index: number; accent: Accent; children: ReactNode }) {
  const reduce = useReducedMotionSafe()
  const desktop = useMediaQuery('(min-width: 1024px) and (pointer: fine)')
  const ref = useRef<HTMLLIElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'start 55%'] })
  const dir = index % 2 === 0 ? 1 : -1
  const scrollRotX = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [desktop ? 16 : 9, 0])
  const scrollRotY = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [dir * (desktop ? 9 : 4), 0])
  const y = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [desktop ? 60 : 36, 0])

  const mx = useMotionValue(0)
  const my = useMotionValue(0)
  const smx = useSpring(mx, { stiffness: 140, damping: 18 })
  const smy = useSpring(my, { stiffness: 140, damping: 18 })
  const rotateX = useTransform([scrollRotX, smy], ([a, b]) => (a as number) - (b as number) * 5)
  const rotateY = useTransform([scrollRotY, smx], ([a, b]) => (a as number) + (b as number) * 7)

  const onMove = (e: PointerEvent<HTMLLIElement>) => {
    if (reduce || !desktop || e.pointerType !== 'mouse') return
    const r = e.currentTarget.getBoundingClientRect()
    mx.set(((e.clientX - r.left) / r.width) * 2 - 1)
    my.set(((e.clientY - r.top) / r.height) * 2 - 1)
  }
  const onLeave = () => {
    mx.set(0)
    my.set(0)
  }

  return (
    <motion.li
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      style={{ rotateX, rotateY, y, transformPerspective: 1400 }}
      className="relative"
      data-tilt=""
    >
      {/* brilho na cor do recurso */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-3 -z-10 rounded-[30px] opacity-60 blur-2xl"
        style={{ background: `radial-gradient(60% 55% at 50% 70%, ${accent.from}55, transparent 70%)` }}
      />
      {/* borda em gradiente na cor do recurso */}
      <div className="rounded-[24px] p-px" style={{ background: `linear-gradient(140deg, ${accent.from}cc, ${accent.to}55 45%, rgba(255,255,255,.08))` }}>
        <div className="rounded-[23px] bg-[#16123c]/90 p-4 backdrop-blur sm:p-5">{children}</div>
      </div>
    </motion.li>
  )
}
