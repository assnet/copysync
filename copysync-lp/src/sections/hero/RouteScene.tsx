import {
  motion,
  useAnimationFrame,
  useInView,
  useMotionValue,
  useTransform,
  type MotionValue,
} from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { BrandIcon } from '../../components/BrandMark'
import { HERO_TIMER_SECONDS } from '../../config'
import {
  ChatHeader,
  Checks,
  GroupIcon,
  OfferBubble,
  OldOffer,
  StatusBar,
  TagIcon,
  TextBubble,
} from './ChatParts'
import * as R from './route'

const { T } = R
const sampleA = R.makeSampler(R.ROUTE_A)
const sampleB = R.makeSampler(R.ROUTE_B)
const D_A = R.toPathD(R.ROUTE_A)
const D_B = R.toPathD(R.ROUTE_B)
const BRAND = '#5b65db'
const OK = '#1f9d55'
const glow = (a: number) => `rgba(91,101,219,${a})`

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * A cena da Rota Automática de Ofertas, desenhada num palco fixo de 360×640
 * e escalada para caber na tela do celular.
 */
/** `cropTopOnMobile`: abaixo de 640px a tela começa direto nos chats (corta os 30px de cima do palco). */
export function RouteScene({
  reduce,
  idPrefix,
  cropTopOnMobile = false,
}: {
  reduce: boolean
  idPrefix: string
  cropTopOnMobile?: boolean
}) {
  const screenRef = useRef<HTMLDivElement>(null)
  const scale = useFitScale(screenRef, R.STAGE_W)
  const inView = useInView(screenRef, { amount: 0.2 })
  const running = useRef(false)
  useEffect(() => {
    running.current = inView && !reduce
  }, [inView, reduce])

  const clock = useMotionValue(reduce ? R.STATIC_T : 0)
  useAnimationFrame((_, delta) => {
    if (!running.current) return
    let next = clock.get() + Math.min(delta, 64) / 1000
    if (next >= R.LOOP) next -= R.LOOP
    clock.set(next)
  })
  const v = useTimeline(clock, reduce)
  const clipId = `${idPrefix}-route-clip`

  return (
    <div
      ref={screenRef}
      className={`relative aspect-[360/640] w-full overflow-hidden bg-[#f1f3f8] ${cropTopOnMobile ? 'max-sm:aspect-[360/610]' : ''}`}
      role="img"
      aria-label="Animação: uma oferta aparece no Grupo de Ofertas, passa pela CopySync, o link do outro afiliado vira o seu link e a oferta é publicada no Seu Grupo."
    >
      <div
        aria-hidden="true"
        // 30 / 610 = 4,918% da altura cortada: o palco sobe exatamente a barra de status
        className={`absolute left-0 top-0 origin-top-left select-none ${cropTopOnMobile ? 'max-sm:top-[-4.918%]' : ''}`}
        style={{
          width: R.STAGE_W,
          height: R.STAGE_H,
          transform: `scale(${scale ?? 1})`,
          visibility: scale === null ? 'hidden' : 'visible',
        }}
      >
        <StatusBar />

        {/* Chat da esquerda: grupo de onde vêm as ofertas */}
        <Panel x={8}>
          <ChatHeader
            title="Grupo de Ofertas"
            subtitle="fonte · monitorado"
            icon={TagIcon}
            live={
              <span className="relative ml-auto flex size-2 shrink-0">
                <span className="absolute inset-0 rounded-full bg-brand/50 motion-safe:animate-ping" />
                <span className="relative size-2 rounded-full bg-brand" />
              </span>
            }
          />
        </Panel>
        {/* Chat da direita: o seu grupo */}
        <Panel x={184} accent>
          <ChatHeader title="Seu Grupo" subtitle="destino · com o seu link" icon={GroupIcon} accent />
        </Panel>

        <At x={16} y={96} className="opacity-45">
          <OldOffer title="2 Gaveteiros Organizador" />
        </At>
        <At x={16} y={156}>
          <OldOffer title="Notebook Asus Vivobook" off="R$ 2.299" />
        </At>
        <At x={16} y={216}>
          <TextBubble>Corre que acaba rápido!</TextBubble>
        </At>
        <At x={208} y={132} className="opacity-45">
          <OldOffer title="2 Gaveteiros Organizador" mine />
        </At>
        <At x={208} y={192}>
          <OldOffer title="Notebook Asus Vivobook" off="R$ 2.299" mine />
        </At>

        {/* Faixa da Rota */}
        <div
          className="absolute overflow-hidden rounded-[18px] border border-brand/20 bg-[linear-gradient(180deg,#f6f7ff,#ffffff)] shadow-[0_8px_24px_-12px_rgba(91,101,219,.35)]"
          style={{ left: 8, top: 400, width: 344, height: 216 }}
        >
          <div className="absolute inset-0 [background-image:linear-gradient(rgba(91,101,219,.07)_1px,transparent_1px),linear-gradient(90deg,rgba(91,101,219,.07)_1px,transparent_1px)] [background-size:16px_16px] [mask-image:radial-gradient(closest-side,black,transparent)]" />
          <span className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap text-[8.5px] font-bold uppercase tracking-[0.16em] text-brand">
            <span className="size-1.5 rounded-full bg-brand shadow-[0_0_6px_rgba(91,101,219,.8)]" />
            Rota Automática
          </span>
          <div className="absolute inset-x-3 bottom-3.5 flex items-center gap-1.5">
            <Step n={1} label="Monitora" level={v.step1} />
            <Step n={2} label="Troca o link" level={v.step2} />
            <Step n={3} label="Publica" level={v.step3} />
            {/* cronômetro no canto */}
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-white px-1.5 py-[4px] font-mono text-[9.5px] leading-none ring-1 ring-line">
              <svg viewBox="0 0 24 24" className="size-2.5 text-zinc-400" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                <circle cx="12" cy="13" r="8" />
                <path d="M12 9v4l2.5 2M9.5 2.5h5" strokeLinecap="round" />
              </svg>
              <motion.span style={{ color: v.timerColor }}>{v.timer}</motion.span>
            </span>
          </div>
        </div>

        {/* Linha de luz */}
        <svg viewBox={`0 0 ${R.STAGE_W} ${R.STAGE_H}`} className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
          <defs>
            <clipPath id={clipId}>
              <rect x="0" y={R.LINE_CLIP_Y} width={R.STAGE_W} height={R.STAGE_H} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clipId})`} fill="none" strokeLinecap="butt">
            <path d={D_A} stroke={BRAND} strokeOpacity="0.18" strokeWidth="2" />
            <path d={D_B} stroke={BRAND} strokeOpacity="0.18" strokeWidth="2" />
            <Trail d={D_A} dash={v.trailA} opacity={v.trailAOpacity} />
            <Trail d={D_B} dash={v.trailB} opacity={v.trailBOpacity} />
          </g>
        </svg>

        {/* Oferta que cai no grupo monitorado */}
        <motion.div
          className="absolute rounded-[14px] rounded-tl-[4px]"
          style={{
            left: R.SLOT.left.x,
            top: R.SLOT.left.y,
            opacity: v.offerOpacity,
            y: v.offerY,
            scale: v.offerScale,
            boxShadow: v.offerFlash,
          }}
        >
          <OfferBubble />
        </motion.div>
        <motion.div
          className="pointer-events-none absolute rounded-[17px] border-[1.5px] border-brand shadow-[0_0_18px_rgba(91,101,219,.45)]"
          style={{
            left: R.SLOT.left.x - 4,
            top: R.SLOT.left.y - 4,
            width: R.BUBBLE.w + 8,
            height: R.BUBBLE.h + 8,
            opacity: v.detect,
          }}
        />

        {/* Cópia viajando até o nó (link do outro afiliado) */}
        <motion.div
          className="absolute left-0 top-0 rounded-[14px] rounded-tl-[4px] shadow-[0_0_26px_rgba(91,101,219,.45),0_14px_30px_-10px_rgba(15,17,23,.35)] will-change-transform"
          style={{ x: v.aX, y: v.aY, scale: v.aScale, opacity: v.aOpacity }}
        >
          <OfferBubble />
        </motion.div>

        {/* Saindo do nó já com o seu link e pousando no Seu Grupo */}
        <motion.div
          className="absolute left-0 top-0 rounded-[14px] rounded-tr-[4px] will-change-transform"
          style={{ x: v.bX, y: v.bY, scale: v.bScale, opacity: v.bOpacity, boxShadow: v.bShadow }}
        >
          <OfferBubble mine checks={<Checks first={v.check1} second={v.check2} lit={v.check2} />} />
        </motion.div>

        {/* Nó CopySync */}
        <motion.div
          className="absolute"
          style={{
            left: R.NODE.x - R.NODE.r,
            top: R.NODE.y - R.NODE.r,
            width: R.NODE.r * 2,
            height: R.NODE.r * 2,
            scale: v.nodeScale,
          }}
        >
          <motion.div
            className="absolute -inset-9 rounded-full bg-[radial-gradient(closest-side,rgba(91,101,219,.38),transparent)]"
            style={{ opacity: v.nodeGlow }}
          />
          <div className="absolute inset-0 rounded-full bg-[conic-gradient(from_0deg,#5b65db,rgba(91,101,219,.08)_35%,#7042e3_60%,rgba(112,66,227,.08)_85%,#5b65db)] motion-safe:animate-[spin_4s_linear_infinite]" />
          <div className="absolute inset-[2px] flex flex-col items-center justify-center gap-[3px] rounded-full bg-white shadow-[inset_0_0_12px_rgba(91,101,219,.18)]">
            <BrandIcon size={24} className="rounded-[6px]" />
            <span className="text-[7px] font-bold leading-none tracking-wide text-ink">CopySync</span>
          </div>
        </motion.div>

        {/* Troca do link */}
        <motion.div
          className="absolute rounded-xl border border-brand/25 bg-white/95 px-3 py-2"
          style={{ left: 78, top: 520, width: 204, opacity: v.chipOpacity, y: v.chipY, boxShadow: v.chipShadow }}
        >
          <motion.p className="text-[8.5px] font-bold uppercase leading-none tracking-[0.12em] text-brand">
            {v.chipLabel}
          </motion.p>
          <p className="mt-1.5 whitespace-nowrap font-mono text-[13px] leading-[1.2]">
            <span className="text-zinc-500">…/afiliado=</span>
            <motion.span className="font-bold" style={{ color: v.codeColor, textShadow: v.codeShadow }}>
              {v.code}
            </motion.span>
          </p>
        </motion.div>

        {/* +1 oferta publicada */}
        <motion.div
          className="absolute flex items-center gap-1 rounded-full bg-save-bg px-2.5 py-1 text-[9.5px] font-bold text-save-ink ring-1 ring-ok/40 shadow-[0_6px_16px_-6px_rgba(31,157,85,.5)]"
          style={{ right: 16, top: 222, opacity: v.toastOpacity, y: v.toastY }}
        >
          +1 oferta publicada
        </motion.div>

        <div className="absolute bottom-[7px] left-1/2 h-1 w-28 -translate-x-1/2 rounded-full bg-ink/80" />
      </div>
    </div>
  )
}

function useTimeline(clock: MotionValue<number>, reduce: boolean) {
  const fade = (t: number) => 1 - R.prog(t, T.fadeOut, T.fadeOut + 0.4)
  const pA = (t: number) => R.easeInOut(R.prog(t, T.lift, T.atNode))
  const pB = (t: number) => R.easeInOut(R.prog(t, T.leaveNode, T.land))
  const { w, h } = R.BUBBLE

  return {
    // oferta original
    offerOpacity: useTransform(
      clock,
      (t) => R.easeOut(R.prog(t, T.offerIn, T.offerIn + 0.35)) * (1 - 0.45 * R.prog(t, T.lift, T.lift + 0.4)) * fade(t),
    ),
    offerY: useTransform(clock, (t) => R.lerp(16, 0, R.easeOut(R.prog(t, T.offerIn, T.offerIn + 0.45)))),
    offerScale: useTransform(clock, (t) => R.lerp(0.94, 1, R.easeOut(R.prog(t, T.offerIn, T.offerIn + 0.45)))),
    offerFlash: useTransform(clock, (t) => {
      const f = R.spike(t, T.offerIn + 0.1, T.offerIn + 0.9)
      return `0 0 0 ${3 * f}px ${glow(0.25 * f)}`
    }),
    detect: useTransform(clock, (t) => (reduce ? 0 : R.spike(t, T.detect, T.lift + 0.35))),

    // ida até o nó
    aX: useTransform(clock, (t) => sampleA(pA(t))[0] - w / 2),
    aY: useTransform(clock, (t) => sampleA(pA(t))[1] - h / 2),
    aScale: useTransform(clock, (t) => {
      const p = pA(t)
      return p < 0.1 ? R.lerp(1, 1.06, p / 0.1) : R.lerp(1.06, 0.26, (p - 0.1) / 0.9)
    }),
    aOpacity: useTransform(clock, (t) => (t < T.lift || t >= T.atNode ? 0 : 1)),
    trailA: useTransform(clock, (t) => `${t < T.lift ? 0 : pA(t)} 3`),
    trailAOpacity: useTransform(clock, (t) => (t < T.lift ? 0 : fade(t))),

    // nó + troca do link
    nodeGlow: useTransform(clock, (t) =>
      reduce ? 1 : 0.2 + 0.8 * R.prog(t, T.atNode - 0.25, T.atNode) * (1 - R.prog(t, T.leaveNode + 0.2, T.leaveNode + 0.8)),
    ),
    nodeScale: useTransform(
      clock,
      (t) => 1 + 0.12 * R.spike(t, T.atNode - 0.05, T.atNode + 0.45) + 0.08 * R.spike(t, T.leaveNode - 0.05, T.leaveNode + 0.4),
    ),
    chipOpacity: useTransform(clock, (t) =>
      reduce ? 1 : R.prog(t, T.atNode, T.atNode + 0.2) * (1 - R.prog(t, T.leaveNode - 0.1, T.leaveNode + 0.2)),
    ),
    chipY: useTransform(clock, (t) => (reduce ? 0 : R.lerp(-10, 0, R.easeOut(R.prog(t, T.atNode, T.atNode + 0.4))))),
    chipShadow: useTransform(clock, (t) => {
      const f = reduce ? 0.5 : R.spike(t, T.scrambleEnd - 0.05, T.scrambleEnd + 0.8)
      return `0 0 ${28 * f}px ${glow(0.45 * f)}, 0 12px 28px -12px rgba(15,17,23,.3)`
    }),
    chipLabel: useTransform(clock, (t): string => (t >= T.scrambleEnd ? 'link trocado ✓' : 'trocando o link…')),
    code: useTransform(clock, R.scrambleAt),
    codeColor: useTransform(clock, (t) => (t >= T.scrambleEnd ? BRAND : t >= T.scrambleStart ? '#8b96f0' : '#52525b')),
    codeShadow: useTransform(clock, (t) => (t >= T.scrambleEnd ? `0 0 12px ${glow(0.55)}` : 'none')),

    // volta ao Seu Grupo
    bX: useTransform(clock, (t) => sampleB(pB(t))[0] - w / 2),
    bY: useTransform(clock, (t) => sampleB(pB(t))[1] - h / 2),
    bScale: useTransform(clock, (t) => (t < T.land ? R.lerp(0.26, 1, pB(t)) : 1 + 0.035 * R.spike(t, T.land, T.land + 0.4))),
    bOpacity: useTransform(clock, (t) => (t < T.leaveNode ? 0 : fade(t))),
    bShadow: useTransform(clock, (t) => {
      const g = t < T.land ? 1 : 1 - R.prog(t, T.land, T.land + 0.9)
      return `0 0 ${26 * g}px ${glow(0.45 * g)}, 0 14px 30px -10px rgba(15,17,23,${0.12 + 0.2 * g})`
    }),
    trailB: useTransform(clock, (t) => `${t < T.leaveNode ? 0 : pB(t)} 3`),
    trailBOpacity: useTransform(clock, (t) => (t < T.leaveNode ? 0 : fade(t))),
    check1: useTransform(clock, (t) => R.prog(t, T.land + 0.05, T.land + 0.15)),
    check2: useTransform(clock, (t) => R.prog(t, T.land + 0.45, T.land + 0.55)),
    toastOpacity: useTransform(clock, (t) => R.prog(t, T.toast, T.toast + 0.25) * fade(t)),
    toastY: useTransform(clock, (t) => R.lerp(14, 0, R.easeOut(R.prog(t, T.toast, T.toast + 0.7)))),

    // cronômetro e etapas
    timer: useTransform(clock, (t) => R.formatTimer(R.prog(t, T.offerIn, T.land) * HERO_TIMER_SECONDS)),
    timerColor: useTransform(clock, (t) => (t >= T.land ? OK : t > T.offerIn ? '#0f1117' : '#a1a1aa')),
    step1: useTransform(clock, (t) => R.prog(t, T.detect, T.detect + 0.25) * fade(t)),
    step2: useTransform(clock, (t) => R.prog(t, T.atNode, T.atNode + 0.25) * fade(t)),
    step3: useTransform(clock, (t) => R.prog(t, T.land, T.land + 0.25) * fade(t)),
  }
}

function Trail({ d, dash, opacity }: { d: string; dash: MotionValue<string>; opacity: MotionValue<number> }) {
  return (
    <motion.g style={{ opacity }}>
      <motion.path d={d} pathLength={1} stroke={BRAND} strokeOpacity="0.22" strokeWidth="8" style={{ strokeDasharray: dash }} />
      <motion.path d={d} pathLength={1} stroke={BRAND} strokeWidth="2.2" style={{ strokeDasharray: dash }} />
    </motion.g>
  )
}

function Step({ n, label, level }: { n: number; label: string; level: MotionValue<number> }) {
  const content = (
    <>
      <span className="font-mono opacity-70">{n}</span> {label}
    </>
  )
  return (
    <div className="relative flex-1 overflow-hidden whitespace-nowrap rounded-full border border-line bg-white py-[5px] text-center text-[8.5px] font-semibold text-zinc-400">
      {content}
      <motion.div
        className="absolute inset-0 grid place-items-center rounded-full bg-brand-soft text-brand ring-1 ring-inset ring-brand/50"
        style={{ opacity: level }}
      >
        <span>{content}</span>
      </motion.div>
    </div>
  )
}

function Panel({ x, accent = false, children }: { x: number; accent?: boolean; children: ReactNode }) {
  return (
    <div
      className={`absolute overflow-hidden rounded-[18px] border bg-white ${accent ? 'border-brand/25' : 'border-line'}`}
      style={{ left: x, top: 34, width: 168, height: 358 }}
    >
      {children}
      <div className="absolute inset-x-0 bottom-0 top-11 bg-[#fafbfd] [background-image:radial-gradient(rgba(15,17,23,.06)_1px,transparent_1px)] [background-size:12px_12px]" />
    </div>
  )
}

function At({ x, y, className = '', children }: { x: number; y: number; className?: string; children: ReactNode }) {
  return (
    <div className={`absolute ${className}`} style={{ left: x, top: y }}>
      {children}
    </div>
  )
}

/** Escala o palco fixo para a largura real da tela (antes do primeiro paint no navegador). */
function useFitScale(ref: RefObject<HTMLElement | null>, base: number) {
  const [scale, setScale] = useState<number | null>(null)
  useIsoLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setScale(el.clientWidth / base)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, base])
  return scale
}
