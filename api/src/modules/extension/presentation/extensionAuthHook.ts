import type { FastifyRequest, FastifyReply } from 'fastify';
import { parseExtSessionCookie } from '../infrastructure/cookieHelper';
import { extensionContainer } from '../infrastructure/extensionContainer';
import { ValidateExtensionSessionUseCase } from '../application/use-cases/ValidateExtensionSessionUseCase';
import { hashToken } from '../domain/services/tokenHash';

export interface ExtensionSessionContext {
  sessionId: string;
  userId: string;
  installationId: string;
  mlTenantId: string;
  mlConsent: boolean;
  tokenHash: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    extensionSession?: ExtensionSessionContext;
  }
}

export async function extensionAuthHook(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply | void> {
  const token = parseExtSessionCookie(request);
  if (!token) {
    return reply.code(401).send({ success: false, error: { code: 'MISSING_EXT_SESSION', message: 'Extension session cookie required' } });
  }

  const tokenHash = hashToken(token);
  const validator = new ValidateExtensionSessionUseCase(extensionContainer.sessionRepository);
  const result = await validator.execute(tokenHash);

  if (!result) {
    return reply.code(401).send({ success: false, error: { code: 'INVALID_EXT_SESSION', message: 'Extension session expired or revoked' } });
  }

  request.extensionSession = {
    sessionId: result.session.id,
    userId: result.session.userId,
    installationId: result.session.installationId,
    mlTenantId: result.session.mlTenantId,
    mlConsent: result.session.mlConsentAt !== null,
    tokenHash: result.session.tokenHash,
  };
}
