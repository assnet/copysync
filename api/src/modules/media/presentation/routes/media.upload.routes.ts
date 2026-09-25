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
import { TooManyRequestsError, ValidationError } from '../../../../shared/errors/internal/ResourceErrors';
import {
  createUploadBodySchema,
  uploadIdParamSchema,
  uploadPartParamSchema,
} from '../schemas/media.upload.schema';

/** Folga do corpo de uma parte além do chunk (design §10). */
const PART_BODY_SLACK_BYTES = 1024;

/** Teto de partes (PUT) em andamento — nomes das variáveis de ambiente, como os demais settings. */
export interface UploadPartConcurrencySettings {
  /** No processo inteiro: cada parte pode segurar até um chunk em memória. */
  MEDIA_UPLOAD_MAX_CONCURRENT_PARTS: number;
  /** Por usuário (a conta, em qualquer tenant): um só não ocupa todas as vagas. */
  MEDIA_UPLOAD_MAX_CONCURRENT_PARTS_PER_USER: number;
}

export interface MediaUploadRoutesOptions {
  /** Instância única do processo: o mutex por upload só serializa se o store for um só. */
  store: IUploadSessionStore;
  /** Lidas a cada requisição: o boot detecta o ffmpeg depois do registro das rotas. */
  capabilities: () => MediaCapabilities;
  settings: CreateUploadSessionSettings & UploadPartConcurrencySettings;
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

interface PartSlots {
  /** `false` = sem vaga no processo ou para o usuário. */
  tryAcquire(request: FastifyRequest, userId: string): boolean;
  /** Devolve só a vaga que esta requisição tomou; chamar de novo não faz nada. */
  release(request: FastifyRequest): void;
}

/**
 * Vagas de partes em andamento. Uma parte fica em memória (até chunk + folga) do início da
 * leitura do corpo até a gravação: sem teto, PUTs paralelos esgotam a memória do processo.
 * A vaga é da requisição — por isso a devolução idempotente: resposta, abort, erro e timeout
 * podem disparar juntos para a mesma requisição, e um 429 não devolve a vaga de outra.
 */
function createPartSlots(maxTotal: number, maxPerUser: number): PartSlots {
  const holders = new WeakMap<FastifyRequest, string>();
  const perUser = new Map<string, number>();
  let total = 0;

  return {
    tryAcquire(request, userId) {
      const mine = perUser.get(userId) ?? 0;
      if (total >= maxTotal || mine >= maxPerUser) return false;
      total += 1;
      perUser.set(userId, mine + 1);
      holders.set(request, userId);
      return true;
    },
    release(request) {
      const userId = holders.get(request);
      if (userId === undefined) return;
      holders.delete(request);
      total -= 1;
      const left = (perUser.get(userId) ?? 1) - 1;
      if (left > 0) perUser.set(userId, left);
      else perUser.delete(userId);
    },
  };
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

  const partSlots = createPartSlots(
    settings.MEDIA_UPLOAD_MAX_CONCURRENT_PARTS,
    settings.MEDIA_UPLOAD_MAX_CONCURRENT_PARTS_PER_USER,
  );

  /**
   * Último `onRequest` da parte: depois da autenticação (precisa do usuário, e requisição sem
   * credencial não gasta vaga) e antes do corpo — sem vaga, 429 sem ler a parte.
   */
  const acquirePartSlot: onRequestAsyncHookHandler = async (request, reply) => {
    // Cliente caiu enquanto a autenticação esperava o banco: o `onRequestAbort` já passou e
    // ninguém devolveria uma vaga tomada agora. Não há a quem responder.
    if (request.raw.destroyed) {
      reply.hijack();
      return;
    }
    if (!partSlots.tryAcquire(request, request.user.userId)) {
      throw new TooManyRequestsError('Too many upload parts in progress');
    }
  };
  const releasePartSlot = async (request: FastifyRequest): Promise<void> => {
    partSlots.release(request);
  };

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
  // A vaga volta em todo desfecho: resposta enviada, erro (inclusive 413 do parser), cliente
  // que desiste no meio do corpo (sem resposta, sem `onResponse`) e timeout do socket.
  app.put(
    '/:uploadId/parts/:index',
    {
      onRequest: [...authHooks, acquirePartSlot],
      onResponse: releasePartSlot,
      onError: releasePartSlot,
      onRequestAbort: releasePartSlot,
      onTimeout: releasePartSlot,
      schema: { params: uploadPartParamSchema },
    },
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
