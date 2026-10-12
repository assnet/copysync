
/** Navy da marca (logo); base dos overlays sobre a foto. */
export const BRAND_NAVY = '#0b1a4a';

/** Fotos em `app/public/assets/login/` — créditos e licença em `CREDITS.md` na mesma pasta. */
export const LOGIN_IMAGES = {
  hero: '/assets/login/team-hero.webp',
  heroAlt: 'Equipe reunida em uma mesa, sorrindo e trabalhando em notebooks',
  avatars: [
    { src: '/assets/login/avatar-1.webp', alt: 'Afiliada sorrindo' },
    { src: '/assets/login/avatar-2.webp', alt: 'Afiliado concentrado no notebook' },
    { src: '/assets/login/avatar-3.webp', alt: 'Afiliado rindo durante o trabalho' },
  ],
} as const;

/** Copy do painel de apresentação — alinhada a `docs/produto-roadmap.md`. */
export const LOGIN_COPY = {
  headline: 'Suas ofertas de afiliado publicadas no automático',
  headlineShort: 'Ofertas de afiliado publicadas no automático',
  subtitle:
    'Você escolhe os grupos e o horário. A ferramenta monitora, troca o link pelo seu, reescreve o texto com IA e publica nos seus grupos.',
  socialProof: 'Afiliados publicando ofertas todos os dias, enquanto cuidam do resto.',
  formTitle: 'Que bom ter você de volta',
  formSubtitle: 'Entre para acompanhar suas ofertas e grupos.',
} as const;

export interface LoginBenefit {
  label: string;
  hint: string;
}

/**
 * Passos do produto, na ordem em que acontecem (conectar → ligar contas →
 * reescrever → agendar → rodízio). A ordem é o conteúdo: o painel numera.
 */
export const LOGIN_BENEFITS: readonly LoginBenefit[] = [
  {
    label: 'WhatsApp e Telegram',
    hint: 'Conecte seus números e contas para monitorar grupos e publicar ofertas.',
  },
  {
    label: 'Shopee, Mercado Livre e Amazon',
    hint: 'Ligue suas contas de afiliado e cada oferta sai com o seu link.',
  },
  {
    label: 'Texto reescrito com IA',
    hint: 'Cada oferta ganha um texto novo, sem parecer cópia do concorrente.',
  },
  {
    label: 'Horário programado',
    hint: 'Escolha a janela de horários e as ofertas saem sozinhas.',
  },
  {
    label: 'Rodízio de links',
    hint: 'Um link só que distribui quem entra entre os seus grupos.',
  },
];
