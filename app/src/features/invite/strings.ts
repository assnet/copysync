/**
 * Textos da tela de convite — mesmas regras de `features/settings/strings.ts`:
 * - chaves semanticas, nunca o texto como chave
 * - sem nome de marca do produto (usar "a ferramenta" / "o painel")
 */
export const inviteStrings = {
  loading: 'Verificando convite...',

  /* --- estados de erro --- */
  invalidTitle: 'Convite invalido',
  invalidMessage: 'Este link de convite e invalido ou ja expirou.',
  expiredTitle: 'Convite expirado',
  expiredMessage: 'Este convite expirou. Solicite um novo convite ao administrador.',
  backToLogin: 'Ir para o login',

  /* --- convite valido --- */
  title: 'Voce foi convidado',
  subtitle: 'Uma equipe quer que voce faca parte do painel.',
  teamLabel: 'Equipe',
  roleLabel: 'Funcao',
  emailLabel: 'E-mail',

  /* --- roles traduzidos --- */
  roles: {
    ADMIN: 'Administrador',
    MEMBER: 'Membro',
    VIEWER: 'Visualizador',
    OPERATOR: 'Operador',
  } as Record<string, string>,

  /* --- formulario de senha (novo usuario) --- */
  passwordTitle: 'Crie sua senha para acessar',
  passwordLabel: 'Senha',
  confirmPasswordLabel: 'Confirmar senha',
  passwordMinLength: 'Minimo de 8 caracteres',
  passwordMismatch: 'As senhas nao coincidem',
  showPassword: 'Mostrar senha',
  hidePassword: 'Ocultar senha',
  submitCreate: 'Criar conta e entrar',

  /* --- usuario existente --- */
  existingUserTitle: 'Voce ja tem conta',
  existingUserMessage: 'Faca login para aceitar o convite e acessar a equipe.',
  goToLogin: 'Fazer login',

  /* --- resultado --- */
  acceptedTitle: 'Convite aceito!',
  acceptedMessage: 'Sua conta foi criada. Faca login para acessar o painel.',
  redirectingToLogin: 'Redirecionando para o login...',
  genericError: 'Nao foi possivel aceitar o convite. Tente novamente.',

  /* --- acessibilidade --- */
  strengthWeak: 'Fraca',
  strengthMedium: 'Media',
  strengthStrong: 'Forte',

  /* --- footer --- */
  footer: (year: number) => `© ${year} · Todos os direitos reservados`,
} as const;

/** Traduz o role da API para exibicao. */
export function translateRole(role: string): string {
  return inviteStrings.roles[role] || role;
}

/** Mascara caracteres do meio do e-mail: a***z@domain.com */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain || local.length <= 2) return email;
  return `${local[0]}${'*'.repeat(Math.min(local.length - 2, 5))}${local[local.length - 1]}@${domain}`;
}
