import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { resolveClientIp } from '../../../../shared/http/clientIp';
import { env } from '../../../../shared/config/env';
import { logger } from '../../../../shared/logger/logger';
import { LoginUseCase } from '../../application/use-cases/LoginUseCase';
import { RefreshTokenUseCase } from '../../application/use-cases/RefreshTokenUseCase';
import { LogoutUseCase } from '../../application/use-cases/LogoutUseCase';
import { CreateLoginSessionUseCase } from '../../application/use-cases/CreateLoginSessionUseCase';
import { VerifyLoginCodeUseCase } from '../../application/use-cases/VerifyLoginCodeUseCase';
import { ResendLoginCodeUseCase } from '../../application/use-cases/ResendLoginCodeUseCase';
import { LoginGuard } from '../../application/services/LoginGuard';
import { LoginCodeChallenge } from '../../application/services/LoginCodeChallenge';
import type { LoginRequestContext } from '../../application/dtos/LoginInputDto';
import type { LoginResultDto } from '../../application/dtos/LoginResultDto';
import { resolveLoginGuardPolicy } from '../../domain/services/loginGuardRules';
import { PrismaAuthRepository } from '../../infrastructure/repositories/PrismaAuthRepository';
import {
  PrismaLoginCodeRepository,
  PrismaLoginEventRepository,
} from '../../infrastructure/repositories/PrismaLoginProtectionRepository';
import { CloudflareTurnstileVerifier } from '../../infrastructure/security/CloudflareTurnstileVerifier';
import { HmacLoginCodeHasher, HmacLoginTicketSigner, createEmailRef } from '../../infrastructure/security/HmacLoginSecurity';
import { bcryptPasswordVerifier } from '../../infrastructure/security/bcryptPasswordVerifier';
import { createEmailSenderFromEnv } from '../../../integrations/infrastructure/email/EmailSenderFactory';
import { PrismaUserRepository } from '../../../users/infrastructure/repositories/PrismaUserRepository';
import { RequestPasswordResetUseCase } from '../../application/use-cases/RequestPasswordResetUseCase';
import { ResetPasswordUseCase } from '../../application/use-cases/ResetPasswordUseCase';
import { PrismaPasswordResetRepository } from '../../infrastructure/repositories/PrismaPasswordResetRepository';
import { PrismaAuditLogRepository } from '../../../../shared/audit/PrismaAuditLogRepository';
import { passwordResetRoutes } from './passwordReset.routes';
import { AuthPresenter } from '../presenters/AuthPresenter';
import {
  loginBodySchema,
  refreshBodySchema,
  logoutBodySchema,
  loginVerifyBodySchema,
  loginResendBodySchema,
  loginCodeChallengeResponseSchema,
} from '../schemas/auth.schema';
import type { LoginInputDto } from '../../application/dtos/LoginInputDto';

const userRepo = new PrismaUserRepository();
const authRepo = new PrismaAuthRepository();
const loginPolicy = resolveLoginGuardPolicy(env);
for (const warning of loginPolicy.warnings) logger.warn({ module: 'auth' }, warning);
const loginGuard = new LoginGuard(
  new PrismaLoginEventRepository(),
  loginPolicy.requireTurnstile && env.TURNSTILE_SECRET_KEY
    ? new CloudflareTurnstileVerifier(env.TURNSTILE_SECRET_KEY, { expectedHostname: env.PANEL_URL ? new URL(env.PANEL_URL).hostname : undefined })
    : null,
  loginPolicy,
  createEmailRef(env.JWT_SECRET),
);
/** Config pública do login para o painel: site key só quando o Turnstile é exigido. */
const loginConfig = {
  mode: loginPolicy.mode,
  turnstileSiteKey: loginPolicy.requireTurnstile ? env.TURNSTILE_SITE_KEY ?? null : null,
  emailCode: loginPolicy.requireEmailCode,
};
const emailSender = createEmailSenderFromEnv();
const loginChallenge = new LoginCodeChallenge(
  new PrismaLoginCodeRepository(),
  new HmacLoginCodeHasher(env.JWT_SECRET),
  new HmacLoginTicketSigner(env.JWT_SECRET),
  emailSender,
);
const passwordResetRepo = new PrismaPasswordResetRepository();
const requestPasswordReset = new RequestPasswordResetUseCase(
  userRepo, passwordResetRepo, loginGuard, emailSender, env.PANEL_URL, createEmailRef(env.JWT_SECRET),
);
const resetPassword = new ResetPasswordUseCase(userRepo, passwordResetRepo, loginGuard, new PrismaAuditLogRepository());
const createLoginSession = new CreateLoginSessionUseCase(userRepo, authRepo);
const loginUseCase = new LoginUseCase(userRepo, loginGuard, loginChallenge, createLoginSession, bcryptPasswordVerifier);
const verifyLoginCodeUseCase = new VerifyLoginCodeUseCase(userRepo, loginGuard, loginChallenge, createLoginSession);
const resendLoginCodeUseCase = new ResendLoginCodeUseCase(userRepo, loginChallenge);
const refreshTokenUseCase = new RefreshTokenUseCase(authRepo, userRepo);
const logoutUseCase = new LogoutUseCase(authRepo);

