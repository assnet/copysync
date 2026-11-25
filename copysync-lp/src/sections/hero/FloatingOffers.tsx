import { motion, useMotionValue, useScroll, useSpring, useTransform, type MotionValue } from 'motion/react'
import { useEffect, useRef, type ReactNode } from 'react'
import notebook from '../../assets/media/notebook-thumb.jpg'
import sapatilha from '../../assets/media/sapatilha-thumb.jpg'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { useReducedMotionSafe } from '../../lib/useReducedMotion'
import { ProductThumb } from './ChatParts'

/**
 * Cartões de ofertas flutuando ATRÁS do celular do hero, em camadas:
 * o da frente nítido, os de trás menores e desfocados. Parallax leve na rolagem
 * (e no mouse, no desktop). Só CSS 3D. Com "reduzir movimento", tudo parado.
 * Decorativos (aria-hidden): o conteúdo real está nos prints da seção "Direto do Nosso Grupo".
 */
export function FloatingOffers() {
  const reduce = useReducedMotionSafe()
  const desktop = useMediaQuery('(min-width: 1024px) and (pointer: fine)')
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })

  // mouse (só desktop): -1…1, suavizado
  const mx = useMotionValue(0)
  const my = useMotionValue(0)
  const sx = useSpring(mx, { stiffness: 60, damping: 18 })
  const sy = useSpring(my, { stiffness: 60, damping: 18 })
  useEffect(() => {
    if (reduce || !desktop) {
      mx.set(0)
      my.set(0)
      return
    }
    const onMove = (e: PointerEvent) => {
      mx.set((e.clientX / window.innerWidth) * 2 - 1)
      my.set((e.clientY / window.innerHeight) * 2 - 1)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [reduce, desktop, mx, my])

  return (
    <div ref={ref} aria-hidden="true" className="pointer-events-none absolute inset-0 select-none [perspective:1200px]">
      {/* camada de trás: fone (ilustração), menor e desfocado */}
      <Layer depth={3} p={scrollYProgress} sx={sx} sy={sy} reduce={reduce} className="right-[-14%] top-[61%] lg:right-[-38%] lg:top-[60%]">
        <OfferCard
          className="w-[150px] rotate-[5deg] scale-[.82] opacity-70 blur-[2.5px] lg:blur-[2px]"
          thumb={<ProductThumb className="size-full" />}
          title="Fone Bluetooth"
          price={<span className="text-[10px] font-semibold text-zinc-500">Achado do dia</span>}
        />
      </Layer>
      {/* camada do meio: notebook do print */}
      <Layer depth={2} p={scrollYProgress} sx={sx} sy={sy} reduce={reduce} className="right-[-17%] top-[17%] lg:right-[-44%] lg:top-[13%]">
        <OfferCard
          className="w-[170px] rotate-[4deg] scale-[.9] opacity-90 blur-[1px]"
          thumb={<img src={notebook} alt="" width={240} height={163} decoding="async" className="size-full object-contain" />}
          title="Notebook Asus Vivobook Go"
          price={
            <span className="flex items-baseline gap-1">
              <b className="font-display text-[13px] text-ink">R$ 2.299</b>
              <span className="text-[9.5px] text-zinc-500">no Pix</span>
            </span>
          }
        />
      </Layer>
      {/* camada da frente: sapatilha do print, nítida */}
      <Layer depth={1} p={scrollYProgress} sx={sx} sy={sy} reduce={reduce} className="left-[-17%] top-[40%] lg:left-[-30%] lg:top-[38%] xl:left-[-54%]">
        <OfferCard
          className="w-[184px] -rotate-[5deg]"
          thumb={<img src={sapatilha} alt="" width={240} height={156} decoding="async" className="size-full object-contain" />}
          title="Sapatilha Aquática Preta"
          price={
            <span className="flex flex-wrap items-baseline gap-x-1">
              <s className="text-[9.5px] text-zinc-400">R$ 60,00</s>
              <b className="font-display text-[13px] text-ink">R$ 37,73</b>
              <span className="rounded-[4px] bg-ink px-1 text-[8.5px] font-extrabold text-white">37% OFF</span>
            </span>
          }
        />
      </Layer>
    </div>
  )
}

/** Uma camada: quanto mais ao fundo (depth maior), menos se move. */
function Layer({
  depth,
  p,
  sx,
  sy,
  reduce,
  className,
  children,
}: {
  depth: 1 | 2 | 3
  p: MotionValue<number>
  sx: MotionValue<number>
  sy: MotionValue<number>
  reduce: boolean
  className: string
  children: ReactNode
}) {
  const k = { 1: 1, 2: 0.6, 3: 0.35 }[depth]
  const scrollY = useTransform(p, [0, 1], reduce ? [0, 0] : [46 * k, -46 * k])
  const mouseX = useTransform(sx, (v) => (reduce ? 0 : v * 16 * k))
  const mouseY = useTransform(sy, (v) => (reduce ? 0 : v * 10 * k))
  const y = useTransform([scrollY, mouseY], ([a, b]) => (a as number) + (b as number))
  const rotateY = useTransform(sx, (v) => (reduce ? 0 : v * 6 * k))
  return (
    <motion.div data-floating="" style={{ x: mouseX, y, rotateY }} className={`absolute ${className}`}>
      {children}
    </motion.div>
  )
}

function OfferCard({ thumb, title, price, className = '' }: { thumb: ReactNode; title: string; price: ReactNode; className?: string }) {
  return (
    <div
      className={`flex items-center gap-2.5 rounded-2xl bg-white/95 p-2.5 ring-1 ring-black/5 shadow-[0_2px_6px_rgba(15,17,23,.06),0_18px_40px_-14px_rgba(41,48,110,.35)] ${className}`}
    >
      <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-white ring-1 ring-line">{thumb}</span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold leading-[1.2] text-ink">{title}</span>
        <span className="mt-1 block">{price}</span>
      </span>
    </div>
  )
}
