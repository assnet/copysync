import type { WatermarkKind, WatermarkPosition, WatermarkSize } from './types';
import type { WatermarkLogoProblem, WatermarkTextProblem } from './rules';

/**
 * Textos da página "Marca d'água" (i18n do painel: chaves semânticas, frase com variável é função,
 * sem nome do app). Cobertura conferida em `strings.test.ts`.
 */
export const offerWatermarkStrings = {
  page: {
    title: 'Marca d\'água',
    subtitle: 'Seu logo ou o nome da sua marca em cada oferta enviada aos grupos.',
    loading: 'Carregando a marca d\'água',
    loadError: 'Não foi possível carregar a marca d\'água.',
    retry: 'Tentar de novo',
  },

  locked: {
    title: 'Marca d\'água é exclusiva do plano MAX',
    description: 'Assine o MAX para colocar seu logo ou o nome da sua marca em todas as ofertas que você envia.',
    cta: 'Ver planos',
  },

  readOnly: 'Só os administradores da conta alteram a marca d\'água. Você pode ver os ajustes.',

  enabled: {
    title: 'Aplicar a marca nas ofertas',
    on: 'Toda oferta enviada aos grupos sai com a sua marca sobre a foto.',
    off: 'Desligada: as ofertas saem com a foto como está.',
    missingLogo: 'Envie um logo para a marca sair nas ofertas.',
    missingText: 'Digite o texto da marca para ela sair nas ofertas.',
  },

  kind: {
    label: 'Tipo de marca',
    help: 'Escolha um. Trocar não apaga o outro: o logo enviado e o texto digitado ficam guardados.',
    options: {
      IMAGE: { label: 'Logo', hint: 'Imagem com fundo transparente' },
      TEXT: { label: 'Texto', hint: 'O nome da sua marca' },
    } satisfies Record<WatermarkKind, { label: string; hint: string }>,
  },

  logo: {
    label: 'Logo',
    rule: 'PNG ou WebP com fundo transparente, até 1 MB, mínimo 100 × 100 px.',
    choose: 'Enviar logo',
    replace: 'Trocar logo',
    remove: 'Remover logo',
    uploading: 'Enviando o logo…',
    alt: 'Logo da marca',
    confirmRemove: {
      title: 'Remover o logo?',
      message: 'As ofertas param de sair com o logo até você enviar outro. O texto e os ajustes continuam salvos.',
      confirm: 'Remover',
      cancel: 'Cancelar',
    },
    errors: {
      MEDIA_TOO_LARGE: 'O logo passa de 1 MB. Reduza o arquivo e envie de novo.',
      UNSUPPORTED_MEDIA_TYPE: 'Use um PNG ou WebP com fundo transparente.',
      MEDIA_PROCESSING_FAILED: 'Não deu para ler o logo. Confira se tem pelo menos 100 × 100 px e fundo transparente.',
      MEDIA_PROCESSOR_UNAVAILABLE: 'O processamento de imagens está indisponível agora. Tente de novo em instantes.',
      UPLOAD_NOT_FOUND: 'O envio expirou. Escolha o arquivo de novo.',
      UPLOAD_INCOMPLETE: 'O envio não terminou. Escolha o arquivo de novo.',
      UPLOAD_IN_PROGRESS: 'Este logo ainda está sendo processado. Aguarde um instante.',
      INSUFFICIENT_STORAGE: 'Sem espaço para guardar o logo agora. Tente mais tarde.',
      generic: 'Não foi possível enviar o logo. Tente de novo.',
      removeFailed: 'Não foi possível remover o logo. Tente de novo.',
    },
  },

  text: {
    label: 'Texto da marca',
    placeholder: 'Ex.: Achados da Ana',
    help: 'Uma linha, até 32 caracteres. Sai em branco com sombra, legível em qualquer foto.',
    counter: (n: number, max: number) => `${n}/${max}`,
    errors: {
      empty: 'Digite o texto da marca.',
      tooLong: 'Use no máximo 32 caracteres.',
      lineBreak: 'O texto cabe em uma linha só.',
    } satisfies Record<WatermarkTextProblem, string>,
  },

  position: {
    label: 'Posição',
    help: 'Onde a marca fica na foto.',
    options: {
      TOP_LEFT: 'Canto superior esquerdo',
      TOP_RIGHT: 'Canto superior direito',
      CENTER: 'Centro',
      BOTTOM_LEFT: 'Canto inferior esquerdo',
      BOTTOM_RIGHT: 'Canto inferior direito',
    } satisfies Record<WatermarkPosition, string>,
  },

  size: {
    label: 'Tamanho',
    help: 'Largura da marca em relação ao lado menor da foto.',
    options: {
      SMALL: 'Pequeno',
      MEDIUM: 'Médio',
      LARGE: 'Grande',
    } satisfies Record<WatermarkSize, string>,
  },

  opacity: {
    label: 'Opacidade',
    help: 'Quanto a marca aparece sobre a foto. 100% é totalmente visível.',
    value: (n: number) => `${n}%`,
  },

  preview: {
    title: 'Prévia',
    subtitle: 'Foto de exemplo: a marca entra na mesma posição e no mesmo tamanho nas suas ofertas.',
    photoAlt: 'Foto de exemplo de um produto',
    emptyLogo: 'Sem logo enviado',
    emptyText: 'Sem texto',
    off: 'Marca desligada: a oferta sai sem ela.',
  },

  telegram: {
    title: 'No Telegram, a oferta com marca chega como foto com legenda',
    body: 'O Telegram monta a prévia do link sozinho e descartaria a sua marca. Por isso, com a marca ativa, a oferta vai como foto anexada e o texto na legenda. A prévia da oferta no gerador mostra a sua marca sobre a foto, mas no formato de cartão de link.',
  },

  save: {
    unsaved: 'Alterações não salvas',
    discard: 'Descartar',
    save: 'Salvar',
    saving: 'Salvando…',
    saved: 'Marca d\'água salva.',
  },

  errors: {
    generic: 'Não foi possível salvar. Tente de novo.',
    forbidden: 'Só os administradores da conta alteram a marca d\'água.',
    invalidField: {
      enabled: 'Valor inválido em "Aplicar a marca".',
      kind: 'Escolha Logo ou Texto.',
      text: 'Confira o texto da marca: uma linha, de 1 a 32 caracteres.',
      position: 'Escolha uma posição.',
      size: 'Escolha um tamanho.',
      opacity: 'A opacidade vai de 20% a 100%.',
    } as Record<string, string>,
  },
} as const;

export const logoProblemMessage = (p: WatermarkLogoProblem): string => offerWatermarkStrings.logo.errors[p];
