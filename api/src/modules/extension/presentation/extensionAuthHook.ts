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
  sheinConsent: boolean;
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

  // Cookie sobrevive à reinstalação da extensão, que nasce com outro `installationId`: sem esta
  // checagem a instalação nova parece vinculada (handshake autenticado, heartbeat creditado à
  // antiga), mas o consentimento do painel (por instalação) dá 404 e nada conecta. 401 faz a
  // extensão se declarar sem vínculo e o painel oferecer "Vincular" (sessão nova para esta instalação).
  const headerInstallationId = request.headers['x-installation-id'];
  if (typeof headerInstallationId === 'string' && headerInstallationId !== result.session.installationId) {
    return reply.code(401).send({ success: false, error: { code: 'INVALID_EXT_SESSION', message: 'Extension session belongs to another installation' } });
  }

  request.extensionSession = {
    sessionId: result.session.id,
    userId: result.session.userId,
    installationId: result.session.installationId,
    mlTenantId: result.session.mlTenantId,
    mlConsent: result.session.mlConsentAt !== null,
    sheinConsent: result.session.sheinConsentAt !== null,
    tokenHash: result.session.tokenHash,
  };
}
