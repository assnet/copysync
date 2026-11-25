import { animate } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CtaButton } from '../components/ui'
import { ANCHOR } from '../config'
import { useReducedMotionSafe } from '../lib/useReducedMotion'

/**
 * "Quanto custaria fazer isso sem a CopySync?" — entre o palco dos recursos e os planos.
 * Valores de referência mensais informados pelo dono da página (nov/2026). Sem preço riscado, sem "por dia".
 */
type Tier = 'all' | 'pro' | 'max'

const TIER: Record<Tier, { label: string; className: string }> = {
  all: { label: 'Todos os planos', className: 'bg-save-bg text-save-ink' },
  pro: { label: 'A partir do PRO', className: 'bg-brand-soft text-[#3f48b8]' },
  max: { label: 'Plano MAX', className: 'bg-lilac text-violet ring-1 ring-inset ring-lilac-line/50' },
}

const ITEMS: { task: string; value: string; source?: string; amount: number; tier: Tier; icon: ReactNode }[] = [
  {
    task: 'Alguém postando ofertas nos seus grupos o dia todo (quase 3 horas de trabalho por dia)',
    value: '≈ R$ 810/mês',
    amount: 810,
    source: 'meio período pelo salário mínimo de 2026 (R$ 1.621)',
    tier: 'all',
    icon: <PersonIcon />,
  },
  {
    task: 'Arte de Story pronta para cada oferta',
    value: 'R$ 34,90/mês',
    amount: 34.9,
    source: 'Canva Pro',
    tier: 'max',
    icon: <ImageIcon />,
  },
  {
    task: 'Texto da oferta escrito com IA para o seu público',
    value: 'R$ 99,90/mês',
    amount: 99.9,
    source: 'ChatGPT Plus',
    tier: 'pro',
    icon: <SparkIcon />,
  },
  {
    task: 'Vigiar os grupos 24h e trocar o link pelo seu, sozinha',
    value: 'Não existe por fora',
    amount: 0, // não soma: ao entrar, o total ganha o selo "+ isso, que não tem preço"
    tier: 'all',
    icon: <RadarIcon />,
  },
]

const N = ITEMS.length // a barra do total entra depois, como o "cartão" de índice N
const TOTAL = ITEMS.reduce((a, it) => a + it.amount, 0)
const STAGGER = 250 // ms entre um cartão e outro

