import type { Ref } from 'react'
import { BrandMark } from '../components/BrandMark'
import { MarketLogo, type Marketplace } from '../components/Marketplaces'
import { CtaButton, ShieldIcon } from '../components/ui'
import { ANCHOR } from '../config'
import { track } from '../lib/track'
import { SwapStage } from './hero/SwapStage'

// A versão anterior deste bloco está em ./HeroLegacy.tsx (instruções de como voltar no topo do arquivo).

const HERO_MARKETS: Marketplace[] = ['shopee', 'mercado-livre', 'amazon', 'shein']

/**
 * Bloco 1 · HERO — continua a mensagem dos anúncios: "sua venda cai no link de outro afiliado".
 * No celular (390×844, inclusive no navegador do app do YouTube) cabem sem rolar:
 * selo + lojas, título, subtítulo, a animação da troca do link, o botão e a linha do preço.
 */
export function Hero({ ref }: { ref?: Ref<HTMLElement> }) {
  // Altura: no celular, a natural (sem vão). A partir de 640px, no mínimo a tela inteira (100svh), porque o bloco
  // seguinte ("A Corrida do Link") escurece a página quando entra na tela e, com o hero mais baixo que a tela,
  // isso já começaria na abertura (no desktop a página abria arroxeada).
  return (
    <section ref={ref} id="topo" aria-labelledby="hero-title" className="relative isolate flex flex-col overflow-hidden sm:min-h-[100svh]">
      <Backdrop />

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-5 pt-2 sm:px-6 sm:pb-10 sm:pt-4 lg:max-w-7xl lg:px-8 lg:pb-14 lg:pt-5">
        <header className="-ml-2">
          <BrandMark className="max-sm:h-9 max-sm:w-[108px]" />
        </header>

        <div className="hero2-grid mt-1.5 flex-1 sm:mt-4 lg:mt-2">
          {/* selo + lojas */}
          <div className="flex items-center justify-between gap-3 [grid-area:id] sm:justify-start sm:gap-4">
            <p className="font-display text-[0.72rem] font-bold uppercase leading-[1.25] tracking-[0.09em] text-ink/70 sm:text-sm sm:tracking-[0.14em]">
              Para <span className="hl font-black">afiliados</span>
              <br className="sm:hidden" /> com grupos de achadinhos
            </p>
            <ul aria-label="Funciona com Shopee, Mercado Livre, Amazon e Shein (Shein no plano MAX)" className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
              {HERO_MARKETS.map((m) => (
                <li key={m}>
                  <MarketLogo id={m} size={30} lgSize={38} planBadge={m === 'shein' ? 'MAX' : undefined} />
                </li>
              ))}
            </ul>
          </div>

          <h1
            id="hero-title"
            className="font-display text-[min(7vw,2.2rem)] font-extrabold leading-[1.06] tracking-[-0.035em] text-ink text-balance [grid-area:title] sm:text-5xl lg:text-[clamp(2.8rem,4vw,3.6rem)]"
          >
            Sua venda está caindo no <span className="hl">link de outro afiliado.</span>
          </h1>

          <p className="max-w-xl text-[1.02rem] font-semibold leading-snug text-ink/80 [grid-area:copy] sm:text-xl lg:text-[1.35rem]">
            A CopySync monitora grupos de ofertas e posta no seu com o <span className="font-extrabold text-brand">SEU link</span>.{' '}
            <strong className="font-extrabold text-ink">Sozinha.</strong>
          </p>

          <div className="relative [grid-area:visual] max-sm:-mx-1 lg:self-center">
            <SwapStage />
          </div>

          <div className="flex flex-col items-stretch gap-1.5 [grid-area:cta] sm:items-start sm:gap-2.5">
            <CtaButton href={ANCHOR.planos} block="hero" cta="quero_automatico" destino="planos" className="max-sm:min-h-[3.25rem]">
              Quero meu grupo no automático
            </CtaButton>
            <a
              href={ANCHOR.planos}
              onClick={() => track('cta_click', { block: 'hero', cta: 'planos_texto' })}
              className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap text-[0.78rem] text-muted max-[359px]:whitespace-normal underline-offset-4 transition hover:text-ink hover:underline sm:justify-start sm:text-sm"
            >
              <ShieldIcon className="size-4 shrink-0 text-brand max-[400px]:hidden" />
              <span>
                Planos a partir de <strong className="font-semibold text-ink">R$&nbsp;77/mês</strong> no anual · 7 dias de garantia
              </span>
            </a>
            <a
              href={ANCHOR.demo}
              onClick={() => track('cta_click', { block: 'hero', cta: 'ver_como_funciona', destino: 'demonstracao' })}
              className="self-center py-1 text-[0.85rem] font-semibold text-brand underline-offset-4 hover:underline sm:self-start"
            >
              Ver como funciona ↓
            </a>
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
