import type { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../../../shared/config/env';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function extensionRequestGuard(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const client = request.headers['x-client'];
  if (client !== 'extension') {
    reply.code(403).send({ success: false, error: { code: 'EXTENSION_ONLY', message: 'Forbidden' } });
    return;
  }

  const installationId = request.headers['x-installation-id'];
  if (typeof installationId !== 'string' || !UUID_RE.test(installationId)) {
    reply.code(400).send({ success: false, error: { code: 'MISSING_INSTALLATION_ID', message: 'X-Installation-Id required (UUID)' } });
    return;
  }

  const origin = request.headers.origin;

  if (origin) {
    if (env.EXTENSION_ORIGINS_LIST.length > 0 && !env.EXTENSION_ORIGINS_LIST.includes(origin)) {
      reply.code(403).send({ success: false, error: { code: 'INVALID_ORIGIN', message: 'Origin not allowed' } });
      return;
    }
    if (env.NODE_ENV === 'production' && env.EXTENSION_ORIGINS_LIST.length === 0) {
      reply.code(403).send({ success: false, error: { code: 'NO_EXTENSION_ORIGINS', message: 'Extension origins not configured' } });
      return;
    }
  }
}
