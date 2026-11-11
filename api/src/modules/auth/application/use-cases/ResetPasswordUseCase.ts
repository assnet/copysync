import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import type { IUserRepository } from '../../../users/domain/contracts/IUserRepository';
import type { IPasswordResetRepository } from '../../domain/contracts/IPasswordResetRepository';
import { isPasswordResetUsable } from '../../domain/services/passwordResetRules';
import type { LoginGuard } from '../services/LoginGuard';
import type { LoginRequestContext } from '../dtos/LoginInputDto';
import { PasswordMismatchError, PasswordResetInvalidError } from '../../../../shared/errors/internal/AuthErrors';
import { hashInviteToken } from '../../../../shared/utils/generateInviteToken';
import { hashPassword } from '../../../../shared/utils/hash';
import { validatePasswordPolicy } from '../../../../shared/utils/passwordPolicy';
import { logger } from '../../../../shared/logger/logger';

const log = logger.child({ module: 'ResetPassword' });

export interface PasswordResetInfo {
  email: string;
  expiresAt: Date;
}

export interface ResetPasswordInput {
  token: string;
  password: string;
  confirmPassword: string;
}

/**
 * Redefinição pelo link do e-mail (docs/recuperacao-de-senha.md). O token é a prova de posse do
 * e-mail: grava a senha nova, encerra as sessões abertas (refresh tokens) e zera a contagem de
 * falhas do login. Link inexistente/vencido/usado = mesmo erro.
 */
export class ResetPasswordUseCase {
  constructor(
    private readonly users: IUserRepository,
    private readonly resets: IPasswordResetRepository,
    private readonly guard: Pick<LoginGuard, 'recordSuccess'>,
    private readonly audit: Pick<IAuditLogRepository, 'create'>,
  ) {}

  /** Dados para a tela (o link já prova a posse do e-mail). */
  async inspect(token: string, now: number = Date.now()): Promise<PasswordResetInfo> {
    const { user, row } = await this.resolve(token, now);
    return { email: user.email, expiresAt: row.expiresAt! };
  }

  async execute(input: ResetPasswordInput, ctx: LoginRequestContext, now: number = Date.now()): Promise<void> {
    const { user, row } = await this.resolve(input.token, now);
    validatePasswordPolicy(input.password);
    if (input.password !== input.confirmPassword) throw new PasswordMismatchError();

    // bcrypt fora da transação; o consumo atômico decide a corrida.
    const passwordHash = await hashPassword(input.password);
    const done = await this.resets.consumeAndSetPassword({ id: row.id, userId: user.id, passwordHash, now: new Date(now) });
    if (!done) throw new PasswordResetInvalidError();

    await this.guard.recordSuccess('PASSWORD_RESET_OK', user.email, user.id, ctx);
    await this.audit
      .create({ userId: user.id, action: 'PASSWORD_RESET_COMPLETED', meta: { requestId: row.id } })
      .catch((err) => log.error({ err: (err as Error)?.name }, 'password reset audit failed'));
  }

  private async resolve(token: string, now: number) {
    const row = await this.resets.findByTokenHash(hashInviteToken(token));
    if (!row || !isPasswordResetUsable(row, now)) throw new PasswordResetInvalidError();
    const user = await this.users.findById(row.userId!);
    if (!user) throw new PasswordResetInvalidError();
    return { user, row };
  }
}
