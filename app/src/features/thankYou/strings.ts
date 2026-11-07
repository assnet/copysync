/**
 * Textos da página pública de obrigado pós-compra (`/obrigado`), cadastrada nas ofertas do
 * checkout como página de obrigado (docs/pagina-obrigado.md). Chaves semânticas; a marca entra só
 * por parâmetro (`APP_NAME`). Sem dado pessoal: a página não lê a query nem chama a API.
 */
export const THANK_YOU_PATH = '/obrigado';

/** Remetente do e-mail "Definir senha" (o mesmo da API central de e-mail). */
export const THANK_YOU_SENDER_EMAIL = 'nao-responda@copysync.app';

/** Link público de suporte (atalho de redirecionamento da plataforma). */
export const THANK_YOU_SUPPORT_URL = 'https://app.copysync.app/redirect/suporte';

export const thankYouStrings = {
  pageTitle: 'Compra confirmada',
  badge: 'Pagamento confirmado',
  title: 'Sua compra deu certo. Falta só um passo.',
  subtitle: 'Enviamos para o seu e-mail o link para criar sua senha e entrar no painel.',

  stepsTitle: 'Como acessar',
  steps: {
    openEmail: {
      title: (appName: string) => `Abra o e-mail do ${appName}`,
      senderLabel: 'Remetente:',
      hint: 'Pode levar de 1 a 2 minutos para chegar.',
    },
    setPassword: {
      title: 'Clique em “Definir senha”',
      hint: 'O link vale por 7 dias. Depois, é só entrar com seu e-mail e a senha nova.',
    },
  },
  spamTip: 'Não chegou? Olhe as pastas Spam e Promoções.',

  existingTitle: (appName: string) => `Já tem conta no ${appName}?`,
  existingBody: 'Entre normalmente. O plano novo aparece em Configurações → Assinatura.',

  goToLogin: 'Ir para o login',
  supportPrompt: 'Precisa de ajuda?',
  supportLink: 'Falar com o suporte',
  supportTooltip: 'Abre o suporte em uma nova aba',
  footer: (year: number, appName: string) => `© ${year} ${appName}`,
} as const;
