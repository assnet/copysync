import { useEffect, useRef, type ReactNode } from 'react'
import sapatilha from '../../assets/media/sapatilha-thumb.jpg'
import { BrandIcon } from '../../components/BrandMark'
import { GroupIcon } from './ChatParts'

/**
 * Visual principal do hero: a oferta chega no grupo de outro afiliado com "afiliado=OUTRO",
 * a CopySync troca por "afiliado=VOCÊ" e a oferta cai no "Seu grupo".
 *
 * Leve de propósito: a animação é só CSS (keyframes em index.css, prefixo "swap-"), roda sozinha
 * desde o primeiro quadro e só mexe em transform/opacity. O JS daqui só cuida do parallax
 * (rolagem, mouse no desktop e inclinação do celular quando o navegador libera) e pausa a animação
 * fora da tela. Sem animação ("reduzir movimento"), aparece o estado final, parado.
 * Camadas: grupo de origem ao fundo (desfocado), selo CopySync, o cartão que viaja e o "Seu grupo" na frente.
 */
export function SwapStage({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // pausa os keyframes quando o palco sai da tela
    const io = new IntersectionObserver(([e]) => el.toggleAttribute('data-paused', !e.isIntersecting))
    io.observe(el)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => io.disconnect()

    let mx = 0
    let my = 0
    let frame = 0
    const paint = () => {
      frame = 0
      const r = el.getBoundingClientRect()
      // 0 com o palco no lugar; cresce conforme ele sobe na rolagem
      const sy = Math.max(-1, Math.min(1.5, -r.top / Math.max(1, r.height)))
      el.style.setProperty('--mx', mx.toFixed(3))
      el.style.setProperty('--my', my.toFixed(3))
      el.style.setProperty('--sy', sy.toFixed(3))
    }
    const queue = () => {
      if (!frame) frame = requestAnimationFrame(paint)
    }
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      mx = (e.clientX / window.innerWidth) * 2 - 1
      my = (e.clientY / window.innerHeight) * 2 - 1
      queue()
    }
    // inclinação do celular (Android libera sem pedir; no iPhone fica só o parallax da rolagem)
    let beta0: number | null = null
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return
      beta0 ??= e.beta
      mx = Math.max(-1, Math.min(1, e.gamma / 20))
      my = Math.max(-1, Math.min(1, (e.beta - beta0) / 20))
      queue()
    }
    addEventListener('scroll', queue, { passive: true })
    addEventListener('pointermove', onPointer, { passive: true })
    addEventListener('deviceorientation', onTilt, { passive: true })
    return () => {
      io.disconnect()
      cancelAnimationFrame(frame)
      removeEventListener('scroll', queue)
      removeEventListener('pointermove', onPointer)
      removeEventListener('deviceorientation', onTilt)
    }
  }, [])

  return (
    <div
      ref={ref}
      role="img"
      aria-label="Ilustração: uma oferta chega no grupo de outro afiliado com o link dele, a CopySync troca pelo seu link de afiliado e publica no seu grupo."
      className={`swap-stage relative mx-auto w-full select-none ${className}`}
    >
      {/* fundo: brilhos da marca (gradientes, sem filtro) */}
      <div aria-hidden="true" className="pointer-events-none absolute -inset-x-10 -inset-y-6 -z-10">
        <div className="absolute right-0 top-[8%] size-[75%] rounded-full bg-[radial-gradient(closest-side,rgba(112,66,227,.16),transparent)]" />
        <div className="absolute bottom-0 left-[-5%] size-[70%] rounded-full bg-[radial-gradient(closest-side,rgba(91,101,219,.16),transparent)]" />
      </div>

      <p aria-hidden="true" className="absolute bottom-0 left-0 w-[30cqw] text-[10px] leading-[1.2] text-muted/80">Ilustração do funcionamento.</p>

      <div aria-hidden="true" className="swap-tilt absolute inset-0">
        {/* camada 4 (mais ao fundo): uma oferta antiga, bem desfocada */}
        <div className="swap-layer [--k:.25]" style={{ zIndex: 0 }}>
          <div className="absolute right-[2%] top-[34%] w-[42cqw] max-w-[170px] rotate-[6deg] opacity-60 blur-[3px]">
            <OfferRow who="OUTRO" ghost />
          </div>
        </div>

        {/* camada 3: grupo de origem (de outro afiliado), levemente desfocado */}
        <div className="swap-layer [--k:.45]" style={{ zIndex: 1 }}>
          <Panel className="left-0 top-0 w-[62cqw] origin-top-left scale-[.96] opacity-[.93] blur-[.7px]">
            <PanelHeader icon={GroupIcon} title="Grupo de ofertas" subtitle="de outro afiliado" />
            <div className="p-2">
              <OfferRow who="OUTRO" />
            </div>
          </Panel>
        </div>

        {/* rota tracejada: origem → CopySync → seu grupo */}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="swap-layer pointer-events-none absolute inset-0 size-full overflow-visible [--k:.6]"
          style={{ zIndex: 1 }}
        >
          <path
            d="M 30 44 C 40 62, 70 30, 80 52"
            fill="none"
            stroke="rgba(91,101,219,.45)"
            strokeWidth="1.6"
            strokeDasharray="1 5"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* camada 2: selo da CopySync, onde o link é trocado */}
        <div className="swap-layer [--k:.65]" style={{ zIndex: 3 }}>
          <div className="absolute right-0 top-[6%] flex items-center gap-2 rounded-2xl bg-white/90 py-1.5 pl-1.5 pr-3 shadow-[0_2px_6px_rgba(15,17,23,.06),0_14px_30px_-12px_rgba(41,48,110,.45)] ring-1 ring-black/5 backdrop-blur">
            <span className="swap-chip-glow pointer-events-none absolute -inset-1 rounded-[20px] ring-2 ring-brand/60 shadow-[0_0_24px_rgba(91,101,219,.55)]" />
            <BrandIcon size={26} className="rounded-[7px]" />
            <span className="leading-none">
              <span className="block font-display text-[12px] font-extrabold text-ink">CopySync</span>
              <span className="mt-[3px] block text-[9.5px] font-semibold text-brand">troca o link pelo seu</span>
            </span>
          </div>
        </div>

        {/* camada 1 (frente): seu grupo */}
        <div className="swap-layer [--k:1]" style={{ zIndex: 2 }}>
          <Panel className="bottom-0 right-0 w-[66cqw] shadow-[0_2px_6px_rgba(15,17,23,.06),0_30px_60px_-22px_rgba(41,48,110,.55)] ring-brand/25">
            <PanelHeader icon={GroupIcon} title="Seu grupo" subtitle="com o seu link" accent />
            <div className="h-[calc(var(--card-h)+16px)]" />
          </Panel>
        </div>

        {/* o cartão que viaja: base = estado final (dentro do "Seu grupo") */}
        <div className="swap-layer [--k:.85]" style={{ zIndex: 4 }}>
          <div className="swap-card absolute bottom-2 right-2 w-[calc(66cqw-16px)]">
            <OfferRow who="swap" />
            <span className="swap-sent absolute -right-1 -top-3 inline-flex items-center gap-1 rounded-full bg-save-bg px-2 py-[3px] text-[10px] font-bold text-save-ink shadow-sm ring-1 ring-ok/25">
              <DoubleCheck /> Enviada
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function Panel({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={`absolute overflow-hidden rounded-[20px] bg-white/95 shadow-[0_2px_6px_rgba(15,17,23,.05),0_20px_44px_-18px_rgba(41,48,110,.4)] ring-1 ring-black/5 ${className}`}
    >
      {children}
    </div>
  )
}

