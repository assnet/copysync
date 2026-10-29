import { AppError } from '../AppError';

// ── Grupos (porta do engine de mensageria) ───────────────────────────────────

/** A sessão não pode obter o link de convite do grupo (não é admin ou grupo restrito). */
export class GroupInviteNotAllowedError extends AppError {
  constructor(message = 'Not allowed to get group invite link') {
    super('GROUP_INVITE_NOT_ALLOWED', message, 403);
  }
}
