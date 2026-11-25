// HERO ANTERIOR (até 21/11/2026), guardado para poder voltar.
// Para voltar: em src/App.tsx troque `import { Hero } from './sections/Hero'` por
// `import { HeroLegacy as Hero } from './sections/HeroLegacy'`. Não é importado em nenhum lugar, então não pesa no site.

import type { Ref } from 'react'
import { BrandMark } from '../components/BrandMark'
import { MarketLogo, type Marketplace } from '../components/Marketplaces'

import { CtaButton, PriceLine } from '../components/ui'
import { ANCHOR, HEADLINE_TIME_WORD } from '../config'
import { scrollToVideo } from '../lib/scrollToVideo'
import { FloatingOffers } from './hero/FloatingOffers'
import { HeroPhone } from './hero/HeroPhone'

const HERO_MARKETS: Marketplace[] = ['shopee', 'mercado-livre', 'amazon', 'shein']

/** Bloco 1 · HERO — versão anterior ("A cena", com o celular) */
export function HeroLegacy({ ref }: { ref?: Ref<HTMLElement> }) {
  return (
    <section ref={ref} id="topo" aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      <Backdrop />

      <div className="mx-auto max-w-6xl px-4 pb-8 pt-4 max-sm:pt-2.5 sm:px-6 lg:max-w-7xl lg:px-8 lg:pb-10 lg:pt-5">
        <header className="-ml-2">
          <BrandMark className="max-sm:h-10 max-sm:w-[120px]" />
        </header>

        <div className="hero-grid mt-4 max-sm:mt-1.5 lg:mt-2">
          {/* Linha de identificação */}
          <div className="[grid-area:id]">
            {/* celular: "PARA AFILIADOS" e, abaixo, as 4 logos numa linha; desktop: tudo na mesma linha */}
            <div className="flex flex-col items-start gap-2.5 max-sm:gap-2 lg:flex-row lg:items-center lg:gap-4">
              <p className="font-display text-[0.8rem] font-bold uppercase leading-none tracking-[0.14em] text-ink/70 sm:text-sm">
                Para <span className="hl font-black tracking-[0.12em]">afiliados</span>
              </p>
              <ul aria-label="Funciona com Shopee, Mercado Livre, Amazon e Shein (Shein no plano MAX)" className="flex items-center gap-2.5 pb-1 lg:pb-0">
                {HERO_MARKETS.map((m) => (
                  <li key={m}>
                    <MarketLogo id={m} size={42} lgSize={40} planBadge={m === 'shein' ? 'MAX' : undefined} />
                  </li>
                ))}
              </ul>
            </div>
            <p className="mt-2.5 font-display text-[0.8rem] font-bold uppercase leading-none tracking-[0.14em] text-ink/70 max-sm:mt-1.5 sm:text-sm">
              com grupos de achadinhos
            </p>
          </div>

          <div className="[grid-area:title]">
            <h1
              id="hero-title"
              className="font-display text-[2.1rem] font-extrabold leading-[1.06] tracking-[-0.03em] text-ink text-balance sm:text-5xl lg:text-[clamp(2.3rem,3.05vw,2.8rem)]"
            >
              A Oferta Cai no Grupo dos Outros. {HEADLINE_TIME_WORD} Depois, Está
              no Seu — <span className="hl">Com o Seu Link.</span>
            </h1>
          </div>

          <div className="[grid-area:copy]">
            {/* celular: versão curta (cabe em 2–3 linhas); a partir de 640px: texto completo */}
            <p className="max-w-xl text-base leading-snug text-muted sm:hidden">
              Pare de copiar achadinho de grupo em grupo. A CopySync troca o link pelo seu e publica nos seus grupos.
            </p>
            <p className="max-w-xl text-[1.0625rem] leading-relaxed text-muted max-sm:hidden lg:text-lg">
              Pare de copiar achadinho de grupo em grupo. A{' '}
              <strong className="font-semibold text-ink">Rota Automática de Ofertas</strong> da CopySync monitora os
              grupos que você escolhe, troca o link pelo seu link de afiliado e publica nos seus grupos. Sem copiar, sem
              colar.
            </p>

            <div className="mt-7 flex flex-col items-stretch gap-3 max-sm:mt-4 max-sm:gap-2 sm:items-start">
              <CtaButton
                href={ANCHOR.video}
                block="hero"
                cta="ver_funcionando"
                destino="video"
                icon="down"
                onClick={(e) => {
                  if (scrollToVideo()) e.preventDefault()
                }}
              >
                Ver a CopySync funcionando
              </CtaButton>
              <PriceLine block="hero" className="sm:justify-start" />
            </div>
          </div>

          <div className="mt-6 [grid-area:visual] max-sm:mt-0 lg:mt-0">
            <div className="relative mx-auto max-w-[340px] max-sm:max-w-[290px] lg:max-w-[318px]">
              <FloatingOffers />
              <HeroPhone className="z-10" cropTopOnMobile />
            </div>
            <p className="mt-1 text-center text-xs text-muted/80">Ilustração do funcionamento.</p>
          </div>
        </div>
      </div>
    </section>
  )
}

function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(180deg,#ffffff_0%,#f5f7fa_55%,#ffffff_100%)]">
      <div className="absolute -right-40 -top-40 h-[40rem] w-[40rem] rounded-full bg-[radial-gradient(closest-side,rgba(91,101,219,.14),transparent)]" />
      <div className="absolute -left-40 top-1/3 h-[30rem] w-[30rem] rounded-full bg-[radial-gradient(closest-side,rgba(112,66,227,.07),transparent)]" />
      <div className="absolute inset-0 [background-image:linear-gradient(rgba(15,17,23,.035)_1px,transparent_1px),linear-gradient(90deg,rgba(15,17,23,.035)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_60%_55%_at_70%_35%,black,transparent)]" />
    </div>
  )
}
