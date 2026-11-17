import { Readable } from 'node:stream';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { contentDispositionHeader } from '../../../../shared/storage/staticMediaPolicy';
import { toSaverRole, type SaverActor } from '../../application/use-cases/saverActor';

/** Ator do Saver a partir do contexto do tenant (papel do vínculo; super admin manda). */
export function saverActorOf(request: FastifyRequest): SaverActor {
  const ctx = request.tenantContext;
  return { tenantId: ctx.tenantId, userId: ctx.userId, role: toSaverRole(ctx.role, ctx.isSuperAdmin === true) };
}

export interface SaverFileResponse {
  fileName: string;
  contentType: string;
  lines: AsyncIterable<string>;
}

/**
 * Arquivo por stream (nunca montado em memória). Validação, permissão e contagem já aconteceram no use case,
 * antes do primeiro byte. `return reply` sempre (AGENTS §14). Erro no meio do stream encerra a conexão.
 */
export function sendSaverFile(reply: FastifyReply, file: SaverFileResponse): FastifyReply {
  const ext = file.fileName.slice(file.fileName.lastIndexOf('.') + 1);
  return reply
    .status(200)
    .header('Content-Type', file.contentType)
    .header('Content-Disposition', contentDispositionHeader(ext, file.fileName))
    .header('Cache-Control', 'no-store')
    .send(Readable.from(file.lines));
}
