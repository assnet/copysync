import type { IUserRepository } from '../../../users/domain/contracts/IUserRepository';
import type { LoginRequestContext } from '../dtos/LoginInputDto';
import type { LoginResultDto } from '../dtos/LoginResultDto';
import { LoginTicketInvalidError } from '../../../../shared/errors/internal/AuthErrors';
import { normalizeLoginEmail } from '../../domain/services/loginGuardRules';
import type { LoginGuard } from '../services/LoginGuard';
import type { LoginCodeChallenge } from '../services/LoginCodeChallenge';
import type { CreateLoginSessionUseCase } from './CreateLoginSessionUseCase';

/** Código certo → sessão normal; zera a contagem de falhas do e-mail (evento LOGIN_CODE_VERIFIED). */
export class VerifyLoginCodeUseCase {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly guard: LoginGuard,
    private readonly challenge: LoginCodeChallenge,
    private readonly createSession: CreateLoginSessionUseCase,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  async execute(input: { ticket: string; code: string }, ctx: LoginRequestContext): Promise<LoginResultDto> {
    const userId = await this.challenge.verify(input.ticket, input.code, this.clock());
    const user = await this.userRepo.findById(userId);
    if (!user) throw new LoginTicketInvalidError();
    await this.guard.recordSuccess('LOGIN_CODE_VERIFIED', normalizeLoginEmail(user.email), user.id, ctx);
    return this.createSession.execute(user);
  }
}
