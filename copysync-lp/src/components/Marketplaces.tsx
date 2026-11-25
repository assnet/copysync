// Logos originais dos marketplaces (mesmos arquivos da página de Planos do app).
// Regras (brief §2): só para indicar compatibilidade; sem alterar cor/proporção;
// todas do mesmo tamanho, em círculo branco com sombra suave; nunca maiores que a marca CopySync.
import amazon from '../assets/marketplaces/amazon.svg'
import mercadoLivre from '../assets/marketplaces/mercado-livre.svg'
import shein from '../assets/marketplaces/shein.svg'
import shopee from '../assets/marketplaces/shopee.svg'

export type Marketplace = 'shopee' | 'mercado-livre' | 'amazon' | 'shein'

export const MARKETPLACES: Record<Marketplace, { name: string; src: string; inset: number }> = {
  shopee: { name: 'Shopee', src: shopee, inset: 0.22 },
  'mercado-livre': { name: 'Mercado Livre', src: mercadoLivre, inset: 0.16 },
  amazon: { name: 'Amazon', src: amazon, inset: 0.22 },
  shein: { name: 'Shein', src: shein, inset: 0.2 },
}

/**
 * Logo dentro de um círculo branco com sombra suave. `lgSize` muda o tamanho a partir de 1024px.
 * `planBadge` mostra a etiqueta do plano (ex.: "MAX" na Shein), como no cabeçalho de Planos do app.
 */
export function MarketLogo({
  id,
  size = 28,
  lgSize,
  className = '',
  decorative = false,
  planBadge,
  altSuffix = '',
}: {
  id: Marketplace
  size?: number
  lgSize?: number
  className?: string
  decorative?: boolean
  planBadge?: string
  altSuffix?: string
}) {
  if (planBadge) {
    return (
      <span className={`relative inline-flex shrink-0 ${className}`}>
        <MarketLogo id={id} size={size} lgSize={lgSize} decorative={decorative} altSuffix={` (plano ${planBadge})`} />
        <span aria-hidden="true" className="absolute -bottom-1 -right-1.5 rounded-[4px] bg-brand px-[3px] text-[9px] font-bold leading-[1.45] tracking-[0.02em] text-white ring-[1.5px] ring-white">
          {planBadge}
        </span>
      </span>
    )
  }
  const m = MARKETPLACES[id]
  return (
    <span
      className={`inline-grid size-[var(--s)] shrink-0 place-items-center rounded-full bg-white shadow-[0_1px_2px_rgba(15,17,23,.08),0_4px_12px_-2px_rgba(15,17,23,.12)] ring-1 ring-black/[0.04] ${lgSize ? 'lg:size-[var(--s-lg)]' : ''} ${className}`}
      style={{ '--s': `${size}px`, '--s-lg': `${lgSize ?? size}px` } as React.CSSProperties}
    >
      <img
        src={m.src}
        alt={decorative ? '' : m.name + altSuffix}
        width={size}
        height={size}
        className="object-contain"
        style={{ width: `${(1 - 2 * m.inset) * 100}%`, height: `${(1 - 2 * m.inset) * 100}%` }}
        decoding="async"
      />
    </span>
  )
}
