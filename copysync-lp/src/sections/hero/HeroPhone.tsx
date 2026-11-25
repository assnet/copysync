import { motion, useScroll, useTransform } from 'motion/react'
import { useRef } from 'react'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { useReducedMotionSafe } from '../../lib/useReducedMotion'
import { RouteScene } from './RouteScene'

/** Celular com moldura realista, inclinação 3D leve, parallax no scroll e sombras em camadas. */
export function HeroPhone({
  className = '',
  id = 'hero',
  cropTopOnMobile = false,
}: {
  className?: string
  id?: string
  cropTopOnMobile?: boolean
}) {
  const reduce = useReducedMotionSafe()
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const isPhone = useMediaQuery('(max-width: 639px)')
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })

  const baseY = isDesktop ? -12 : -3
  const rotateY = useTransform(scrollYProgress, [0, 1], reduce ? [baseY, baseY] : [baseY - 3, baseY + 5])
  const rotateX = useTransform(scrollYProgress, [0, 1], reduce ? [4, 4] : [8, -2])
  // no celular sem deslocamento para baixo no início (o aparelho já começa no lugar, mais visível)
  const y = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : isPhone && cropTopOnMobile ? [0, -24] : [22, -22])
  const glowY = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [-26, 34])

  return (
    <div ref={ref} className={`relative mx-auto w-full [perspective:1600px] ${className}`}>
      {/* brilho atrás do aparelho (camada mais lenta = profundidade) */}
      <motion.div
        aria-hidden="true"
        style={{ y: glowY }}
        className="pointer-events-none absolute -inset-x-14 -inset-y-8 -z-10 rounded-full bg-[radial-gradient(closest-side,rgba(91,101,219,.22),rgba(112,66,227,.08)_55%,transparent)] blur-2xl"
      />
      <motion.div style={{ rotateX, rotateY, y }} className="relative [transform-style:preserve-3d]">
        <div className="relative rounded-[3rem] bg-[linear-gradient(145deg,#5d6068,#2a2c31_30%,#16171a_70%,#3a3c42)] p-[9px] shadow-[inset_0_0_0_1px_rgba(255,255,255,.12),0_2px_4px_rgba(15,17,23,.08),0_24px_48px_-16px_rgba(15,17,23,.35),0_60px_100px_-40px_rgba(41,48,110,.45)]">
          <span className="absolute -left-[3px] top-28 h-12 w-[3px] rounded-l bg-[#3a3c42]" />
          <span className="absolute -left-[3px] top-44 h-12 w-[3px] rounded-l bg-[#3a3c42]" />
          <span className="absolute -right-[3px] top-36 h-20 w-[3px] rounded-r bg-[#3a3c42]" />
          <div className="relative overflow-hidden rounded-[2.45rem] bg-black p-[2px]">
            <div className="overflow-hidden rounded-[2.35rem]">
              <RouteScene key={reduce ? 'static' : 'live'} reduce={reduce} idPrefix={id} cropTopOnMobile={cropTopOnMobile} />
            </div>
            <div className="pointer-events-none absolute inset-0 rounded-[2.45rem] bg-[linear-gradient(120deg,rgba(255,255,255,.22),transparent_28%)]" />
          </div>
        </div>
      </motion.div>
      {/* sombra no "chão" */}
      <div aria-hidden="true" className="pointer-events-none mx-auto mt-5 h-5 w-2/3 rounded-[50%] bg-[#29306e]/25 blur-xl" />
    </div>
  )
}
