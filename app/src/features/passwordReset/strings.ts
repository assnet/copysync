/**
 * Textos do fluxo "esqueci minha senha" (pedido do link e redefinição).
 * - chaves semânticas, nunca o texto como chave
 * - sem nome de marca do produto (usar "o painel")
 * - o pedido nunca diz se o e-mail tem conta (docs/seguranca-login.md)
 */
export const FORGOT_PASSWORD_PATH = '/forgot-password';
export const RESET_PASSWORD_PATH = '/reset-password';

export const passwordResetStrings = {
  /** Link exibido no login e na tela de convite. */
  forgotLink: 'Esqueci minha senha',

  /* --- pedido do link --- */
  requestTitle: 'Esqueceu a senha?',
  requestSubtitle: 'Informe seu e-mail e enviaremos um link para criar uma nova senha.',
  emailLabel: 'E-mail',
  requestSubmit: 'Enviar link',
  backToLogin: 'Voltar ao login',

  /* --- confirmação neutra (a mesma, exista ou não a conta) --- */
  sentTitle: 'Confira seu e-mail',
  sentMessage: 'Se existir uma conta com este e-mail, enviamos um link para criar uma nova senha.',
  sentHint: 'O link vale por 1 hora e só pode ser usado uma vez. Não chegou? Confira a caixa de spam.',
  resendWait: 'Você poderá pedir outro link em',
  resendAria: 'Tempo até poder pedir outro link',
  resend: 'Enviar de novo',
  resendTooltip: 'Envia um novo link para o mesmo e-mail.',
  resent: 'Pedido refeito. Confira sua caixa de entrada e o spam.',
  useAnotherEmail: 'Usar outro e-mail',

  /* --- erros do pedido --- */
  /** `{{time}}` = HH:MM no relógio do usuário, calculado pelo horário do servidor. */
  tooManyRequests: 'Muitos pedidos. Tente novamente às {{time}}.',
  tooManyRequestsHint: 'Por segurança, novos pedidos ficam pausados até esse horário.',
  requestError: 'Não foi possível enviar o pedido agora. Tente de novo em instantes.',

  /* --- redefinição --- */
  loading: 'Verificando o link...',
  invalidTitle: 'Link inválido ou expirado',
  invalidMessage: 'Este link não vale mais: ele dura 1 hora e só funciona uma vez. Peça um novo para continuar.',
  requestNewLink: 'Pedir novo link',
  goToLogin: 'Ir para o login',
  loadErrorTitle: 'Não foi possível verificar o link',
  loadErrorMessage: 'Confira sua conexão e tente de novo.',
  retry: 'Tentar de novo',

  resetTitle: 'Crie uma nova senha',
  resetSubtitle: 'Escolha uma senha que você ainda não usa em outro lugar.',
  accountLabel: 'Conta',
  passwordLabel: 'Nova senha',
  confirmPasswordLabel: 'Confirmar nova senha',
  passwordMinLength: 'Mínimo de 8 caracteres',
  passwordMismatch: 'As senhas não coincidem',
  showPassword: 'Mostrar senha',
  hidePassword: 'Ocultar senha',
  resetSubmit: 'Salvar nova senha',
  weakPassword: 'Senha fraca. Use pelo menos 8 caracteres, com letra maiúscula, minúscula, número e caractere especial.',
  resetError: 'Não foi possível salvar a nova senha. Tente de novo.',

  strengthAria: 'Força da senha',
  strengthWeak: 'Fraca',
  strengthMedium: 'Média',
  strengthStrong: 'Forte',

  /* --- sucesso --- */
  doneTitle: 'Senha alterada',
  doneMessage: 'Sua nova senha já está valendo. Entre com seu e-mail e a nova senha.',
  doneLogin: 'Fazer login',

  /* --- footer --- */
  footer: (year: number) => `© ${year} · Todos os direitos reservados`,
} as const;