const requestContext = (request: FastifyRequest): LoginRequestContext => {
  const ua = request.headers['user-agent'];
  return { ip: resolveClientIp(request), userAgent: (Array.isArray(ua) ? ua[0] : ua) ?? null };
};

async function sendSession(reply: FastifyReply, result: LoginResultDto): Promise<void> {
  const accessToken = await reply.jwtSign({ userId: result.userId, isSuperAdmin: result.isSuperAdmin });
  httpResponse.ok(reply, AuthPresenter.toLoginResponse(result, accessToken));
}

/**
 * Auth routes — no tenant scope needed.
 * Registered under /api/auth.
 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Recuperação de senha (docs/recuperacao-de-senha.md): /auth/password/*
  await app.register(passwordResetRoutes, { requestPasswordReset, resetPassword });

  // ── GET /auth/login/config ─────────────────────────────────────────────────
  // Público: o painel decide se mostra o widget. Sem a site key aqui o Turnstile não é exigido.
  app.get(
    '/login/config',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Configuração pública do login',
        description: 'Modo da proteção, site key do Turnstile (null quando não exigido) e se o código por e-mail está ligado.',
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  mode: { type: 'string', enum: ['off', 'monitor', 'enforce'] },
                  turnstileSiteKey: { type: ['string', 'null'] },
                  emailCode: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      reply.header('Cache-Control', 'public, max-age=60');
      httpResponse.ok(reply, loginConfig);
      return reply;
    },
  );

  // ── POST /auth/login ───────────────────────────────────────────────────────
  // Proteção: docs/seguranca-login.md (bloqueio 429, Turnstile, código por e-mail no login suspeito).
  app.post(
    '/login',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Autenticar usuário',
        description:
          'Retorna access token JWT e refresh token. Login suspeito (com LOGIN_GUARD_MODE=enforce e LOGIN_EMAIL_OTP=on) '
          + 'responde 202 OTP_REQUIRED com ticket; o código vai por e-mail e é confirmado em /auth/login/verify.',
        body: loginBodySchema,
        response: {
          200: { $ref: 'LoginResponse#' },
          202: loginCodeChallengeResponseSchema,
          401: { $ref: 'ErrorResponse#' },
          403: { $ref: 'ErrorResponse#' },
          429: { $ref: 'ErrorResponse#' },
          503: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const outcome = await loginUseCase.execute(request.body as LoginInputDto, requestContext(request));
      if (outcome.kind === 'CODE_REQUIRED') {
        httpResponse.accepted(reply, AuthPresenter.toCodeChallengeResponse(outcome.challenge));
        return reply;
      }
      await sendSession(reply, outcome.result);
      return reply;
    },
  );

  // ── POST /auth/login/verify ────────────────────────────────────────────────
  app.post(
    '/login/verify',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Confirmar código do login',
        description: 'Confere o código de 6 dígitos enviado por e-mail e emite os tokens normais.',
        body: loginVerifyBodySchema,
        response: {
          200: { $ref: 'LoginResponse#' },
          400: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const result = await verifyLoginCodeUseCase.execute(request.body as { ticket: string; code: string }, requestContext(request));
      await sendSession(reply, result);
      return reply;
    },
  );

  // ── POST /auth/login/resend ────────────────────────────────────────────────
  app.post(
    '/login/resend',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Reenviar código do login',
        description: 'Envia um novo código (máximo 3 por hora por usuário, com intervalo entre envios).',
        body: loginResendBodySchema,
        response: {
          202: loginCodeChallengeResponseSchema,
          400: { $ref: 'ErrorResponse#' },
          429: { $ref: 'ErrorResponse#' },
          503: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const challenge = await resendLoginCodeUseCase.execute(request.body as { ticket: string });
      httpResponse.accepted(reply, AuthPresenter.toCodeChallengeResponse(challenge));
      return reply;
    },
  );

  // ── POST /auth/refresh ─────────────────────────────────────────────────────
  app.post(
    '/refresh',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Renovar access token',
        description: 'Recebe um refresh token válido e retorna um novo access token.',
        body: refreshBodySchema,
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  accessToken: { type: 'string' },
                },
              },
            },
          },
          401: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { refreshToken } = request.body as { refreshToken: string };
      const result = await refreshTokenUseCase.execute(refreshToken);
      const accessToken = await reply.jwtSign({
        userId: result.userId,
        isSuperAdmin: result.isSuperAdmin,
      });
      httpResponse.ok(reply, AuthPresenter.toRefreshResponse(accessToken));
    },
  );

  // ── POST /auth/logout ──────────────────────────────────────────────────────
  app.post(
    '/logout',
    {
      preHandler: [authHook],
      schema: {
        tags: ['Auth'],
        summary: 'Encerrar sessão',
        description: 'Invalida o refresh token informado.',
        security: [{ bearerAuth: [] }],
        body: logoutBodySchema,
        response: {
          204: { type: 'null', description: 'Logout realizado com sucesso.' },
          401: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { refreshToken } = request.body as { refreshToken: string };
      await logoutUseCase.execute(refreshToken);
      httpResponse.noContent(reply);
    },
  );
}
