import { BrandMark } from '../components/BrandMark'
import { CtaButton, PriceLine } from '../components/ui'
import { ANCHOR, FOOTER, SUPPORT } from '../config'
import { HeroPhone } from './hero/HeroPhone'
import { PriceLock, Urgency } from './plans/Plans'

/** Bloco 6 · FECHAMENTO + rodapé */
export function Closing() {
  return (
    <>
      <section
        id="fechamento"
        aria-labelledby="fechamento-title"
        className="relative isolate overflow-hidden bg-[linear-gradient(180deg,#ffffff,#eef0fb)] px-4 py-20 sm:px-6 sm:py-24 lg:px-8"
      >
        <div aria-hidden="true" className="absolute -right-32 top-10 -z-10 h-[30rem] w-[30rem] rounded-full bg-[radial-gradient(closest-side,rgba(112,66,227,.12),transparent)]" />
        <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="text-center lg:text-left">
            <h2
              id="fechamento-title"
              className="font-display text-[2.2rem] font-extrabold leading-[1.05] tracking-[-0.03em] text-ink text-balance sm:text-[3.2rem]"
            >
              Pare de Copiar Achadinho de Grupo em Grupo.
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-muted lg:mx-0">
              A oferta aparece no grupo que você monitora. A CopySync publica nos seus, já com o seu link de afiliado.
            </p>
            <div className="mt-8 flex flex-col items-stretch gap-3 sm:items-center lg:items-start">
              <Urgency className="mx-auto mb-1 max-w-md text-center lg:mx-0 lg:max-w-lg lg:text-left" />
              <CtaButton href={ANCHOR.planos} block="fechamento" cta="quero_automatizar">
                Quero automatizar meus grupos
              </CtaButton>
              <PriceLock className="mx-auto max-w-md text-center text-[0.8rem] lg:mx-0 lg:text-left" />
              <PriceLine block="fechamento" />
            </div>
          </div>
          <HeroPhone id="fechamento" className="max-w-[260px] sm:max-w-[280px]" />
        </div>
      </section>

      <footer className="border-t border-line bg-white px-4 pb-28 pt-10 text-sm text-muted sm:px-6 lg:px-8 lg:pb-12">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-xl">
            <BrandMark className="-ml-2" />
            <p className="mt-3 leading-relaxed">
              A CopySync é uma ferramenta independente, sem vínculo ou endosso do WhatsApp, Telegram, Shopee, Mercado
              Livre, Amazon ou Shein. As marcas citadas pertencem aos seus donos e aparecem só para indicar
              compatibilidade.
            </p>
          </div>
          {/* data-clarity-mask: telefone e CNPJ saem mascarados nas gravações do Microsoft Clarity */}
          <div className="space-y-2 lg:text-right" data-clarity-mask="True">
            <p className="flex flex-wrap gap-x-4 gap-y-1 lg:justify-end">
              <a href={FOOTER.termsUrl} className="underline-offset-4 hover:text-ink hover:underline">
                Termos de uso
              </a>
              <a href={FOOTER.privacyUrl} className="underline-offset-4 hover:text-ink hover:underline">
                Política de privacidade
              </a>
            </p>
            <p>{FOOTER.company ? `${FOOTER.company} · CNPJ ${FOOTER.cnpj}` : `CNPJ ${FOOTER.cnpj}`}</p>
            <p>
              Suporte no WhatsApp:{' '}
              <a href={SUPPORT.whatsappUrl} className="font-medium text-ink underline-offset-4 hover:underline">
                {SUPPORT.whatsappLabel}
              </a>
            </p>
            <p>© {new Date().getFullYear()} CopySync</p>
          </div>
        </div>
      </footer>
    </>
  )
}