function PanelHeader({ icon, title, subtitle, accent = false }: { icon: ReactNode; title: string; subtitle: string; accent?: boolean }) {
  return (
    <div className={`flex h-10 items-center gap-2 border-b px-2.5 ${accent ? 'border-brand/15 bg-brand-soft/60' : 'border-line'}`}>
      <span
        className={`grid size-6 shrink-0 place-items-center rounded-full ${accent ? 'bg-[linear-gradient(135deg,var(--color-brand-from),var(--color-brand-to))] text-white' : 'bg-zinc-100 text-zinc-500'}`}
      >
        {icon}
      </span>
      <span className="min-w-0 leading-none">
        <span className="block truncate text-[12px] font-bold text-ink">{title}</span>
        <span className={`mt-[3px] block truncate text-[9.5px] font-semibold ${accent ? 'text-brand' : 'text-zinc-500'}`}>{subtitle}</span>
      </span>
    </div>
  )
}

/** Oferta (sapatilha do print real). who="swap": o link troca de OUTRO para VOCÊ na animação. */
function OfferRow({ who, ghost = false }: { who: 'OUTRO' | 'VOCÊ' | 'swap'; ghost?: boolean }) {
  const swap = who === 'swap'
  return (
    <div
      className={`relative h-[var(--card-h)] overflow-hidden rounded-2xl bg-white p-2 ring-1 ${swap ? 'swap-card-face shadow-[0_2px_6px_rgba(15,17,23,.08),0_18px_36px_-14px_rgba(41,48,110,.55)] ring-black/5' : 'ring-line shadow-[0_1px_2px_rgba(15,17,23,.05)]'}`}
    >
      {swap && <span className="swap-ring pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-inset ring-brand/70" />}
      <div className="flex gap-2">
        <img
          src={sapatilha}
          alt=""
          width={44}
          height={44}
          decoding="async"
          className="size-11 shrink-0 rounded-[10px] bg-white object-contain ring-1 ring-line"
        />
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold leading-[1.2] text-ink">{ghost ? 'Fone Bluetooth' : 'Sapatilha Aquática Preta'}</p>
          <p className="mt-1 flex items-baseline gap-1.5 whitespace-nowrap">
            <b className="font-display text-[14px] font-bold leading-none text-ink">R$ 37,73</b>
            <span className="rounded-[4px] bg-ink px-1 py-[1px] text-[8.5px] font-extrabold text-white">37% OFF</span>
          </p>
        </div>
      </div>
      <p className="mt-1.5 flex items-center whitespace-nowrap font-mono text-[11px] leading-[1.5]">
        <span className="text-zinc-500">…/afiliado=</span>
        {swap ? (
          <span className="relative inline-grid overflow-hidden rounded-[4px] font-bold">
            <span className="swap-out col-start-1 row-start-1 justify-self-start rounded-[4px] bg-zinc-100 px-1 text-zinc-600">OUTRO</span>
            <span className="swap-in col-start-1 row-start-1 justify-self-start rounded-[4px] bg-brand/12 px-1 text-brand">VOCÊ</span>
          </span>
        ) : (
          <span className={`rounded-[4px] px-1 font-bold ${who === 'VOCÊ' ? 'bg-brand/12 text-brand' : 'bg-zinc-100 text-zinc-600'}`}>{who}</span>
        )}
      </p>
      {swap && <span className="swap-shine pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-[linear-gradient(100deg,transparent,rgba(139,150,240,.35),transparent)]" />}
    </div>
  )
}

function DoubleCheck() {
  return (
    <svg viewBox="0 0 16 10" className="h-[9px] w-[15px]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 5.5 3.8 8.3 9.5 1.7" />
      <path d="M6.5 7.6l.7.7 5.7-6.6" />
    </svg>
  )
}
