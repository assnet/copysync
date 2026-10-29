/**
 * Textos da Página de Ofertas, centralizados até o painel ter uma lib de i18n — mesmas regras de
 * `features/linkRotation/strings.ts`:
 * - chaves semânticas, nunca o texto como chave
 * - frase com variável é função tipada; componente nunca concatena pedaços
 * - sem nome de marca do produto
 */
import { PREMIUM_SLUG_OFFER } from '@/features/plans/catalog';
import type { StorefrontOfferProvider } from './types';
import { STOREFRONT_RANGES } from './types';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const count = (n: number) => n.toLocaleString('pt-BR');
const offers = (n: number) => `${count(n)} ${plural(n, 'oferta', 'ofertas')}`;

const PROVIDER_LABELS: Record<StorefrontOfferProvider, string> = {
  SHOPEE: 'Shopee',
  MERCADO_LIVRE: 'Mercado Livre',
  AMAZON: 'Amazon',
};

export const storefrontStrings = {
  menuLabel: 'Página de Ofertas',

  page: {
    title: 'Página de Ofertas',
    subtitle: 'Uma vitrine com as suas ofertas num endereço só seu, pronta para a bio e os stories.',
    loadError: 'Não foi possível carregar a sua página.',
    retry: 'Tentar de novo',
    paused: 'Sua página está pausada porque o plano atual não inclui a Página de Ofertas. O nome continua reservado para você.',
    noDomain: 'A Página de Ofertas ainda não está disponível. Assim que liberarmos um domínio, você poderá criar a sua.',
  },

  empty: {
    title: 'Crie a sua Página de Ofertas',
    description: 'Junte os seus links de afiliado numa página bonita, com a sua foto, capa e cores. Quem visita escolhe a oferta e compra pelo seu link.',
    cta: 'Criar minha Página',
  },

  address: {
    copy: 'Copiar endereço',
    copied: 'Copiado',
    open: 'Abrir',
    openTooltip: 'Abrir a página numa nova aba',
    missing: 'Endereço indisponível. Salve a página de novo para recuperar o endereço.',
    copyFailed: 'Não foi possível copiar. Selecione o endereço e copie manualmente.',
    label: 'Endereço público',
  },

  /** Avisos de sucesso das ações da página. */
  toast: {
    published: 'Oferta publicada',
    unpublished: 'Oferta voltou para os rascunhos',
    deleted: 'Oferta apagada',
    imageSaved: 'Imagem atualizada',
    imageRemoved: 'Imagem removida',
  },

  config: {
    title: 'Configuração da página',
    edit: 'Editar',
    cancel: 'Cancelar',
    save: 'Salvar',
    saving: 'Salvando…',
    saved: 'Página salva',
    create: 'Criar minha Página',
    addressLabel: 'ENDEREÇO',
    changeTitle: 'O endereço vai mudar',
  },

  fields: {
    name: {
      label: 'NOME',
      placeholder: 'Ex.: Achadinhos da Ana',
      help: `De ${STOREFRONT_RANGES.name.min} a ${STOREFRONT_RANGES.name.max} caracteres.`,
      invalid: `O nome precisa ter de ${STOREFRONT_RANGES.name.min} a ${STOREFRONT_RANGES.name.max} caracteres.`,
    },
    subdomain: {
      label: 'SUBDOMÍNIO',
      placeholder: 'achadinhos-da-ana',
      rule: `De ${STOREFRONT_RANGES.slug.min} a ${STOREFRONT_RANGES.slug.max} caracteres: letras minúsculas (a-z), números (0-9) e hífen.`,
      checking: 'Verificando…',
      suggestionsLabel: 'Sugestões livres:',
      domainLabel: 'Domínio',
      changeWarning: (from: string, to: string) =>
        `Ao salvar, o endereço muda de ${from} para ${to}. O endereço antigo para de funcionar — atualize os links que você já divulgou.`,
    },
    photo: {
      label: 'FOTO',
      rule: 'JPEG, PNG ou WebP até 2 MB, mínimo 200×200.',
      choose: 'Escolher foto',
      replace: 'Trocar foto',
      remove: 'Remover foto',
      uploading: 'Enviando…',
      clickToChange: 'Clique para trocar',
      confirmRemove: { title: 'Remover foto?', message: 'A página volta a usar o visual padrão neste ponto.', confirm: 'Remover', cancel: 'Cancelar' },
    },
    cover: {
      label: 'CAPA',
      rule: 'JPEG, PNG ou WebP até 4 MB, mínimo 1200×400, proporção 3:1.',
      choose: 'Escolher capa',
      replace: 'Trocar capa',
      remove: 'Remover capa',
      uploading: 'Enviando…',
      clickToChange: 'Clique para trocar',
      confirmRemove: { title: 'Remover capa?', message: 'A página volta a usar o visual padrão neste ponto.', confirm: 'Remover', cancel: 'Cancelar' },
    },
    subtitle: {
      label: 'SUBTÍTULO',
      placeholder: 'Uma frase curta sobre as suas ofertas',
      help: `Opcional, até ${STOREFRONT_RANGES.subtitleMax} caracteres.`,
      suggestionsLabel: 'Sugestões:',
      invalid: `O subtítulo pode ter até ${STOREFRONT_RANGES.subtitleMax} caracteres.`,
      counter: (n: number) => `${count(n)}/${count(STOREFRONT_RANGES.subtitleMax)}`,
    },
    images: {
      afterSave: 'Salve a página para adicionar a foto e a capa.',
    },
    categories: {
      label: 'CATEGORIAS',
      help: 'Escolha as categorias que aparecem como filtro na sua página.',
    },
    colors: {
      primary: 'PRINCIPAL',
      background: 'FUNDO',
      card: 'CARDS',
      label: 'CORES',
      picker: (name: string) => `Escolher a cor ${name.toLowerCase()}`,
      invalid: 'Use uma cor no formato #RRGGBB.',
    },
  },

  /** Estados do nome do endereço (`GET /storefront/slug-availability`). */
  slugStatus: {
    AVAILABLE: 'Disponível',
    OWNED: 'É seu',
    TAKEN: 'Em uso, tente outro ou escolha uma sugestão.',
    RESERVED: 'Indisponível',
    PREMIUM: 'Nome especial — disponível para compra.',
    INVALID: `Use de ${STOREFRONT_RANGES.slug.min} a ${STOREFRONT_RANGES.slug.max} caracteres: letras minúsculas (a-z), números (0-9) e hífen, sem hífen nas pontas.`,
  },

  premium: {
    title: PREMIUM_SLUG_OFFER.title,
    benefits: PREMIUM_SLUG_OFFER.benefits,
    priceLabel: PREMIUM_SLUG_OFFER.priceLabel,
    buy: 'Comprar',
    soon: 'Em breve',
  },

  addOffer: {
    title: 'Adicionar Oferta',
    urlLabel: 'Link do produto',
    urlPlaceholder: 'Cole o link do produto',
    productLinkHint: 'Use o link do PRODUTO (não o da vitrine/loja) — senão a imagem pode vir trocada.',
    categoryLabel: 'Categoria',
    noCategory: 'Sem categoria',
    extract: 'Extrair',
    extracting: 'Extraindo…',
    added: 'Oferta adicionada aos rascunhos',
  },

  offers: {
    title: 'Suas Ofertas',
    tabs: {
      drafts: (n: number) => `Rascunhos (${count(n)})`,
      published: (n: number) => `Publicadas (${count(n)})`,
    },
    emptyDrafts: { title: 'Nenhum rascunho', description: 'Adicione pelo campo acima.' },
    emptyPublished: { title: 'Nenhuma oferta publicada', description: 'Publique da aba Rascunhos.' },
    publish: 'Publicar',
    unpublish: 'Despublicar',
    edit: 'Editar',
    delete: 'Apagar',
    moveUp: 'Mover para cima',
    moveDown: 'Mover para baixo',
    dragHandle: 'Arrastar para reordenar',
    /** Avisos do arrastar para leitor de tela (padrão da lib é em inglês). */
    dnd: {
      instructions: 'Para reordenar, foque a alça e aperte espaço. Use as setas para mover e espaço de novo para soltar. Esc cancela.',
      start: (pos: number) => `Oferta pega na posição ${count(pos)}.`,
      over: (pos: number) => `Oferta sobre a posição ${count(pos)}.`,
      end: (pos: number) => `Oferta solta na posição ${count(pos)}.`,
      cancel: 'Reordenação cancelada.',
    },
    openLink: 'Abrir link da oferta',
    noPrice: 'Sem preço',
    provider: (p: StorefrontOfferProvider) => PROVIDER_LABELS[p],
    confirmDelete: {
      title: 'Apagar oferta?',
      message: (title: string) => `"${title}" sai da página e não pode ser recuperada.`,
      /** Sem o título: usado quando a privacidade borra títulos de oferta. */
      messageHidden: 'A oferta sai da página e não pode ser recuperada.',
      confirm: 'Apagar',
      cancel: 'Cancelar',
    },
    unverified: {
      badge: 'Comissão não verificada',
      tooltip: 'Não conseguimos confirmar que este link gera comissão para você. Configure as suas credenciais de afiliado para verificar.',
      action: 'Configurar credenciais',
    },
    limits: {
      total: (used: number) => `${count(used)} de ${offers(STOREFRONT_RANGES.maxOffers)}`,
      published: (used: number) => `${count(used)} de ${count(STOREFRONT_RANGES.maxPublished)} publicadas`,
    },
  },

  editOffer: {
    title: 'Editar oferta',
    titleLabel: 'Título',
    titleInvalid: `O título precisa ter de 1 a ${STOREFRONT_RANGES.offerTitleMax} caracteres.`,
    priceLabel: 'Preço',
    originalPriceLabel: 'Preço "de"',
    priceInvalid: 'Informe um preço válido.',
    categoryLabel: 'Categoria',
    save: 'Salvar',
    cancel: 'Cancelar',
    saved: 'Oferta atualizada',
  },

  preview: {
    title: 'Preview em tempo real',
    mobile: 'Mobile',
    desktop: 'Desktop',
    viewportGroup: 'Tamanho da prévia',
    loading: 'Atualizando prévia…',
    error: 'Não foi possível atualizar a prévia.',
    frameTitle: 'Prévia da Página de Ofertas',
    blurred: 'Prévia oculta pela privacidade',
    expand: 'Ampliar prévia',
    expandTitle: 'Prévia ampliada',
    close: 'Fechar prévia ampliada',
  },

  errors: {
    generic: 'Algo deu errado. Tente de novo.',
    PLAN_FEATURE_UNAVAILABLE: 'O seu plano não inclui a Página de Ofertas.',
    VALIDATION_ERROR: 'Confira os campos destacados.',
    LINK_SLUG_INVALID: `Nome inválido. Use de ${STOREFRONT_RANGES.slug.min} a ${STOREFRONT_RANGES.slug.max} caracteres: a-z, 0-9 e hífen.`,
    LINK_SLUG_RESERVED: 'Esse nome é reservado. Escolha outro.',
    LINK_SLUG_TAKEN: 'Esse nome já está em uso. Tente outro ou escolha uma sugestão.',
    LINK_DOMAIN_INVALID: 'Domínio indisponível. Recarregue a página e tente de novo.',
    STOREFRONT_SLUG_PREMIUM: 'Esse é um nome especial, disponível para compra.',
    STOREFRONT_OFFER_LIMIT: `Você chegou ao limite de ${offers(STOREFRONT_RANGES.maxOffers)}. Apague alguma para adicionar outra.`,
    STOREFRONT_PUBLISHED_LIMIT: `Você chegou ao limite de ${count(STOREFRONT_RANGES.maxPublished)} ofertas publicadas. Despublique alguma antes.`,
    STOREFRONT_NOT_FOUND: 'Não encontramos esse item. Recarregamos a página para você.',
    STOREFRONT_ORDER_INVALID: 'A lista mudou enquanto você reordenava. Recarregamos as ofertas.',
    OFFER_URL_UNSUPPORTED: 'Link não suportado. Use o link do produto da Shopee, do Mercado Livre ou da Amazon.',
    OFFER_PRODUCT_NOT_FOUND: 'Não encontramos o produto desse link. Confira se é o link do produto.',
    OFFER_LINK_NOT_OWNED: 'Esse link de afiliado é de outra conta. Use um link gerado na sua conta.',
    OFFER_LINK_NOT_AFFILIATE: 'Esse link não tem a sua identificação de afiliado. Na Amazon, use o link com a sua tag.',
    MEDIA_TOO_LARGE: 'Imagem grande demais para este campo.',
    UNSUPPORTED_MEDIA_TYPE: 'Formato não aceito. Use JPEG, PNG ou WebP.',
    MEDIA_PROCESSING_FAILED: 'Não conseguimos usar essa imagem. Confira o tamanho mínimo e tente outra.',
    UPLOAD_NOT_FOUND: 'O envio da imagem expirou. Escolha a imagem de novo.',
    UPLOAD_INCOMPLETE: 'O envio da imagem não terminou. Tente de novo.',
    RATE_LIMITED: 'Muitas tentativas seguidas. Aguarde um pouco e tente de novo.',
    rateLimitedSeconds: (s: number) => `Muitas tentativas seguidas. Aguarde ${count(s)} ${plural(s, 'segundo', 'segundos')} e tente de novo.`,
  },
} as const;
