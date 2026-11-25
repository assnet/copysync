import { useEffect, useRef, useState } from 'react'
import { PhoneShot } from '../components/PhoneShot'
import printNotebook from '../assets/media/print-notebook.jpg'
import printSapatilha from '../assets/media/print-sapatilha.jpg'

const SHOTS = [
  {
    src: printSapatilha,
    alt: 'Print do grupo de WhatsApp Achei Presente com a oferta de uma sapatilha aquática preta: de R$ 60,00 por R$ 37,73, com link promocional do Mercado Livre.',
    tag: 'Sapatilha · de R$ 60,00 por R$ 37,73',
  },
  {
    src: printNotebook,
    alt: 'Print do grupo de WhatsApp Achei Presente com a oferta de um notebook Asus Vivobook Go por R$ 2.299 no Pix, com link do Mercado Livre.',
    tag: 'Notebook · R$ 2.299 no Pix',
  },
]

/** Prova real: prints do Achei Presente (grupo da CopySync, confirmado pelo Israel em 18/11/2026) recebendo as ofertas da Rota. */
export function RealProof() {
  // Os dois prints (~185 KB) só são pedidos quando a lista chega a 300px da tela. Antes disso o navegador
  // podia baixá-los junto com a primeira tela (loading="lazy" do Chrome pré-carrega de muito longe),
  // disputando banda com o título e piorando o LCP.
  const listRef = useRef<HTMLUListElement>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = listRef.current
    if (!el || near) return
    if (!('IntersectionObserver' in window)) return setNear(true)
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: '300px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [near])

  return (
    <section id="prova" aria-labelledby="prova-title" className="overflow-x-clip bg-ice px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2
            id="prova-title"
            className="font-display text-[2.1rem] font-extrabold leading-[1.06] tracking-[-0.03em] text-ink text-balance sm:text-5xl"
          >
            Direto do Nosso Grupo
          </h2>
          <p className="mt-4 text-lg text-muted">Ofertas reais publicadas pela Rota no Achei Presente, o nosso grupo de achadinhos.</p>
        </div>

        <ul ref={listRef} className="-mx-4 mt-10 flex snap-x snap-mandatory gap-5 overflow-x-auto px-[max(1rem,calc(50%-130px))] pb-6 [scrollbar-width:none] sm:mx-auto sm:mt-14 sm:grid sm:max-w-[640px] sm:grid-cols-2 sm:gap-10 sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
          {SHOTS.map((s) => (
            <li key={s.tag} className="w-[260px] shrink-0 snap-center sm:w-auto">
              <PhoneShot src={s.src} alt={s.alt} load={near} />
              <p className="mt-4 text-center text-sm font-semibold text-ink">{s.tag}</p>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-center text-xs text-muted sm:hidden">Arraste para ver o outro print.</p>
      </div>
    </section>
  )
}
