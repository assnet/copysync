import type { ILoginEventRepository, LoginEventType } from '../../domain/contracts/ILoginProtectionRepository';
import type { EmailRef, ITurnstileVerifier } from '../../domain/contracts/ILoginSecurity';
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
/** Códigos guardados ≥ 24 h: o teto diário de códigos esgotados lê essa janela. */
const CODE_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;
const PRUNE_PROBABILITY = 0.01;

/** Tentativa em andamento (linha LOGIN_ATTEMPT); null = guarda desligada ou banco indisponível. */
export type LoginAttempt = { id: string } | null;

/**
 * Bloqueio por tentativas, Turnstile e suspeita do e-mail (docs/seguranca-login.md).
 *
 * Corrida: a tentativa é gravada ANTES de conferir a senha e o teto conta as tentativas em andamento.
 * Quem grava na posição r vê ao menos r-1 outras, então logins paralelos nunca conferem mais senhas
 * que o limite (sem trava de banco segurando conexão durante o bcrypt).
 * Falha de banco só vai para o log: a guarda não derruba o login. Modo `off` = no-op.
 */
export class LoginGuard {
  constructor(
    private readonly events: ILoginEventRepository,
    private readonly turnstile: ITurnstileVerifier | null,
    private readonly policy: LoginGuardPolicy,
    private readonly emailRef: EmailRef,
    private readonly random: () => number = Math.random,
  ) {}

  /** Turnstile só em enforce com site key + secret; sem o par o passo é pulado (aviso no boot). */
  async assertHuman(token: string | undefined, ctx: LoginRequestContext): Promise<void> {
    if (!this.policy.requireTurnstile || !this.turnstile) return;
    if (!token) throw new LoginCaptchaRequiredError();
    const r = await this.turnstile.verify(token, ctx.ip);
    if (!r.success) {
      log.warn({ ip: ctx.ip, errors: (r.errorCodes ?? []).join(',') }, 'turnstile rejected');
      throw new LoginCaptchaInvalidError();
    }
  }

  /** Reserva a tentativa; 429 se e-mail ou IP já estão no teto (contando as em andamento). */
  async begin(email: string, ctx: LoginRequestContext, now: number): Promise<LoginAttempt> {
    if (!this.policy.enforceBlock) return null;
    let id: string;
    try {
      id = await this.record('LOGIN_ATTEMPT', email, null, ctx);
    } catch (err) {
      log.error({ err: (err as Error)?.name }, 'login attempt write failed; continuing without block');
      return null;
    }
    let decision;
    try {
      decision = await this.evaluate(email, ctx.ip, now, id);
    } catch (err) {
      log.error({ err: (err as Error)?.name }, 'login guard read failed; continuing without block');
      return { id };
    }
    if (!decision.blocked) return { id };
    await this.settle({ id });
    log.warn({ emailRef: this.emailRef(email), ip: ctx.ip, reason: decision.reason }, 'login blocked');
    throw new LoginTooManyAttemptsError(decision.retryAt);
  }

  /** Senha errada: a tentativa vira LOGIN_FAILED (sem userId); 429 se ela completou o teto. */
  async fail(attempt: LoginAttempt, email: string, ctx: LoginRequestContext, now: number): Promise<void> {
    if (!attempt) return;
    try {
      await this.events.markAttemptFailed(attempt.id);
      const decision = await this.evaluate(email, ctx.ip, now);
      if (!decision.blocked) return;
      log.warn({ emailRef: this.emailRef(email), ip: ctx.ip, reason: decision.reason }, 'login blocked');
      throw new LoginTooManyAttemptsError(decision.retryAt);
    } catch (err) {
      if (err instanceof LoginTooManyAttemptsError) throw err;
      log.error({ err: (err as Error)?.name }, 'login failure write failed');
    }
  }

  /** Tentativa terminou sem falha de senha (sucesso, código pedido, erro): some da contagem. */
  async settle(attempt: LoginAttempt): Promise<void> {
    if (!attempt) return;
    await this.events.discardAttempt(attempt.id).catch((err) => log.error({ err: (err as Error)?.name }, 'login attempt discard failed'));
  }

  async recordSuccess(type: 'LOGIN_OK' | 'LOGIN_CODE_VERIFIED' | 'PASSWORD_RESET_OK', email: string, userId: string, ctx: LoginRequestContext): Promise<void> {
    if (!this.policy.enforceBlock) return;
    await this.record(type, email, userId, ctx).catch((err) => log.error({ err: (err as Error)?.name, type }, 'login event write failed'));
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
      log.warn({ emailRef: this.emailRef(email), mode: this.policy.mode }, 'suspicious login would require email code');
      return false;
    }
    return true;
  }

  private async evaluate(email: string, ip: string | null, now: number, excludeId?: string) {
    const since = new Date(now - LOGIN_GUARD_LIMITS.windowMs);
    const q = { includePending: true, excludeId };
    const [emailFailures, ipFailures] = await Promise.all([
      email ? this.events.emailFailuresSince(email, since, true, q) : Promise.resolve([]),
      ip ? this.events.ipFailuresSince(ip, since, q) : Promise.resolve([]),
    ]);
    return evaluateLoginBlock({ emailFailures, ipFailures, now });
  }

  private async record(type: LoginEventType, email: string, userId: string | null, ctx: LoginRequestContext): Promise<string> {
    const id = await this.events.record({ type, email, ip: ctx.ip, userId, userAgent: ctx.userAgent?.slice(0, 255) || null });
    if (this.random() < PRUNE_PROBABILITY) {
      const t = Date.now();
      void this.events
        .prune(new Date(t - EVENT_RETENTION_MS), new Date(t - CODE_RETENTION_MS))
        .catch((err) => log.warn({ err: (err as Error)?.name }, 'login events prune failed'));
    }
    return id;
  }
}
