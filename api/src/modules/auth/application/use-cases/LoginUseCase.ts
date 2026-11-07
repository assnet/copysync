import type { IUserRepository } from '../../../users/domain/contracts/IUserRepository';
import type { LoginInputDto, LoginRequestContext } from '../dtos/LoginInputDto';
import type { LoginOutcomeDto } from '../dtos/LoginResultDto';
import { InvalidCredentialsError } from '../../../../shared/errors/internal/AuthErrors';
import { verifyPassword } from '../../../../shared/utils/hash';
import { normalizeLoginEmail } from '../../domain/services/loginGuardRules';
import type { LoginGuard } from '../services/LoginGuard';
import type { LoginCodeChallenge } from '../services/LoginCodeChallenge';
import type { CreateLoginSessionUseCase } from './CreateLoginSessionUseCase';

/**
 * Login por e-mail e senha com a proteção de docs/seguranca-login.md:
 * bloqueio (429) → Turnstile → senha → [suspeito] código por e-mail → sessão.
 * O código só é enviado depois da senha CORRETA; senha errada nunca dispara e-mail.
 * Erro de credencial é sempre genérico (não revela se o e-mail existe).
 */
export class LoginUseCase {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly guard: LoginGuard,
    private readonly challenge: LoginCodeChallenge,
    private readonly createSession: CreateLoginSessionUseCase,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  async execute(input: LoginInputDto, ctx: LoginRequestContext): Promise<LoginOutcomeDto> {
    const now = this.clock();
    const email = normalizeLoginEmail(input.email);

    await this.guard.assertAllowed(email, ctx, now);
    await this.guard.assertHuman(input.turnstileToken, ctx);

    const user = await this.userRepo.findByEmail(input.email);
    const valid = !!user?.passwordHash && (await verifyPassword(input.password, user.passwordHash));
    if (!user || !valid) {
      await this.guard.recordFailure(email, ctx, now);
      throw new InvalidCredentialsError();
    }

    if (await this.guard.requiresEmailCode(email, now)) {
      const challenge = await this.challenge.start({ id: user.id, email: user.email, name: user.name }, now, { allowReuse: true });
      return { kind: 'CODE_REQUIRED', challenge };
    }

    await this.guard.recordSuccess('LOGIN_OK', email, user.id, ctx);
    return { kind: 'SESSION', result: await this.createSession.execute(user) };
  }
}
