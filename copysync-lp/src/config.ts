// Dados da oferta usados em mais de um bloco.
// Tudo marcado ⚠️ PENDENTE precisa ser confirmado antes de publicar (ver também QA-PENDENCIAS.md).

/** Menor preço mensal: LITE no anual, 12x de R$ 77 (igual ao hero, ao fechamento e ao anúncio). */
export const PRICE_FROM = 'R$\u00a077/mês'
export const GUARANTEE = '7 dias de garantia'

/** Tempo real medido (Israel, 16/11/2026): 3 s entre a oferta cair no grupo-fonte e aparecer no grupo dele. */
export const HEADLINE_TIME_WORD: 'Segundos' | 'Minutos' = 'Segundos'

/** O cronômetro da animação do hero termina neste valor (o tempo real medido), em segundos. */
export const HERO_TIMER_SECONDS = 3

/** Confirmado: o vídeo é apresentação de vendas (título neutro "Veja a CopySync em vídeo"). */
export const VIDEO_SHOWS_REAL_PRODUCT = false
export const YOUTUBE_ID = 'NYYV03xBuak'

/** Destinos internos. */
export const ANCHOR = {
  demo: '#demonstracao',
  video: '#video',
  planos: '#planos',
} as const

/** Suporte (também é o canal para pedir reembolso). */
export const SUPPORT = {
  whatsappUrl: 'https://api.whatsapp.com/send?phone=5551997781476&text=Ol%C3%A1%20CopySync%20,%20preciso%20de%20ajuda',
  whatsappLabel: '+55 51 99778-1476',
}

/** Rodapé. `company` (razão social) é opcional; se vier, aparece antes do CNPJ. */
export const FOOTER = {
  termsUrl: '/termos/',
  privacyUrl: '/privacidade/',
  company: '',
  cnpj: '37.309.645/0001-10',
}
