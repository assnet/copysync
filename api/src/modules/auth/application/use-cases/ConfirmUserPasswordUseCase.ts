import type { IUserRepository } from '../../../users/domain/contracts/IUserRepository';
import type { PasswordVerifier } from '../../domain/contracts/ILoginSecurity';
import type {
  IPasswordConfirmationRepository,
  PasswordConfirmationAction,
} from '../../domain/contracts/IPasswordConfirmationRepository';
import {
  evaluatePasswordConfirmationLock,
  PASSWORD_CONFIRMATION_LOOKBACK_MS,
  PASSWORD_CONFIRMATION_RETENTION_MS,
} from '../../domain/services/passwordConfirmationRules';
import {
  InvalidCredentialsError,
  PasswordConfirmationLockedError,
} from '../../../../shared/errors/internal/AuthErrors';

export interface ConfirmUserPasswordInput {
  /** Sempre o usuário logado (`request.user.userId`), nunca um id vindo do corpo. */
  userId: string;
  password: string;
  action: PasswordConfirmationAction;
}

/** Porta para os módulos que pedem a senha antes de uma ação sensível. */
export type UserPasswordConfirmer = Pick<ConfirmUserPasswordUseCase, 'execute'>;

export interface ConfirmUserPasswordDeps {
  users: Pick<IUserRepository, 'findById'>;
  attempts: IPasswordConfirmationRepository;
  verifyPassword: PasswordVerifier;
  now?: () => Date;
}

/**
 * Confere a senha do usuário logado antes de uma ação sensível (docs/seguranca-login.md).
 * Sob trava por usuário: lê as falhas, decide o bloqueio e RESERVA a tentativa (já como falha)
 * antes do bcrypt. Bloqueado → 429 `PASSWORD_CONFIRMATION_LOCKED` sem rodar bcrypt. Senha errada
 * ou usuário sem senha → 401 `INVALID_CREDENTIALS` (mesmo erro e mesmo tempo). Sucesso só tira a
 * própria tentativa da conta; falhas anteriores continuam valendo. A senha nunca é logada nem
 * entra em erro.
 */
export class ConfirmUserPasswordUseCase {
  constructor(private readonly deps: ConfirmUserPasswordDeps) {}

  async execute(input: ConfirmUserPasswordInput): Promise<void> {
    const { users, attempts, verifyPassword } = this.deps;
    const { userId, action } = input;
    const now = this.deps.now?.() ?? new Date();

    const attemptId = await attempts.withUserLock(userId, async (repo) => {
      await repo.pruneUser(userId, new Date(now.getTime() - PASSWORD_CONFIRMATION_RETENTION_MS));
      const failures = await repo.failuresSince(userId, new Date(now.getTime() - PASSWORD_CONFIRMATION_LOOKBACK_MS));
      const lock = evaluatePasswordConfirmationLock(failures, now);
      if (lock.locked) throw new PasswordConfirmationLockedError(lock.retryAfterSeconds, now);
      return repo.reserve({ userId, action, createdAt: now });
    });

    let matches: boolean;
    try {
      const user = await users.findById(userId);
      matches = await verifyPassword(input.password, user?.passwordHash ?? null);
    } catch (err) {
      // Falha de infra não pode custar uma tentativa ao usuário.
      await attempts.discard(attemptId).catch(() => undefined);
      throw err;
    }
    if (!matches) throw new InvalidCredentialsError();
    await attempts.markSucceeded(attemptId);
  }
}
