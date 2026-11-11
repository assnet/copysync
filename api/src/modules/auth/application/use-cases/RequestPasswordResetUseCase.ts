import type { IEmailSender } from '../../../integrations/domain/contracts/IEmailSender';
import type { IUserRepository } from '../../../users/domain/contracts/IUserRepository';
import type { IPasswordResetRepository } from '../../domain/contracts/IPasswordResetRepository';
import type { EmailRef } from '../../domain/contracts/ILoginSecurity';
import { PASSWORD_RESET_LIMITS, evaluatePasswordResetRequest } from '../../domain/services/passwordResetRules';
import type { LoginGuard } from '../services/LoginGuard';
import type { LoginRequestContext } from '../dtos/LoginInputDto';
import { PasswordResetTooManyRequestsError } from '../../../../shared/errors/internal/AuthErrors';
import { generateInviteToken } from '../../../../shared/utils/generateInviteToken';
import { normalizeEmail } from '../../../../shared/utils/normalizeEmail';
import { logger } from '../../../../shared/logger/logger';

const log = logger.child({ module: 'RequestPasswordReset' });
const PRUNE_PROBABILITY = 0.01;

/** Template interno do e-mail; mapeado para a central em `hubEmailMapping.ts`. */
export const PASSWORD_RESET_EMAIL_TEMPLATE = 'RESET_PASSWORD';

export interface RequestPasswordResetInput {
  email: string;
  turnstileToken?: string;
}

/**
 * "Esqueci minha senha" (docs/recuperacao-de-senha.md). Nunca revela se o e-mail tem conta: o
 * desfecho é o mesmo (void) e busca da conta, token e e-mail rodam sem `await` (`deliver`), então o
 * tempo de resposta não depende de a conta existir.
 * O pedido é gravado ANTES de avaliar o teto (pedidos paralelos se enxergam), exista ou não a conta.
 */
export class RequestPasswordResetUseCase {
  constructor(
    private readonly users: IUserRepository,
    private readonly resets: IPasswordResetRepository,
    private readonly guard: Pick<LoginGuard, 'assertHuman'>,
    private readonly emailSender: IEmailSender,
    private readonly panelUrl: string | undefined,
    private readonly emailRef: EmailRef,
    private readonly random: () => number = Math.random,
  ) {}

  async execute(input: RequestPasswordResetInput, ctx: LoginRequestContext, now: number = Date.now()): Promise<void> {
    await this.guard.assertHuman(input.turnstileToken, ctx);
    const email = normalizeEmail(input.email);
    const { windowMs, retentionMs } = PASSWORD_RESET_LIMITS;

    const id = await this.resets.record({ email, ip: ctx.ip });
    const since = new Date(now - windowMs);
    const [emailRequests, ipRequests] = await Promise.all([
      this.resets.emailRequestsSince(email, since, id),
      ctx.ip ? this.resets.ipRequestsSince(ctx.ip, since, id) : Promise.resolve([]),
    ]);
    const decision = evaluatePasswordResetRequest({ emailRequests, ipRequests, now });
    if (!decision.allowed) {
      await this.resets.discard(id).catch((err) => log.error({ err: (err as Error)?.name }, 'password reset discard failed'));
      log.warn({ emailRef: this.emailRef(email), ip: ctx.ip, reason: decision.reason }, 'password reset request blocked');
      throw new PasswordResetTooManyRequestsError(decision.retryAt);
    }
    if (this.random() < PRUNE_PROBABILITY) {
      void this.resets.prune(new Date(now - retentionMs)).catch((err) => log.warn({ err: (err as Error)?.name }, 'password reset prune failed'));
    }

    // Tudo que depende de existir conta (busca, token, e-mail) roda SEM await: o tempo de resposta é
    // o mesmo com ou sem conta. Falha só vai para o log (o usuário pede de novo).
    void this.deliver(id, email, now).catch((err) => log.error({ err: (err as Error)?.name }, 'password reset delivery failed'));
  }

  private async deliver(id: string, email: string, now: number): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user) return;
    if (!this.panelUrl) {
      log.error('PANEL_URL ausente: link de redefinição não enviado');
      return;
    }

    const { token, tokenHash } = generateInviteToken();
    const expiresAt = new Date(now + PASSWORD_RESET_LIMITS.tokenTtlMs);
    await this.resets.attachToken(id, { userId: user.id, tokenHash, expiresAt });

    const result = await this.emailSender.send({
      to: user.email,
      template: PASSWORD_RESET_EMAIL_TEMPLATE,
      data: { name: user.name, link: `${this.panelUrl}/reset-password/${token}`, expiresAt: expiresAt.toISOString() },
    });
    if (!result.sent) log.error({ emailRef: this.emailRef(email) }, 'password reset email not sent');
  }
}
