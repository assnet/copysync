import type { IEmailSender } from '../../../integrations/domain/contracts/IEmailSender';
import type { ILoginCodeRepository } from '../../domain/contracts/ILoginProtectionRepository';
import type { ILoginCodeHasher, ILoginTicketSigner } from '../../domain/contracts/ILoginSecurity';
import {
  LOGIN_GUARD_LIMITS,
  evaluateCodeSend,
  loginCodeUsability,
  nextCodeSendAt,
} from '../../domain/services/loginGuardRules';
import type { LoginCodeChallengeDto } from '../dtos/LoginResultDto';
import {
  LoginCodeDeliveryFailedError,
  LoginCodeExhaustedError,
  LoginCodeExpiredError,
  LoginCodeInvalidError,
  LoginCodeSendLimitError,
  LoginTicketInvalidError,
} from '../../../../shared/errors/internal/AuthErrors';
import { logger } from '../../../../shared/logger/logger';

const log = logger.child({ module: 'LoginCodeChallenge' });

/** Template da central (allowlist dela): vars `code` (6 dígitos, string), `expiresInMinutes`, `name?`. */
export const LOGIN_CODE_EMAIL_TEMPLATE = 'LOGIN_VERIFICATION';

export interface LoginCodeUser {
  id: string;
  email: string;
  name: string;
}

/**
 * Código de 6 dígitos por e-mail no login suspeito. Só é chamado DEPOIS da senha certa.
 * Código só em hash no banco; nunca em log nem em resposta. Envio que falha não conta no teto.
 */
export class LoginCodeChallenge {
  constructor(
    private readonly codes: ILoginCodeRepository,
    private readonly hasher: ILoginCodeHasher,
    private readonly tickets: ILoginTicketSigner,
    private readonly emailSender: IEmailSender,
  ) {}

  /**
   * Envia um código novo. `allowReuse` (login): se o teto/intervalo impede o envio mas há um código
   * válido aberto, devolve o ticket sem enviar para o usuário digitar o que já recebeu.
   */
  async start(user: LoginCodeUser, now: number, opts: { allowReuse: boolean }): Promise<LoginCodeChallengeDto> {
    const { windowMs, codeTtlMs } = LOGIN_GUARD_LIMITS;
    const sent = await this.codes.createdSince(user.id, new Date(now - windowMs));
    const decision = evaluateCodeSend(sent, now);
    if (!decision.allowed) {
      if (opts.allowReuse) {
        const open = await this.codes.findLatestOpen(user.id);
        if (open && loginCodeUsability(open, now) === 'USABLE') {
          return { ticket: this.tickets.issue(user.id, codeTtlMs, now), codeSent: false, codeExpiresAt: open.expiresAt, resendAvailableAt: decision.retryAt };
        }
      }
      throw new LoginCodeSendLimitError(decision.retryAt);
    }

    const code = this.hasher.generate();
    const expiresAt = new Date(now + codeTtlMs);
    const pending = await this.codes.createPending({ userId: user.id, codeHash: this.hasher.hash(user.id, code), expiresAt });
    let delivered = false;
    try {
      delivered = (await this.emailSender.send({
        to: user.email,
        template: LOGIN_CODE_EMAIL_TEMPLATE,
        data: { code, expiresInMinutes: Math.round(codeTtlMs / 60_000), name: user.name },
      })).sent;
    } catch (err) {
      log.error({ err: (err as Error)?.name }, 'login code email threw');
    }
    if (!delivered) {
      await this.codes.deletePending(pending.id).catch((err) => log.error({ err: (err as Error)?.name }, 'pending login code cleanup failed'));
      throw new LoginCodeDeliveryFailedError();
    }
    await this.codes.markSent(pending.id, user.id, new Date(now));
    return {
      ticket: this.tickets.issue(user.id, codeTtlMs, now),
      codeSent: true,
      codeExpiresAt: expiresAt,
      resendAvailableAt: nextCodeSendAt([...sent, new Date(now)], now),
    };
  }

  /** userId do ticket ou erro (ticket vencido/adulterado). */
  userIdFromTicket(ticket: string, now: number): string {
    const userId = this.tickets.verify(ticket, now);
    if (!userId) throw new LoginTicketInvalidError();
    return userId;
  }

  /** Confere o código do último envio; 5 erradas invalidam. Devolve o userId provado. */
  async verify(ticket: string, code: string, now: number): Promise<string> {
    const userId = this.userIdFromTicket(ticket, now);
    const open = await this.codes.findLatestOpen(userId);
    if (!open) throw new LoginCodeExpiredError();
    const usability = loginCodeUsability(open, now);
    if (usability === 'EXPIRED') throw new LoginCodeExpiredError();
    if (usability === 'EXHAUSTED') throw new LoginCodeExhaustedError();

    const max = LOGIN_GUARD_LIMITS.maxCodeAttempts;
    const attempts = await this.codes.registerAttempt(open.id, max);
    if (attempts === null) throw new LoginCodeExhaustedError();
    if (this.hasher.matches(userId, code, open.codeHash)) {
      if (!(await this.codes.consume(open.id, new Date(now)))) throw new LoginCodeExpiredError();
      return userId;
    }
    const left = max - attempts;
    if (left <= 0) throw new LoginCodeExhaustedError();
    throw new LoginCodeInvalidError(left);
  }
}
