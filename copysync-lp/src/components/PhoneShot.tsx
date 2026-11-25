/** 1×1 transparente: ocupa o lugar do print até ele ser pedido (nada vai para a rede). */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

/**
 * Print de celular dentro de uma moldura de aparelho (estática, leve).
 * `load`: o print só é baixado quando vira true (quem usa decide, ex.: perto da tela), com prioridade baixa,
 * para não disputar banda com o título e as fontes da primeira tela. Sem JS, o <noscript> mostra o print normal.
 */
export function PhoneShot({ src, alt, load = true, className = '' }: { src: string; alt: string; load?: boolean; className?: string }) {
  return (
    <div
      className={`relative rounded-[2.4rem] bg-[linear-gradient(145deg,#5d6068,#2a2c31_30%,#16171a_70%,#3a3c42)] p-[7px] shadow-[inset_0_0_0_1px_rgba(255,255,255,.12),0_2px_4px_rgba(15,17,23,.08),0_24px_48px_-16px_rgba(15,17,23,.35),0_50px_90px_-40px_rgba(41,48,110,.45)] ${className}`}
    >
      <div className="relative aspect-[620/1342] overflow-hidden rounded-[2rem] bg-black">
        <img
          src={load ? src : BLANK}
          alt={alt}
          decoding="async"
          fetchPriority="low"
          width={620}
          height={1342}
          className="absolute inset-0 block size-full"
        />
        <noscript>
          <img src={src} alt={alt} loading="lazy" decoding="async" width={620} height={1342} className="absolute inset-0 block size-full" />
        </noscript>
      </div>
      <div className="pointer-events-none absolute inset-[7px] rounded-[2rem] bg-[linear-gradient(120deg,rgba(255,255,255,.16),transparent_26%)]" />
    </div>
  )
}
