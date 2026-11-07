import type { IUserRepository } from '../../../users/domain/contracts/IUserRepository';
import type { PasswordVerifier } from '../../domain/contracts/ILoginSecurity';
import type { LoginInputDto, LoginRequestContext } from '../dtos/LoginInputDto';
import type { LoginOutcomeDto } from '../dtos/LoginResultDto';
import { InvalidCredentialsError } from '../../../../shared/errors/internal/AuthErrors';
import { normalizeLoginEmail } from '../../domain/services/loginGuardRules';
import type { LoginGuard } from '../services/LoginGuard';
import type { LoginCodeChallenge } from '../services/LoginCodeChallenge';
import type { CreateLoginSessionUseCase } from './CreateLoginSessionUseCase';

/**
 * Login por e-mail e senha com a proteção de docs/seguranca-login.md:
 * Turnstile → reserva da tentativa (429 no teto) → senha → [suspeito] código por e-mail → sessão.
 * O código só é enviado depois da senha CORRETA; senha errada nunca dispara e-mail.
 * Erro de credencial é sempre genérico; usuário inexistente também paga um bcrypt (sem oráculo por tempo).
 */
export class LoginUseCase {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly guard: LoginGuard,
    private readonly challenge: LoginCodeChallenge,
    private readonly createSession: CreateLoginSessionUseCase,
    private readonly verifyPassword: PasswordVerifier,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  async execute(input: LoginInputDto, ctx: LoginRequestContext): Promise<LoginOutcomeDto> {
    const now = this.clock();
    const email = normalizeLoginEmail(input.email);

    await this.guard.assertHuman(input.turnstileToken, ctx);
    const attempt = await this.guard.begin(email, ctx, now);
    let failed = false;
    try {
      const user = await this.userRepo.findByEmail(input.email);
      const valid = await this.verifyPassword(input.password, user?.passwordHash ?? null);
      if (!user || !user.passwordHash || !valid) {
        failed = true;
        await this.guard.fail(attempt, email, ctx, now);
        throw new InvalidCredentialsError();
      }

      if (await this.guard.requiresEmailCode(email, now)) {
        const challenge = await this.challenge.start({ id: user.id, email: user.email, name: user.name }, now, { allowReuse: true });
        return { kind: 'CODE_REQUIRED', challenge };
      }

      await this.guard.recordSuccess('LOGIN_OK', email, user.id, ctx);
      return { kind: 'SESSION', result: await this.createSession.execute(user) };
    } finally {
      if (!failed) await this.guard.settle(attempt);
    }
  }
}
