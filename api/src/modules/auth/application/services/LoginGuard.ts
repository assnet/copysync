import crypto from 'node:crypto';
import type { ILoginEventRepository, LoginEventType } from '../../domain/contracts/ILoginProtectionRepository';
import type { ITurnstileVerifier } from '../../domain/contracts/ILoginSecurity';
import {
  LOGIN_GUARD_LIMITS,
  evaluateLoginBlock,
  isEmailSuspicious,
  type LoginGuardPolicy,
} from '../../domain/services/loginGuardRules';
import type { LoginRequestContext } from '../dtos/LoginInputDto';
import {
  LoginCaptchaInvalidError,
  LoginCaptchaRequiredError,
  LoginTooManyAttemptsError,
} from '../../../../shared/errors/internal/AuthErrors';
import { logger } from '../../../../shared/logger/logger';

const log = logger.child({ module: 'LoginGuard' });

const EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_RETENTION_MS = 24 * 60 * 60 * 1000;
const PRUNE_PROBABILITY = 0.01;

/** Correlação no log sem gravar o e-mail (dado pessoal). */
const emailRef = (email: string) => crypto.createHash('sha256').update(email).digest('hex').slice(0, 12);

/**
 * Bloqueio por tentativas, Turnstile e suspeita do e-mail (docs/seguranca-login.md).
 * Leitura do banco que falha só vai para o log: a guarda não derruba o login.
 * Modo `off` = todos os métodos são no-op (comportamento antigo).
 */
export class LoginGuard {
  constructor(
    private readonly events: ILoginEventRepository,
    private readonly turnstile: ITurnstileVerifier | null,
    private readonly policy: LoginGuardPolicy,
    private readonly random: () => number = Math.random,
  ) {}

  /** 429 enquanto o e-mail ou o IP estiver no teto de falhas da janela. */
  async assertAllowed(email: string, ctx: LoginRequestContext, now: number): Promise<void> {
    if (!this.policy.enforceBlock) return;
    let decision;
    try {
      decision = await this.evaluate(email, ctx.ip, now);
    } catch (err) {
      log.error({ err: (err as Error)?.name }, 'login guard read failed; continuing without block');
      return;
    }
    if (!decision.blocked) return;
    log.warn({ emailRef: emailRef(email), ip: ctx.ip, reason: decision.reason }, 'login blocked');
    throw new LoginTooManyAttemptsError(decision.retryAt);
  }

  /** Turnstile só em enforce com secret; sem ela o passo é pulado (aviso no boot). */
  async assertHuman(token: string | undefined, ctx: LoginRequestContext): Promise<void> {
    if (!this.policy.requireTurnstile || !this.turnstile) return;
    if (!token) throw new LoginCaptchaRequiredError();
    const r = await this.turnstile.verify(token, ctx.ip);
    if (!r.success) {
      log.warn({ ip: ctx.ip, errors: (r.errorCodes ?? []).join(',') }, 'turnstile rejected');
      throw new LoginCaptchaInvalidError();
    }
  }

  /** Grava a falha (sem userId) e devolve 429 se ela completou o teto. */
  async recordFailure(email: string, ctx: LoginRequestContext, now: number): Promise<void> {
    if (!this.policy.enforceBlock) return;
    if (!(await this.record('LOGIN_FAILED', email, null, ctx))) return;
    await this.assertAllowed(email, ctx, now);
  }

  async recordSuccess(type: Exclude<LoginEventType, 'LOGIN_FAILED'>, email: string, userId: string, ctx: LoginRequestContext): Promise<void> {
    if (!this.policy.enforceBlock) return;
    await this.record(type, email, userId, ctx);
  }

  /** Senha certa: pedir código? Só em enforce + LOGIN_EMAIL_OTP; em monitor só registra no log. */
  async requiresEmailCode(email: string, now: number): Promise<boolean> {
    if (!this.policy.enforceBlock) return false;
    let suspicious: boolean;
    try {
      const since = new Date(now - LOGIN_GUARD_LIMITS.suspicionLookbackMs);
      suspicious = isEmailSuspicious(await this.events.emailFailuresSince(email, since, true), now);
    } catch (err) {
      log.error({ err: (err as Error)?.name }, 'login suspicion read failed; continuing without code');
      return false;
    }
    if (!suspicious) return false;
    if (!this.policy.requireEmailCode) {
      log.warn({ emailRef: emailRef(email), mode: this.policy.mode }, 'suspicious login would require email code');
      return false;
    }
    return true;
  }

  private async evaluate(email: string, ip: string | null, now: number) {
    const since = new Date(now - LOGIN_GUARD_LIMITS.windowMs);
    const [emailFailures, ipFailures] = await Promise.all([
      email ? this.events.emailFailuresSince(email, since, true) : Promise.resolve([]),
      ip ? this.events.ipFailuresSince(ip, since) : Promise.resolve([]),
    ]);
    return evaluateLoginBlock({ emailFailures, ipFailures, now });
  }

  private async record(type: LoginEventType, email: string, userId: string | null, ctx: LoginRequestContext): Promise<boolean> {
    try {
      await this.events.record({ type, email, ip: ctx.ip, userId, userAgent: ctx.userAgent?.slice(0, 255) || null });
    } catch (err) {
      log.error({ err: (err as Error)?.name, type }, 'login event write failed');
      return false;
    }
    if (this.random() < PRUNE_PROBABILITY) {
      const now = Date.now();
      void this.events
        .prune(new Date(now - EVENT_RETENTION_MS), new Date(now - CODE_RETENTION_MS))
        .catch((err) => log.warn({ err: (err as Error)?.name }, 'login events prune failed'));
    }
    return true;
  }
}
