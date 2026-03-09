import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authHook } from '../../../../shared/http/hooks/authHook';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { LoginUseCase } from '../../application/use-cases/LoginUseCase';
import { RefreshTokenUseCase } from '../../application/use-cases/RefreshTokenUseCase';
import { LogoutUseCase } from '../../application/use-cases/LogoutUseCase';
import { PrismaAuthRepository } from '../../infrastructure/repositories/PrismaAuthRepository';
import { PrismaUserRepository } from '../../../users/infrastructure/repositories/PrismaUserRepository';
import { AuthPresenter } from '../presenters/AuthPresenter';
import { loginBodySchema, refreshBodySchema, logoutBodySchema } from '../schemas/auth.schema';
import type { LoginInputDto } from '../../application/dtos/LoginInputDto';

const userRepo = new PrismaUserRepository();
const authRepo = new PrismaAuthRepository();
const loginUseCase = new LoginUseCase(userRepo, authRepo);
const refreshTokenUseCase = new RefreshTokenUseCase(authRepo, userRepo);
const logoutUseCase = new LogoutUseCase(authRepo);

/**
 * Auth routes — no tenant scope needed.
 * Registered under /api/auth.
 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /auth/login ───────────────────────────────────────────────────────
  app.post(
    '/login',
    { schema: { body: loginBodySchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const input = request.body as LoginInputDto;
      const result = await loginUseCase.execute(input);
      const accessToken = await reply.jwtSign({
        userId: result.userId,
        isSuperAdmin: result.isSuperAdmin,
      });
      httpResponse.ok(reply, AuthPresenter.toLoginResponse(result, accessToken));
    },
  );

  // ── POST /auth/refresh ─────────────────────────────────────────────────────
  app.post(
    '/refresh',
    { schema: { body: refreshBodySchema } },
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
    { preHandler: [authHook], schema: { body: logoutBodySchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { refreshToken } = request.body as { refreshToken: string };
      await logoutUseCase.execute(refreshToken);
      httpResponse.noContent(reply);
    },
  );
}
