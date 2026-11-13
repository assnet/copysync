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
    stepsLabel: 'Etapas do story',
    stepDone: 'concluído',
  },

  template: {
    title: 'Escolha o visual',
    subtitle: 'O template define cores e layout. Foto, título e preço vêm do produto.',
    tabAll: 'Todos',
    tabFavorites: 'Favoritos',
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
    pickedLabel: 'Template escolhido',
    nonePicked: 'Toque em um visual para escolher',
  },

  product: {
    title: 'Qual produto vai no story?',
    subtitle: 'Buscamos foto, título e preço direto do anúncio.',
    linkLabel: 'Link do produto',
    linkPlaceholder: 'https://…',
    /** Aceita link de qualquer afiliado: a API recria com a conta do usuário. */
    linkHelp: 'Cole o link da página do produto no Mercado Livre, na Shopee ou na Amazon, mesmo que seja de outro afiliado. O link da arte sai com a sua comissão.',
    /** Botão sob o link quando o erro tem correção em outra tela (conectar loja vem de `affiliateLinks`). */
    errorActions: {
      credentials: 'Ir para Credenciais de afiliado',
      plans: 'Ver planos com mais etiquetas',
    },
    couponToggle: 'Tem cupom?',
    couponHint: 'O código aparece em destaque na arte.',
    codeLabel: 'Código',
    codeHelp: `Até ${OFFER_STORY_RULES.couponMax} caracteres: letras, números, _ . - e espaço`,
    discountLabel: 'Desconto (%)',
    discountHelp: `Opcional. De ${OFFER_STORY_RULES.discountMin} a ${OFFER_STORY_RULES.discountMax}; o preço "Por" já sai com o desconto e o selo mostra o desconto total.`,
    back: 'Voltar',
    generate: 'Gerar arte',
    previewTitle: 'Prévia do visual',
    previewHint: 'A foto, o título e o preço do anúncio entram neste visual.',
    previewSlots: ['Foto do produto', 'Título curto', 'Preço e cupom'],
    changeTemplate: 'Trocar visual',
  },

  generating: {
    title: 'Criando seu story…',
    subtitle: 'Leva poucos segundos.',
    steps: ['Lendo o produto', 'Escrevendo o título', 'Montando a arte'],
  },

  result: {
    title: 'Seu story está pronto',
    subtitle: 'Poste agora e leve seus seguidores direto para a oferta.',
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
    tipsTitle: 'Como postar',
    tips: ['Compartilhe ou baixe a arte e abra o Stories.', 'Toque em Figurinhas e escolha Link.', 'Cole o link de afiliado copiado acima.'],
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

  /** Erros de link de afiliado (credencial, loja fora, aceite de risco) vêm de `features/affiliateLinks`. */
  errors: {
    generic: 'Algo deu errado. Tente de novo.',
    OFFER_URL_UNSUPPORTED: 'Link não suportado. Use o link do produto da Shopee, do Mercado Livre ou da Amazon.',
    OFFER_PRODUCT_NOT_FOUND: 'Não encontramos o produto desse link. Confira se é o link do produto.',
    OFFER_STORY_PRODUCT_INCOMPLETE: 'Não conseguimos ler o nome do produto; tente o link da página do produto.',
    OFFER_INVALID_INPUT: 'Confira os campos destacados.',
    VALIDATION_ERROR: 'Confira os campos destacados.',
    OFFER_STORY_TEMPLATE_NOT_FOUND: 'Esse template não existe mais. Escolha outro.',
    MEDIA_PROCESSING_FAILED: 'Não conseguimos montar a arte agora. Tente de novo em instantes.',
    MEDIA_PROCESSOR_UNAVAILABLE: 'O gerador de artes está ocupado. Tente de novo em alguns segundos.',
    sheinUnavailable: 'A Shein não está liberada no seu plano. Os planos com Shein estão em Afiliados › Planos.',
    AFFILIATE_IDENTIFIER_NOT_LINKED: 'Este link usa outra etiqueta da sua conta do Mercado Livre. Vincule a etiqueta em Credenciais de afiliado para usar este link.',
    PLAN_LIMIT_REACHED: 'Você chegou a um limite do seu plano. Veja os planos para ter mais.',
    /** Etiqueta da conta do ML não vinculada e sem vaga no plano (`PLAN_LIMIT_REACHED` de etiquetas). */
    mercadoLivreTagLimit: (limit: number | null, canUpgrade: boolean) =>
      !canUpgrade && limit != null
        ? `Este link usa outra etiqueta da sua conta do Mercado Livre e as ${limit} etiquetas do seu plano já estão em uso. Desvincule uma em Credenciais de afiliado para usar esta.`
        : limit != null && limit <= 1
          ? 'Este link usa outra etiqueta da sua conta do Mercado Livre, e o seu plano inclui só a etiqueta principal. Faça upgrade para usar mais etiquetas.'
          : 'Este link usa outra etiqueta da sua conta do Mercado Livre, e as etiquetas do seu plano já estão em uso. Faça upgrade ou desvincule uma em Credenciais de afiliado.',
    RATE_LIMITED: 'Muitas artes seguidas. Aguarde um pouco e tente de novo.',
    rateLimitedSeconds: (s: number) => `Muitas artes seguidas. Aguarde ${s} ${s === 1 ? 'segundo' : 'segundos'} e tente de novo.`,
  },
} as const;
