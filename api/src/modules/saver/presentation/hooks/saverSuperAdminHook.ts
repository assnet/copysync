import type { FastifyRequest } from 'fastify';
import { ForbiddenError } from '../../../../shared/errors/internal/AuthErrors';

/**
 * Base de contatos da plataforma (`/admin/saver/*`): só super admin, pelo token. 403 (não 401, que o painel trata
 * como sessão vencida). O use case confere de novo. Lança, nunca `send` + `return` (AGENTS §14).
 */
export async function saverSuperAdminHook(request: FastifyRequest): Promise<void> {
  if (request.user?.isSuperAdmin !== true) throw new ForbiddenError('Super admin access required');
}
