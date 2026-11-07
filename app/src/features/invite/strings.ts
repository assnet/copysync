/**
 * Textos da tela de convite — mesmas regras de `features/settings/strings.ts`:
 * - chaves semânticas, nunca o texto como chave
 * - sem nome de marca do produto (usar "a ferramenta" / "o painel")
 */
export const inviteStrings = {
  loading: 'Verificando convite...',

  /* --- estados de erro --- */
  invalidTitle: 'Convite inválido',
  invalidMessage: 'Este link de convite é inválido ou já expirou.',
  expiredTitle: 'Convite expirado',
  expiredMessage: 'Este convite expirou. Solicite um novo convite ao administrador.',
  backToLogin: 'Ir para o login',

  /* --- convite valido --- */
  title: 'Você foi convidado',
  subtitle: 'Uma equipe quer que você faça parte do painel.',
  teamLabel: 'Equipe',
  roleLabel: 'Função',
  emailLabel: 'E-mail',

  /* --- primeiro acesso de quem comprou (convite do sistema, `firstAccess`) --- */
  firstAccessTitle: (appName: string) => `Bem-vindo ao ${appName}`,
  firstAccessSubtitle: 'Crie sua senha para acessar seu painel.',
  firstAccessSubmit: 'Criar senha e entrar',

  /* --- roles traduzidos --- */
  roles: {
    ADMIN: 'Administrador',
    MEMBER: 'Membro',
    VIEWER: 'Visualizador',
    OPERATOR: 'Operador',
  } as Record<string, string>,

  /* --- formulário de senha (novo usuário) --- */
  passwordTitle: 'Crie sua senha para acessar',
  passwordLabel: 'Senha',
  confirmPasswordLabel: 'Confirmar senha',
  passwordMinLength: 'Mínimo de 8 caracteres',
  passwordMismatch: 'As senhas não coincidem',
  showPassword: 'Mostrar senha',
  hidePassword: 'Ocultar senha',
  submitCreate: 'Criar conta e entrar',

  /* --- usuário existente --- */
  existingUserTitle: 'Você já tem conta',
  existingUserMessage: 'Faça login para aceitar o convite e acessar a equipe.',
  goToLogin: 'Fazer login',

  /* --- resultado --- */
  acceptedTitle: 'Convite aceito!',
  acceptedMessage: 'Sua conta foi criada. Faça login para acessar o painel.',
  redirectingToLogin: 'Redirecionando para o login...',
  genericError: 'Não foi possível aceitar o convite. Tente novamente.',

  /* --- acessibilidade --- */
  strengthWeak: 'Fraca',
  strengthMedium: 'Média',
  strengthStrong: 'Forte',

  /* --- footer --- */
  footer: (year: number) => `© ${year} · Todos os direitos reservados`,
} as const;

/** Traduz o role da API para exibição. */
export function translateRole(role: string): string {
  return inviteStrings.roles[role] || role;
}

/** Mascara os caracteres do meio do e-mail: a***z@domain.com */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain || local.length <= 2) return email;
  return `${local[0]}${'*'.repeat(Math.min(local.length - 2, 5))}${local[local.length - 1]}@${domain}`;
}
