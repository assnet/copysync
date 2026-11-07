import type { IUserRepository } from '../../../users/domain/contracts/IUserRepository';
import type { LoginCodeChallengeDto } from '../dtos/LoginResultDto';
import { LoginTicketInvalidError } from '../../../../shared/errors/internal/AuthErrors';
import type { LoginCodeChallenge } from '../services/LoginCodeChallenge';

/** Reenvio do código com o ticket do passo; respeita o teto (3/h) e o intervalo entre envios. */
export class ResendLoginCodeUseCase {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly challenge: LoginCodeChallenge,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  async execute(input: { ticket: string }): Promise<LoginCodeChallengeDto> {
    const now = this.clock();
    const userId = this.challenge.userIdFromTicket(input.ticket, now);
    const user = await this.userRepo.findById(userId);
    if (!user) throw new LoginTicketInvalidError();
    return this.challenge.start({ id: user.id, email: user.email, name: user.name }, now, { allowReuse: false });
  }
}
