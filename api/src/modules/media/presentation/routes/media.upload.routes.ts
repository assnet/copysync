import type { FastifyInstance, FastifyReply, FastifyRequest, onRequestAsyncHookHandler } from 'fastify';
import type { IUploadSessionStore, UploadPurpose } from '../../domain/contracts/IUploadSessionStore';
import type { MediaCapabilities } from '../../domain/contracts/MediaCapabilities';
import { GetMediaUploadConfigUseCase } from '../../application/use-cases/GetMediaUploadConfigUseCase';
import {
  CreateUploadSessionUseCase,
  type CreateUploadSessionSettings,
} from '../../application/use-cases/CreateUploadSessionUseCase';
import { AppendUploadPartUseCase } from '../../application/use-cases/AppendUploadPartUseCase';
import { GetUploadSessionUseCase } from '../../application/use-cases/GetUploadSessionUseCase';
import { CancelUploadSessionUseCase } from '../../application/use-cases/CancelUploadSessionUseCase';
import { httpResponse } from '../../../../shared/http/httpResponse';
import { ValidationError } from '../../../../shared/errors/internal/ResourceErrors';
import {
  createUploadBodySchema,
  uploadIdParamSchema,
  uploadPartParamSchema,
} from '../schemas/media.upload.schema';

/** Folga do corpo de uma parte além do chunk (design §10). */
const PART_BODY_SLACK_BYTES = 1024;

export interface MediaUploadRoutesOptions {
  /** Instância única do processo: o mutex por upload só serializa se o store for um só. */
  store: IUploadSessionStore;
  /** Lidas a cada requisição: o boot detecta o ffmpeg depois do registro das rotas. */
  capabilities: () => MediaCapabilities;
  settings: CreateUploadSessionSettings;
  /**
   * Autenticação e tenant — em produção `[authHook, tenantHook]`. Obrigatório: sem ele a rota
   * ficaria aberta. Roda em `onRequest`, **antes** de ler o corpo: requisição sem credencial é
   * recusada sem o servidor receber a parte (até ~8 MiB).
   */
  authHooks: onRequestAsyncHookHandler[];
}

interface CreateUploadBody {
  fileName: string;
  sizeBytes: number;
  purpose: UploadPurpose;
  declaredMimeType?: string | null;
}

/** Dono do upload: usuário do token e tenant já validado pelo `tenantHook`. */
function ownerOf(request: FastifyRequest): { tenantId: string; userId: string } {
  return { tenantId: request.tenantContext.tenantId, userId: request.user.userId };
}

/**
 * Upload em partes — registrado em `/api/media/uploads` (design §10).
 *
 * O parser `application/octet-stream` nasce **dentro** deste plugin: o Fastify copia os
 * parsers para os filhos, nunca para os irmãos, então as outras rotas continuam sem aceitar
 * binário e com o limite global de 1 MiB. O limite da parte fica no parser e **nenhuma rota
 * define `bodyLimit`** — o da rota venceria o do parser (`fastify/lib/route.js:381`) e
 * valeria também para o JSON.
 */
export async function mediaUploadRoutes(app: FastifyInstance, options: MediaUploadRoutesOptions): Promise<void> {
  const { store, capabilities, settings, authHooks } = options;

  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: settings.MEDIA_UPLOAD_CHUNK_BYTES + PART_BODY_SLACK_BYTES },
    (_request, body, done) => done(null, body),
  );

  // Só dependem do store; os que leem capacidades nascem por requisição.
  const appendPart = new AppendUploadPartUseCase(store);
  const getUpload = new GetUploadSessionUseCase(store);
  const cancelUpload = new CancelUploadSessionUseCase(store);

  // ── GET /config ────────────────────────────────────────────────────────────
  app.get('/config', { onRequest: authHooks }, async (_request: FastifyRequest, reply: FastifyReply) => {
    const config = new GetMediaUploadConfigUseCase(settings, capabilities()).execute();
    httpResponse.ok(reply, config);
  });

  // ── POST / ─────────────────────────────────────────────────────────────────
  app.post(
    '/',
    { onRequest: authHooks, schema: { body: createUploadBodySchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as CreateUploadBody;
      const result = await new CreateUploadSessionUseCase(store, settings, capabilities()).execute({
        ...ownerOf(request),
        fileName: body.fileName,
        sizeBytes: body.sizeBytes,
        purpose: body.purpose,
        declaredMimeType: body.declaredMimeType ?? null,
      });
      httpResponse.created(reply, result);
    },
  );

  // ── PUT /:uploadId/parts/:index ────────────────────────────────────────────
  app.put(
    '/:uploadId/parts/:index',
    { onRequest: authHooks, schema: { params: uploadPartParamSchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { uploadId, index } = request.params as { uploadId: string; index: number };
      // Sem corpo ou com JSON não chega um Buffer: só o parser binário acima produz um.
      if (!Buffer.isBuffer(request.body)) {
        throw new ValidationError('Upload part must be sent as application/octet-stream');
      }
      const result = await appendPart.execute({ ...ownerOf(request), uploadId, index, data: request.body });
      httpResponse.ok(reply, result);
    },
  );

  // ── GET /:uploadId ─────────────────────────────────────────────────────────
  app.get(
    '/:uploadId',
    { onRequest: authHooks, schema: { params: uploadIdParamSchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { uploadId } = request.params as { uploadId: string };
      httpResponse.ok(reply, await getUpload.execute({ ...ownerOf(request), uploadId }));
    },
  );

  // ── DELETE /:uploadId ──────────────────────────────────────────────────────
  app.delete(
    '/:uploadId',
    { onRequest: authHooks, schema: { params: uploadIdParamSchema } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { uploadId } = request.params as { uploadId: string };
      await cancelUpload.execute({ ...ownerOf(request), uploadId });
      httpResponse.noContent(reply);
    },
  );
}