/** R$ 810 · R$ 844,90 · R$ 944,80 (sem centavos quando é inteiro) */
function money(v: number) {
  const r = Math.round(v * 100) / 100
  return 'R$ ' + r.toLocaleString('pt-BR', Number.isInteger(r) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function Cost() {
  const reduce = useReducedMotionSafe()
  const cardRefs = useRef<(HTMLElement | null)[]>([])
  // quantos itens já entraram (os N cartões e, por último, a barra do total). No servidor e sem JS: todos.
  const [shown, setShown] = useState(N + 1)
  const [armed, setArmed] = useState(false)
  const shownRef = useRef(N + 1)
  const wanted = useRef<boolean[]>(Array(N + 1).fill(false))
  // quantos valores a barra já somou (ela só soma depois de entrar)
  const [step, setStep] = useState(N)
  const busy = useRef(false)
  const timer = useRef<number>(0)

  // Ao carregar: os cartões que ainda estão abaixo da tela ficam esperando a vez (o total começa sem eles).
  useEffect(() => {
    if (reduce) return
    const firstBelow = cardRefs.current.findIndex((el) => el && el.getBoundingClientRect().top > window.innerHeight * 0.88)
    if (firstBelow === -1) return
    shownRef.current = firstBelow
    setShown(firstBelow)
    if (firstBelow <= N) setStep(0)
    setArmed(true)
  }, [reduce])

  // "reduzir movimento" (pode chegar depois da hidratação): tudo pronto, total final.
  useEffect(() => {
    if (!reduce) return
    window.clearTimeout(timer.current)
    shownRef.current = N + 1
    setShown(N + 1)
    setStep(N)
    setArmed(false)
  }, [reduce])

  // Um de cada vez, na ordem, com 250 ms entre eles; cada um só entra quando chega na tela.
  useEffect(() => {
    if (!armed) return
    const pump = () => {
      if (busy.current) return
      const next = shownRef.current
      if (next > N || !wanted.current[next]) return
      shownRef.current = next + 1
      setShown(next + 1)
      busy.current = true
      timer.current = window.setTimeout(() => {
        busy.current = false
        pump()
      }, STAGGER)
    }
    // checa na rolagem (4 cartões: barato). Pega também o pulo direto para baixo da lista.
    let raf = 0
    const check = () => {
      raf = 0
      const line = window.innerHeight * 0.88
      cardRefs.current.forEach((el, i) => {
        if (el && el.getBoundingClientRect().top < line) wanted.current[i] = true
      })
      pump()
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(check)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    check()
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      cancelAnimationFrame(raf)
      window.clearTimeout(timer.current)
      busy.current = false
    }
  }, [armed])

  // a barra entrou: soma um valor de cada vez, na frente da pessoa (R$ 0 → 810 → 844,90 → 944,80 → selo)
  const barIn = shown > N
  useEffect(() => {
    if (!armed || !barIn || step >= N) return
    const t = window.setTimeout(() => setStep((s) => s + 1), step === 0 ? 380 : 420)
    return () => window.clearTimeout(t)
  }, [armed, barIn, step])

  const total = ITEMS.slice(0, step).reduce((a, it) => a + it.amount, 0)
  const priceless = step >= N
  const barWaiting = armed && !barIn

  return (
    <section id="custo" aria-labelledby="custo-title" className="overflow-x-clip bg-white px-4 pb-20 pt-16 sm:px-6 sm:pb-24 sm:pt-20 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <h2
          id="custo-title"
          className="text-center font-display text-[2rem] font-extrabold leading-[1.08] tracking-[-0.03em] text-ink text-balance sm:text-[2.6rem]"
        >
          Quanto Custaria Fazer Isso Sem a CopySync?
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-center text-[1.05rem] leading-relaxed text-muted text-balance">
          Cada coisa que a CopySync faz por você, e quanto ela custaria se você pagasse por fora.
        </p>

        <div className="mt-10 sm:mt-12">
          <ul className="space-y-3">
            {ITEMS.map((it, i) => {
              const waiting = armed && i >= shown
              const entering = armed && i < shown
              return (
                <li
                  key={it.task}
                  ref={(el) => {
                    cardRefs.current[i] = el
                  }}
                  data-i={i}
                  data-cost-card=""
                  className={`grid gap-3 rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(15,17,23,.04)] sm:grid-cols-[minmax(0,1fr)_200px] sm:items-center sm:gap-6 sm:p-5 ${waiting ? 'opacity-0' : ''} ${entering ? 'animate-[cs-slam_380ms_cubic-bezier(.2,.9,.3,1)_both]' : ''}`}
                >
                  <div className="flex gap-3.5">
                    <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-ice text-ink/75">
                      {it.icon}
                    </span>
                    <div className="min-w-0">
                      <span className={`inline-block rounded-md px-2 py-0.5 text-[0.72rem] font-bold ${TIER[it.tier].className}`}>
                        {TIER[it.tier].label}
                      </span>
                      <p className="mt-1.5 text-[0.98rem] font-semibold leading-snug text-ink">{it.task}</p>
                    </div>
                  </div>
                  <div className="border-t border-dashed border-line pt-3 pl-[54px] sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
                    <p className="text-[0.72rem] font-semibold uppercase tracking-[0.1em] text-muted">Por fora</p>
                    <p className={`font-display text-[1.25rem] font-extrabold leading-tight tracking-[-0.01em] ${it.amount ? 'text-ink' : 'text-violet'}`}>
                      {it.value}
                    </p>
                    {it.source && <p className="mt-0.5 text-[0.82rem] leading-snug text-muted">{it.source}</p>}
                  </div>
                </li>
              )
            })}
          </ul>

          {/* total: entra depois do último cartão (não cobre a lista) e soma os valores na sequência */}
          <div
            ref={(el) => {
              cardRefs.current[N] = el
            }}
            className="mt-3"
          >
            <div
              data-cost-total=""
              className={`${barWaiting ? 'opacity-0' : ''} ${armed && barIn ? 'animate-[cs-slam_380ms_cubic-bezier(.2,.9,.3,1)_both]' : ''} flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-2xl bg-ink px-5 py-3.5 text-white shadow-[0_18px_40px_-18px_rgba(15,17,23,.6)] sm:px-6 sm:py-4`}
            >
              <span className="text-[0.95rem] font-semibold text-white/80">Por fora{priceless ? ':' : ', somando:'}</span>
              <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                {priceless && (
                  <span
                    data-cost-priceless=""
                    className={`rounded-full bg-[#2a2350] px-2.5 py-1 text-[0.78rem] font-bold text-[#d9ccff] ring-1 ring-inset ring-[#7c6ae6]/50 ${armed ? 'animate-[cs-pop_300ms_ease-out_both]' : ''}`}
                  >
                    + isso, que não tem preço
                  </span>
                )}
                <Total value={total} animate={armed} />
              </span>
            </div>
          </div>
        </div>

        {/* comparação: a barra (por fora) × na CopySync */}
        <div aria-hidden="true" className="relative my-4 flex justify-center">
          <span className="absolute inset-x-0 top-1/2 h-px bg-line" />
          <span className="relative grid size-11 place-items-center rounded-full bg-white font-display text-[0.95rem] font-extrabold text-muted ring-1 ring-line">
            vs
          </span>
        </div>
        <div className="mx-auto max-w-md rounded-3xl bg-brand p-6 text-center text-white shadow-[0_26px_50px_-24px_rgba(91,101,219,.85)] ring-4 ring-brand-soft sm:p-8">
          <p className="text-[0.78rem] font-bold uppercase tracking-[0.12em] text-white">Na CopySync</p>
          <p className="mt-2 font-display font-black leading-none tracking-[-0.03em]">
            <span className="block text-[1.05rem] font-bold tracking-normal">a partir de</span>
            <span className="text-[2.6rem] sm:text-[3rem]">
              R$ 77<span className="text-[1.25rem] font-extrabold">/mês</span>
            </span>
          </p>
          <p className="mx-auto mt-3 max-w-xs text-[0.95rem] font-medium leading-snug text-white text-balance">
            no LITE anual. Com tudo isso incluso: R$ 197/mês no MAX.
          </p>
        </div>

        <div className="mt-8 text-center">
          <CtaButton href={ANCHOR.planos} block="custo" cta="ver_planos" className="w-full max-w-sm sm:w-auto">
            Ver planos
          </CtaButton>
        </div>

        <p className="mt-5 text-center text-[0.78rem] text-muted">Valores de referência em reais, consultados em novembro de 2026.</p>
      </div>
    </section>
  )
}

/** Número do total: conta rápido até o novo valor (≈ 450 ms) e dá um pulinho. */
function Total({ value, animate: live }: { value: number; animate: boolean }) {
  const [shown, setShown] = useState(value)
  const [moving, setMoving] = useState(false)
  const from = useRef(value)
  useEffect(() => {
    if (!live) {
      from.current = value
      setShown(value)
      setMoving(false)
      return
    }
    if (from.current === value) return
    setMoving(true)
    const c = animate(from.current, value, {
      duration: 0.45,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setShown(Math.floor(v)),
      onComplete: () => {
        setShown(value)
        setMoving(false)
      },
    })
    from.current = value
    return () => {
      c.stop()
      setMoving(false)
    }
  }, [value, live])
  return (
    <span className="font-display text-[2rem] font-extrabold leading-none tracking-[-0.02em] tabular-nums sm:text-[2.4rem]">
      <span aria-hidden="true" key={value} className={`inline-block ${live ? 'animate-[cs-tick_350ms_ease-out]' : ''}`}>
        {moving ? money(Math.floor(shown)) : money(shown)}
      </span>
      <span className="sr-only">{money(TOTAL)} por mês</span>
      <span className="ml-1 align-middle text-[0.95rem] font-bold text-white/70">por mês</span>
    </span>
  )
}

const svg = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round', className: 'size-5' } as const

function PersonIcon() {
  return (
    <svg {...svg}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19.5c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" />
      <circle cx="17.5" cy="15.5" r="3.5" />
      <path d="M17.5 13.8v1.9l1.2.8" />
    </svg>
  )
}
function ImageIcon() {
  return (
    <svg {...svg}>
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
      <path d="m6 16 3.5-3.5 3 3 2-2 3.5 3.5" />
      <circle cx="14.5" cy="8" r="1.4" />
    </svg>
  )
}
function SparkIcon() {
  return (
    <svg {...svg}>
      <path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18.2l-1.8-5.6-5.7-1.8L10.2 9 12 3.5Z" />
      <path d="M19 16.5v4M17 18.5h4" />
    </svg>
  )
}
function RadarIcon() {
  return (
    <svg {...svg}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 12 18 6" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </svg>
  )
}
