/**
 * Decide como o convite é aceito: definindo a primeira senha (o token, recebido por e-mail, é a
 * prova de posse do e-mail) ou exigindo login.
 *
 * - Com senha: sempre login.
 * - Sem senha, convite do sistema (`invitedById` null: provisionamento da cobrança ou rota de
 *   super admin): define a senha, mesmo já vinculado a tenant(s). O link só vai ao e-mail do dono
 *   ou a quem já é super admin.
 * - Sem senha, convite de pessoa (`invitedById`): quem convidou recebe o link na resposta, então
 *   não pode virar troca de senha de conta que acessa OUTRO tenant (nem de super admin). Só define
 *   a senha se os vínculos atuais forem nenhum ou apenas o tenant do convite.
 *
 * Função pura. Doc: docs/arquitetura-central-billing.md, seção "Primeiro acesso".
 */

export type InviteAccessDecision = 'SET_PASSWORD' | 'LOGIN';

export interface InviteAccessInput {
  hasPassword: boolean;
  isSuperAdmin: boolean;
  invitedById: string | null;
  inviteTenantId: string;
  memberTenantIds: string[];
}

export function decideInviteAccess(input: InviteAccessInput): InviteAccessDecision {
  if (input.hasPassword) return 'LOGIN';
  if (input.invitedById === null) return 'SET_PASSWORD';
  if (input.isSuperAdmin) return 'LOGIN';
  return input.memberTenantIds.every((id) => id === input.inviteTenantId) ? 'SET_PASSWORD' : 'LOGIN';
}

/**
 * Primeiro acesso de quem comprou: convite do sistema (`invitedById` null, provisionado pela
 * cobrança ou pelo super admin) para conta sem senha. O painel troca o texto de equipe por boas-vindas.
 */
export function isFirstAccessInvite(input: { invitedById: string | null; hasPassword: boolean }): boolean {
  return input.invitedById === null && !input.hasPassword;
}

/**
 * Estado do link de convite. `ALREADY_ACCEPTED` é separado de `INVALID` para o painel dizer
 * "sua senha já foi criada, faça login" a quem clica de novo no e-mail (o link é de uso único).
 * Aceito vence expirado: quem já usou o link deve ser mandado ao login, não a pedir outro convite.
 */
export type InviteUsability = 'USABLE' | 'ALREADY_ACCEPTED' | 'INVALID';

export function inviteUsability(
  invite: { acceptedAt: Date | null; expiresAt: Date } | null,
  now: Date,
): InviteUsability {
  if (!invite) return 'INVALID';
  if (invite.acceptedAt) return 'ALREADY_ACCEPTED';
  return invite.expiresAt < now ? 'INVALID' : 'USABLE';
}
