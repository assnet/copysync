/**
 * Textos da proteção do login (bloqueio, verificação anti-robô e código por e-mail).
 * Regras e códigos de erro da API: docs/seguranca-login.md. Mensagens nunca dizem se o e-mail existe.
 */
export const loginProtectionStrings = {
  invalidCredentials: 'E-mail ou senha incorretos.',
  /** `{{time}}` = HH:MM no relógio do usuário, calculado pelo horário do servidor. */
  tooManyAttempts: 'Muitas tentativas. Tente novamente às {{time}}.',
  tooManyAttemptsHint: 'Por segurança, novas tentativas ficam pausadas até esse horário.',
  captchaRequired: 'Confirme que você não é um robô para continuar.',
  captchaInvalid: 'A verificação expirou ou falhou. Faça de novo.',
  captchaLabel: 'Verificação de segurança',
  /** 403 de verificação sem widget na tela (config não carregou). */
  captchaUnavailable: 'A verificação de segurança não carregou. Recarregue a página e tente de novo.',
  captchaLoadFailed: 'Não foi possível carregar a verificação de segurança. Recarregue a página.',
  genericError: 'Não foi possível entrar agora. Tente de novo em instantes.',

  codeTitle: 'Confirme que é você',
  codeSubtitle: 'Enviamos um código de 6 dígitos para {{email}}. Ele vale por 10 minutos.',
  codeReusedSubtitle: 'Use o código de 6 dígitos que enviamos para {{email}} há pouco. Ele vale por 10 minutos.',
  codeLabel: 'Código de verificação',
  codeHelper: 'Só números. Você pode colar o código do e-mail.',
  codeSubmit: 'Confirmar e entrar',
  codeResend: 'Reenviar código',
  codeResendTooltip: 'Envia um novo código para o seu e-mail. O anterior deixa de valer.',
  codeResendWait: 'Você poderá pedir outro código em',
  codeResendAria: 'Tempo até poder reenviar o código',
  codeResent: 'Enviamos um novo código. Confira sua caixa de entrada e o spam.',
  codeBack: 'Voltar e usar outra conta',
  codeInvalid: 'Código incorreto. Restam {{left}} tentativas.',
  codeInvalidOne: 'Código incorreto. Resta 1 tentativa.',
  codeExpired: 'Este código expirou. Peça um novo.',
  codeExhausted: 'Muitas tentativas com código errado. Peça um novo código.',
  codeSendLimit: 'Você já pediu vários códigos. Tente novamente às {{time}}.',
  codeDeliveryFailed: 'Não foi possível enviar o código. Tente novamente.',
  ticketInvalid: 'A verificação expirou. Entre de novo com e-mail e senha.',
} as const;

export const fill = (text: string, vars: Record<string, string | number>): string =>
  text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(vars[k] ?? ''));
