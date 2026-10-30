/**
 * Textos do Story de Oferta, centralizados até o painel ter uma lib de i18n (mesmo padrão de
 * `features/storefront/strings.ts`): chaves semânticas, frase com variável é função tipada,
 * sem nome de marca (white label).
 */
import { OFFER_STORY_RULES } from './productForm.rules';

export const offerStoryStrings = {
  page: {
    title: 'Story de Oferta',
    subtitle: 'Cole o link do produto e receba a arte pronta para o Stories, com foto, preço e cupom.',
    steps: ['Template', 'Produto', 'Compartilhar'],
  },

  template: {
    title: 'Escolha o visual',
    subtitle: 'O template define cores e layout. Foto, título e preço vêm do produto.',
    tabAll: (n: number) => `Todos (${n})`,
    tabFavorites: (n: number) => `Favoritos (${n})`,
    tabsLabel: 'Filtrar templates',
    favorite: 'Adicionar aos favoritos',
    unfavorite: 'Remover dos favoritos',
    selected: 'Selecionado',
    emptyTitle: 'Nenhum favorito ainda',
    emptyHint: 'Toque na estrela de um template para encontrá-lo aqui mais rápido.',
    loadError: 'Não conseguimos carregar os templates.',
    retry: 'Tentar de novo',
    continue: 'Continuar',
    continueHint: 'Escolha um template para continuar',
  },

  product: {
    title: 'Qual produto vai no story?',
    subtitle: 'Buscamos foto, título e preço direto do anúncio.',
    linkLabel: 'Link do produto',
    linkPlaceholder: 'https://…',
    linkHelp: 'Use o link da página do produto (não da vitrine ou loja): Mercado Livre, Shopee ou Amazon.',
    couponToggle: 'Tem cupom?',
    couponHint: 'O código aparece em destaque na arte.',
    codeLabel: 'Código',
    codeHelp: `Até ${OFFER_STORY_RULES.couponMax} caracteres: letras, números, _ . - e espaço`,
    discountLabel: 'Desconto (%)',
    discountHelp: `Opcional. De ${OFFER_STORY_RULES.discountMin} a ${OFFER_STORY_RULES.discountMax}; o preço "Por" já sai com o desconto.`,
    back: 'Voltar',
    generate: 'Gerar arte',
  },

  generating: {
    title: 'Gerando sua arte…',
    subtitle: 'Analisando o produto e montando o story',
  },

  result: {
    title: 'Sua arte está pronta',
    subtitle: 'Poste no Stories e cole o link no sticker de link.',
    imageAlt: (headline: string) => `Arte do story: ${headline}`,
    /** Com `offerStory.art` ligado o alt não expõe o título do produto. */
    imageAltHidden: 'Arte do story',
    share: 'Compartilhar no Stories',
    download: 'Baixar imagem',
    copyLink: 'Copiar link',
    copied: 'Link copiado',
    copyLinkTooltip: 'Cole este link no sticker de link do story',
    copyFailed: 'Não conseguimos copiar. Selecione o link e copie manualmente.',
    shareFailed: 'Não conseguimos abrir o compartilhamento. Baixe a imagem e poste pelo app.',
    linkLabel: 'Link de afiliado',
    unverified: 'comissão não verificada',
    unverifiedTooltip: 'Não confirmamos a sua identificação de afiliado neste link. Confira antes de postar.',
    edit: 'Editar',
    newArt: 'Nova arte',
    warnings: {
      NO_IMAGE: 'Não conseguimos baixar a foto do produto; a arte saiu sem ela.',
      NO_PRICE: 'O anúncio não mostra preço; a arte saiu sem o bloco de preço.',
      AI_FALLBACK: 'O título curto por IA não estava disponível; usamos o título original do anúncio.',
    },
  },

  validation: {
    urlRequired: 'Cole o link do produto.',
    urlInvalid: 'Link inválido. Cole o endereço completo, começando com https://',
    codeRequired: 'Informe o código do cupom.',
    codeTooLong: `Use no máximo ${OFFER_STORY_RULES.couponMax} caracteres.`,
    codeInvalid: 'Use só letras, números, _ . - e espaço.',
    discountInvalid: `Use um número inteiro de ${OFFER_STORY_RULES.discountMin} a ${OFFER_STORY_RULES.discountMax}.`,
  },

  errors: {
    generic: 'Algo deu errado. Tente de novo.',
    OFFER_URL_UNSUPPORTED: 'Link não suportado. Use o link do produto da Shopee, do Mercado Livre ou da Amazon.',
    OFFER_PRODUCT_NOT_FOUND: 'Não encontramos o produto desse link. Confira se é o link do produto.',
    OFFER_LINK_NOT_OWNED: 'Esse link de afiliado é de outra conta. Use um link gerado na sua conta.',
    OFFER_LINK_NOT_AFFILIATE: 'Esse link não tem a sua identificação de afiliado. Na Amazon, use o link com a sua tag.',
    OFFER_STORY_PRODUCT_INCOMPLETE: 'Não conseguimos ler o nome do produto; tente o link da página do produto.',
    OFFER_INVALID_INPUT: 'Confira os campos destacados.',
    VALIDATION_ERROR: 'Confira os campos destacados.',
    OFFER_STORY_TEMPLATE_NOT_FOUND: 'Esse template não existe mais. Escolha outro.',
    MEDIA_PROCESSING_FAILED: 'Não conseguimos montar a arte agora. Tente de novo em instantes.',
    MEDIA_PROCESSOR_UNAVAILABLE: 'O gerador de artes está ocupado. Tente de novo em alguns segundos.',
    AFFILIATE_API_ACCESS_DENIED:
      'Sua conta de afiliado ainda não tem acesso à Open API. Libere o acesso no painel de afiliado da Shopee e confira em Configurações → Credenciais de afiliado.',
    AFFILIATE_CREDENTIAL_REJECTED: 'A loja recusou sua credencial de afiliado. Confira os dados em Configurações → Credenciais de afiliado.',
    AFFILIATE_API_RATE_LIMITED: 'A loja limitou as consultas por agora. Aguarde um instante e tente de novo.',
    AFFILIATE_API_UNAVAILABLE: 'A loja não respondeu agora. Tente de novo em instantes.',
    RATE_LIMITED: 'Muitas artes seguidas. Aguarde um pouco e tente de novo.',
    rateLimitedSeconds: (s: number) => `Muitas artes seguidas. Aguarde ${s} ${s === 1 ? 'segundo' : 'segundos'} e tente de novo.`,
  },
} as const;
