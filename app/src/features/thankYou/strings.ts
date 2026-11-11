/**
 * Textos da página pública `/obrigado` (docs/pagina-obrigado.md). Duas variantes do cabeçalho:
 * `purchase` (aberta pelo checkout após a venda) e `firstAccess` (aberta pelo link "Meu primeiro
 * acesso" do login). Os passos são os mesmos. Chaves semânticas; a marca entra só por parâmetro
 * (`APP_NAME`). Sem dado pessoal: a página não lê a query nem chama a API.
 */
import { SUPPORT_CHAT_PATH } from '@/features/platformLinks/links';

export const THANK_YOU_PATH = '/obrigado';

/** Remetente do e-mail "Definir senha" (o mesmo da API central de e-mail). */
export const THANK_YOU_SENDER_EMAIL = 'nao-responda@copysync.app';

/** Suporte: atalho de redirecionamento da plataforma (relativo, `/redirect/suporte`). */
export const THANK_YOU_SUPPORT_URL = SUPPORT_CHAT_PATH;

/** Router state enviado pelo link "Meu primeiro acesso" da tela de login. */
export const THANK_YOU_FROM_LOGIN_STATE = { from: 'login' } as const;

export type ThankYouVariant = 'purchase' | 'firstAccess';

/** Webmails mais comuns: só abrem a caixa de entrada (https, nova aba), sem parâmetro. */
export const THANK_YOU_MAIL_SHORTCUTS = [
  { id: 'gmail', label: 'Abrir Gmail', tooltip: 'Abre o Gmail em uma nova aba', href: 'https://mail.google.com/mail/' },
  { id: 'outlook', label: 'Abrir Outlook', tooltip: 'Abre o Outlook em uma nova aba', href: 'https://outlook.live.com/mail/' },
] as const;

export const thankYouStrings = {
  variants: {
    purchase: {
      pageTitle: 'Compra confirmada',
      badge: 'Pagamento confirmado',
      title: 'Compra confirmada. Agora abra seu e-mail.',
      subtitle: 'Enviamos o link para você criar sua senha. É por ele que você entra no painel.',
    },
    firstAccess: {
      pageTitle: 'Primeiro acesso',
      badge: 'Primeiro acesso',
      title: 'Seu acesso começa pelo e-mail',
      subtitle: 'Comprou e ainda não tem senha? O link para criar a sua está no e-mail que enviamos na hora da compra.',
    },
  },

  sender: {
    label: 'Procure o e-mail de',
    subject: 'Botão do e-mail:',
    button: 'Definir senha',
  },

  stepsTitle: 'Como acessar',
  stepLabel: (n: number) => `Passo ${n}`,
  steps: {
    openEmail: {
      title: (appName: string) => `Abra o e-mail do ${appName}`,
      hint: {
        purchase: 'Chega em 1 a 2 minutos, no e-mail usado na compra.',
        firstAccess: 'Ele foi enviado para o e-mail usado na compra.',
      },
    },
    setPassword: {
      title: 'Clique em “Definir senha”',
      hint: 'Crie sua senha na página que abrir. O link vale por 7 dias.',
    },
    signIn: {
      title: 'Entre com e-mail e senha nova',
      hint: 'Pronto: seu painel já está liberado.',
    },
  },
  shortcutsLabel: 'Atalhos para a caixa de entrada',
  spamTip: 'Não achou? Olhe as pastas Spam e Promoções.',

  existingTitle: {
    purchase: (appName: string) => `Já tem conta no ${appName}?`,
    firstAccess: (_appName: string) => 'Já definiu sua senha?',
  },
  existingBody: {
    purchase: 'Entre normalmente. O plano novo aparece em Configurações → Assinatura.',
    firstAccess: 'Então é só entrar com seu e-mail e senha.',
  },

  goToLogin: { purchase: 'Ir para o login', firstAccess: 'Voltar para o login' },
  supportPrompt: 'O e-mail não chegou?',
  supportLink: 'Falar com o suporte',
  supportTooltip: 'Abre o suporte em uma nova aba',
  footer: (year: number, appName: string) => `© ${year} ${appName}`,
} as const;
