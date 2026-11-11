import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { resolveClientIp } from '../../../../shared/http/clientIp';
import type { RequestPasswordResetInput, RequestPasswordResetUseCase } from '../../application/use-cases/RequestPasswordResetUseCase';
import type { ResetPasswordUseCase } from '../../application/use-cases/ResetPasswordUseCase';
import type { LoginRequestContext } from '../../application/dtos/LoginInputDto';
import { passwordForgotBodySchema, passwordResetBodySchema, passwordResetInspectBodySchema } from '../schemas/auth.schema';

export interface PasswordResetRoutesOptions {
  requestPasswordReset: Pick<RequestPasswordResetUseCase, 'execute'>;
  resetPassword: Pick<ResetPasswordUseCase, 'inspect' | 'execute'>;
}

const requestContext = (request: FastifyRequest): LoginRequestContext => {
  const ua = request.headers['user-agent'];
  return { ip: resolveClientIp(request), userAgent: (Array.isArray(ua) ? ua[0] : ua) ?? null };
};

const statusResponse = (status: string) => ({
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: { type: 'object', properties: { status: { type: 'string', enum: [status] } } },
  },
});

/**
 * Recuperação de senha — públicas, sem tenant. Registradas sob /api/auth por `authRoutes`.
 * O token do link vai SEMPRE no corpo: a URL é gravada no log de requisições.
 * Doc: docs/recuperacao-de-senha.md.
 */
export async function passwordResetRoutes(app: FastifyInstance, opts: PasswordResetRoutesOptions): Promise<void> {
  // ── POST /auth/password/forgot ─────────────────────────────────────────────
  app.post(
    '/password/forgot',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Pedir link de redefinição de senha',
        description: 'Resposta sempre 202, exista ou não a conta. Teto: 3/h por e-mail e 10/h por IP (429 com retryAt).',
        body: passwordForgotBodySchema,
        response: {
          202: statusResponse('ACCEPTED'),
          403: { $ref: 'ErrorResponse#' },
          429: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await opts.requestPasswordReset.execute(request.body as RequestPasswordResetInput, requestContext(request));
      httpResponse.accepted(reply, { status: 'ACCEPTED' });
      return reply;
    },
  );

  // ── POST /auth/password/reset/inspect ──────────────────────────────────────
  app.post(
    '/password/reset/inspect',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Conferir link de redefinição',
        body: passwordResetInspectBodySchema,
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: { email: { type: 'string' }, expiresAt: { type: 'string', format: 'date-time' } },
              },
            },
          },
          404: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const info = await opts.resetPassword.inspect((request.body as { token: string }).token);
      reply.header('Cache-Control', 'no-store');
      httpResponse.ok(reply, { email: info.email, expiresAt: info.expiresAt.toISOString() });
      return reply;
    },
  );

  // ── POST /auth/password/reset ──────────────────────────────────────────────
  app.post(
    '/password/reset',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Definir a nova senha',
        description: 'Link de uso único. Encerra as sessões abertas da conta.',
        body: passwordResetBodySchema,
        response: {
          200: statusResponse('RESET'),
          400: { $ref: 'ErrorResponse#' },
          404: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { token: string; password: string; confirmPassword: string };
      await opts.resetPassword.execute(body, requestContext(request));
      httpResponse.ok(reply, { status: 'RESET' });
      return reply;
    },
  );
}
