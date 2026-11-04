import { AppError } from '../AppError';

// ── Grupos (porta do engine de mensageria) ───────────────────────────────────

/** A sessão não pode obter o link de convite do grupo (não é admin ou grupo restrito). */
export class GroupInviteNotAllowedError extends AppError {
  constructor(message = 'Not allowed to get group invite link') {
    super('GROUP_INVITE_NOT_ALLOWED', message, 403);
  }
}

/** A sessão não pode postar no grupo (canal só de leitura): serve para monitorar, não como destino. */
export class GroupNotPostableError extends AppError {
  constructor(groupJid: string) {
    super('GROUP_NOT_POSTABLE', `Session cannot post in group ${groupJid}`, 422);
  }
}
