import type { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../../../shared/config/env';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function extensionRequestGuard(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply | void> {
  const client = request.headers['x-client'];
  if (client !== 'extension') {
    return reply.code(403).send({ success: false, error: { code: 'EXTENSION_ONLY', message: 'Forbidden' } });
  }

  const installationId = request.headers['x-installation-id'];
  if (typeof installationId !== 'string' || !UUID_RE.test(installationId)) {
    return reply.code(400).send({ success: false, error: { code: 'MISSING_INSTALLATION_ID', message: 'X-Installation-Id required (UUID)' } });
  }

  const origin = request.headers.origin;

  if (origin) {
    if (env.EXTENSION_ORIGINS_LIST.length > 0 && !env.EXTENSION_ORIGINS_LIST.includes(origin)) {
      return reply.code(403).send({ success: false, error: { code: 'INVALID_ORIGIN', message: 'Origin not allowed' } });
    }
    if (env.NODE_ENV === 'production' && env.EXTENSION_ORIGINS_LIST.length === 0) {
      return reply.code(403).send({ success: false, error: { code: 'NO_EXTENSION_ORIGINS', message: 'Extension origins not configured' } });
    }
  }
}
