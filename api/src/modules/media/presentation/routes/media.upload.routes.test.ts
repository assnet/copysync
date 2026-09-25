import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type onRequestAsyncHookHandler,
} from 'fastify';
import { mediaUploadRoutes, type MediaUploadRoutesOptions } from './media.upload.routes';
import { DiskUploadSessionStore } from '../../infrastructure/uploads/DiskUploadSessionStore';
import type { WriteUploadPartResult } from '../../domain/contracts/IUploadSessionStore';
import type { MediaCapabilities } from '../../domain/contracts/MediaCapabilities';
import { errorHandler } from '../../../../shared/http/errorHandler';
import { UnauthorizedError } from '../../../../shared/errors/internal/AuthErrors';

/**
 * Exceção justificada à matriz do TESTING.md: o isolamento do parser binário e o limite de
 * corpo só aparecem com o Fastify de verdade. Store real em pasta temporária; autenticação
 * e tenant entram por um hook `onRequest` falso — nenhum banco.
 *
 * Os dois testes de desistência do cliente abrem um servidor em porta efêmera de 127.0.0.1:
 * o `inject` nunca marca a requisição como abortada, então o `onRequestAbort` só roda com socket.
 */

const MIB = 1024 * 1024;
const CHUNK = 8 * MIB;
const PREFIX = '/api/media/uploads';
const HEADERS_BIN = { 'content-type': 'application/octet-stream' };

const settings: MediaUploadRoutesOptions['settings'] = {
  MEDIA_UPLOAD_CHUNK_BYTES: CHUNK,
  MEDIA_MAX_FILES_PER_BATCH: 30,
  MEDIA_MAX_VOICE_SECONDS: 900,
  MEDIA_MAX_IMAGE_BYTES: 16_000_000,
  MEDIA_MAX_INLINE_VIDEO_BYTES: 180_000_000,
  MEDIA_MAX_DOCUMENT_BYTES: 180_000_000,
  MEDIA_UPLOAD_MAX_OPEN_PER_USER: 30,
  MEDIA_UPLOAD_TTL_MINUTES: 120,
  // O teste não depende do disco da máquina: sem reserva e com teto folgado.
  MEDIA_DISK_RESERVE_BYTES: 0,
  MEDIA_UPLOAD_MAX_OPEN_BYTES: 1024 * MIB,
  MEDIA_UPLOAD_MAX_CONCURRENT_PARTS: 8,
  MEDIA_UPLOAD_MAX_CONCURRENT_PARTS_PER_USER: 2,
};

let root: string;
let app: FastifyInstance;
let caps: MediaCapabilities;

async function fakeAuth(request: FastifyRequest): Promise<void> {
  request.user = { userId: 'user-a', isSuperAdmin: false };
  request.tenantContext = { userId: 'user-a', tenantId: 'tenant-a', role: 'ADMIN', isSuperAdmin: false };
}

async function createUpload(sizeBytes: number): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: PREFIX,
    payload: { fileName: 'video.mp4', sizeBytes, purpose: 'media' },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.uploadId as string;
}

function putPart(uploadId: string, index: number, body: Buffer) {
  return app.inject({ method: 'PUT', url: `${PREFIX}/${uploadId}/parts/${index}`, headers: HEADERS_BIN, payload: body });
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'upload-routes-'));
  caps = { transcodeVoice: false, probe: false };

  app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(mediaUploadRoutes, {
    prefix: PREFIX,
    store: new DiskUploadSessionStore({ dir: root }),
    capabilities: () => caps,
    settings,
    authHooks: [fakeAuth],
  });
  // Rota JSON irmã, fora do plugin — como as do chat em produção.
  await app.register(
    async (chat) => {
      chat.post('/conversations/:id/messages', { preHandler: [fakeAuth] }, async () => ({ ok: true }));
    },
    { prefix: '/api/chat' },
  );
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await fs.rm(root, { recursive: true, force: true });
});

describe('rotas de upload em partes', () => {
  it('aceita uma parte de 8 MiB', async () => {
    const uploadId = await createUpload(CHUNK);

    const res = await putPart(uploadId, 0, Buffer.alloc(CHUNK, 7));

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ receivedParts: [0], complete: true });
  });

  it('sem credencial recusa antes de ler o corpo — até uma parte acima do limite responde 401, não 413', async () => {
    const semAuth = Fastify();
    semAuth.setErrorHandler(errorHandler);
    const recusa = async (_req: FastifyRequest, reply: FastifyReply) => { await reply.code(401).send({ success: false }); };
    await semAuth.register(mediaUploadRoutes, {
      prefix: PREFIX,
      store: new DiskUploadSessionStore({ dir: root }),
      capabilities: () => caps,
      settings,
      authHooks: [recusa],
    });
    await semAuth.ready();

    const res = await semAuth.inject({
      method: 'PUT',
      url: `${PREFIX}/${randomUUID()}/parts/0`,
      headers: HEADERS_BIN,
      payload: Buffer.alloc(CHUNK + 2 * 1024),
    });

    expect(res.statusCode).toBe(401);
    await semAuth.close();
  });

  it('recusa com 413 uma parte maior que o chunk + folga, antes de ler o corpo inteiro', async () => {
    const res = await putPart(randomUUID(), 0, Buffer.alloc(CHUNK + 2 * 1024));

    expect(res.statusCode).toBe(413);
  });

  it('mantém o limite de 1 MiB e o parser padrão nas rotas JSON fora do plugin', async () => {
    const big = await app.inject({
      method: 'POST',
      url: '/api/chat/conversations/c1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ content: 'x'.repeat(2 * MIB) }),
    });
    const binary = await app.inject({
      method: 'POST',
      url: '/api/chat/conversations/c1/messages',
      headers: HEADERS_BIN,
      payload: Buffer.from('oi'),
    });

    expect(big.statusCode).toBe(413);
    expect(binary.statusCode).toBe(415);
  });

  it.each([
    ['texto qualquer', 'GET', `${PREFIX}/nao-e-uuid`],
    ['UUID maiúsculo', 'GET', `${PREFIX}/${randomUUID().toUpperCase()}`],
    ['UUID de outra versão', 'DELETE', `${PREFIX}/123e4567-e89b-12d3-a456-426614174000`],
    ['índice negativo', 'PUT', `${PREFIX}/${randomUUID()}/parts/-1`],
    ['índice fracionado', 'PUT', `${PREFIX}/${randomUUID()}/parts/1.5`],
  ] as const)('recusa com 400 parâmetro inválido (%s)', async (_caso, method, url) => {
    const res = await app.inject({ method, url, headers: HEADERS_BIN, payload: method === 'PUT' ? Buffer.from('x') : undefined });

    expect(res.statusCode).toBe(400);
  });

  it('recusa criação fora do contrato (finalidade desconhecida, tamanho zero, nome vazio)', async () => {
    const bodies = [
      { fileName: 'a.bin', sizeBytes: 10, purpose: 'sticker' },
      { fileName: 'a.bin', sizeBytes: 0, purpose: 'document' },
      { fileName: '', sizeBytes: 10, purpose: 'document' },
      { fileName: 'a'.repeat(256), sizeBytes: 10, purpose: 'document' },
    ];

    for (const payload of bodies) {
      const res = await app.inject({ method: 'POST', url: PREFIX, payload });
      expect(res.statusCode, JSON.stringify(payload).slice(0, 60)).toBe(400);
    }
  });

  it('percorre o ciclo: cria, recebe partes fora de ordem, consulta e cancela', async () => {
    const sizeBytes = 2 * CHUNK + 1000;
    const created = await app.inject({
      method: 'POST',
      url: PREFIX,
      payload: { fileName: 'filme.mp4', sizeBytes, purpose: 'media', declaredMimeType: 'video/mp4' },
    });
    expect(created.statusCode).toBe(201);
    const { uploadId, chunkSizeBytes, totalParts, receivedParts } = created.json().data;
    expect({ chunkSizeBytes, totalParts, receivedParts }).toEqual({ chunkSizeBytes: CHUNK, totalParts: 3, receivedParts: [] });

    expect((await putPart(uploadId, 2, Buffer.alloc(1000, 3))).json().data).toEqual({ receivedParts: [2], complete: false });
    expect((await putPart(uploadId, 0, Buffer.alloc(CHUNK, 1))).json().data).toEqual({ receivedParts: [0, 2], complete: false });
    expect((await putPart(uploadId, 1, Buffer.alloc(CHUNK, 2))).json().data).toEqual({ receivedParts: [0, 1, 2], complete: true });

    const status = await app.inject({ method: 'GET', url: `${PREFIX}/${uploadId}` });
    expect(status.statusCode).toBe(200);
    expect(status.json().data).toEqual({ receivedParts: [0, 1, 2], complete: true, state: 'OPEN', messageId: null });

    const cancel = await app.inject({ method: 'DELETE', url: `${PREFIX}/${uploadId}` });
    expect(cancel.statusCode).toBe(204);

    const gone = await app.inject({ method: 'GET', url: `${PREFIX}/${uploadId}` });
    expect(gone.statusCode).toBe(404);
    expect(gone.json().error.code).toBe('UPLOAD_NOT_FOUND');
    // Cancelar de novo continua sucesso: idempotente, sem dizer se existia.
    expect((await app.inject({ method: 'DELETE', url: `${PREFIX}/${uploadId}` })).statusCode).toBe(204);
  });

  it('recusa com 400 parte com tamanho fora do plano', async () => {
    const uploadId = await createUpload(CHUNK + 10);

    const res = await putPart(uploadId, 1, Buffer.alloc(9));

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('config reflete as capacidades detectadas depois do registro das rotas', async () => {
    const before = await app.inject({ method: 'GET', url: `${PREFIX}/config` });
    caps = { transcodeVoice: true, probe: true };
    const after = await app.inject({ method: 'GET', url: `${PREFIX}/config` });

    expect(before.json().data.capabilities).toEqual({ voiceNotes: false, videoMetadata: false });
    expect(after.statusCode).toBe(200);
    expect(after.json().data).toMatchObject({
      chunkSizeBytes: CHUNK,
      capabilities: { voiceNotes: true, videoMetadata: true },
    });
  });

  it('voz só é aceita depois que o ffmpeg com Opus é detectado', async () => {
    const payload = { fileName: 'voz.webm', sizeBytes: 1000, purpose: 'voice' };

    const semFfmpeg = await app.inject({ method: 'POST', url: PREFIX, payload });
    caps = { transcodeVoice: true, probe: true };
    const comFfmpeg = await app.inject({ method: 'POST', url: PREFIX, payload });

    expect(semFfmpeg.statusCode).toBe(503);
    expect(comFfmpeg.statusCode).toBe(201);
  });
});

/** Store real que segura a gravação de uma parte até o teste soltar: a parte fica "em andamento". */
class StoreComTrava extends DiskUploadSessionStore {
  private readonly travas = new Map<string, { avisar: () => void; aberta: Promise<void> }>();

  travar(uploadId: string): { entrou: Promise<void>; soltar: () => void } {
    let avisar!: () => void;
    let soltar!: () => void;
    const entrou = new Promise<void>((r) => { avisar = r; });
    const aberta = new Promise<void>((r) => { soltar = r; });
    this.travas.set(uploadId, { avisar, aberta });
    return { entrou, soltar: () => { this.travas.delete(uploadId); soltar(); } };
  }

  override async writePart(uploadId: string, index: number, data: Uint8Array): Promise<WriteUploadPartResult> {
    const trava = this.travas.get(uploadId);
    if (trava) {
      trava.avisar();
      await trava.aberta;
    }
    return super.writePart(uploadId, index, data);
  }
}

/** Usuário pelo cabeçalho `x-user`; sem ele, 401 — como o `authHook` de produção, por exceção. */
async function authPorCabecalho(request: FastifyRequest): Promise<void> {
  const userId = request.headers['x-user'];
  if (typeof userId !== 'string') throw new UnauthorizedError('Missing test user');
  request.user = { userId, isSuperAdmin: false };
  request.tenantContext = { userId, tenantId: 'tenant-a', role: 'ADMIN', isSuperAdmin: false };
}

describe('vagas de partes em andamento', () => {
  let instancia: FastifyInstance | undefined;
  const clientes: http.ClientRequest[] = [];

  afterEach(async () => {
    // Cliente ainda aberto seguraria o `close` do servidor até o timeout.
    clientes.splice(0).forEach((c) => c.destroy());
    await instancia?.close();
    instancia = undefined;
  });

  async function montar(total: number, porUsuario: number, authExtra?: onRequestAsyncHookHandler) {
    const store = new StoreComTrava({ dir: root });
    const inst = Fastify();
    inst.setErrorHandler(errorHandler);
    await inst.register(mediaUploadRoutes, {
      prefix: PREFIX,
      store,
      capabilities: () => caps,
      settings: { ...settings, MEDIA_UPLOAD_MAX_CONCURRENT_PARTS: total, MEDIA_UPLOAD_MAX_CONCURRENT_PARTS_PER_USER: porUsuario },
      authHooks: authExtra ? [authPorCabecalho, authExtra] : [authPorCabecalho],
    });
    await inst.ready();
    instancia = inst;

    const criar = async (user: string, sizeBytes = 1000): Promise<string> => {
      const res = await inst.inject({
        method: 'POST',
        url: PREFIX,
        headers: { 'x-user': user },
        payload: { fileName: 'arquivo.bin', sizeBytes, purpose: 'document' },
      });
      expect(res.statusCode).toBe(201);
      return res.json().data.uploadId as string;
    };
    const parte = (user: string, uploadId: string, body = Buffer.alloc(1000, 1), index = 0) =>
      inst.inject({
        method: 'PUT',
        url: `${PREFIX}/${uploadId}/parts/${index}`,
        headers: { ...HEADERS_BIN, 'x-user': user },
        payload: body,
      });
    return { inst, store, criar, parte };
  }

  /** Abre um PUT de verdade, manda só 1 KiB de um corpo de 8 MiB e fica esperando. */
  function parteQueDesiste(endereco: string, uploadId: string, user: string, extras: Record<string, string> = {}) {
    const req = http.request(`${endereco}${PREFIX}/${uploadId}/parts/0`, {
      method: 'PUT',
      headers: { ...HEADERS_BIN, 'content-length': String(CHUNK), 'x-user': user, ...extras },
    });
    req.on('error', () => undefined); // ECONNRESET é o esperado ao desistir
    req.write(Buffer.alloc(1024));
    clientes.push(req);
    return req;
  }

  it('sem vaga no processo responde 429 sem ler o corpo — nem parte acima do limite chega ao 413', async () => {
    const s = await montar(1, 1);
    const a = await s.criar('user-a');
    const b = await s.criar('user-b');
    const trava = s.store.travar(a);
    const emAndamento = s.parte('user-a', a);
    await trava.entrou;

    const recusa = await s.parte('user-b', b, Buffer.alloc(CHUNK + 2 * 1024));
    expect(recusa.statusCode).toBe(429);
    expect(recusa.json().error.code).toBe('TOO_MANY_REQUESTS');
    // A recusa não devolve a vaga de quem está em andamento: a seguinte também é 429.
    expect((await s.parte('user-b', b)).statusCode).toBe(429);

    trava.soltar();
    expect((await emAndamento).statusCode).toBe(200);
    expect((await s.parte('user-b', b)).statusCode).toBe(200);
  });

  it('por usuário: o mesmo usuário espera a própria vaga, outro usuário ainda entra', async () => {
    const s = await montar(8, 1);
    const a1 = await s.criar('user-a');
    const a2 = await s.criar('user-a');
    const b = await s.criar('user-b');
    const trava = s.store.travar(a1);
    const emAndamento = s.parte('user-a', a1);
    await trava.entrou;

    expect((await s.parte('user-a', a2)).statusCode).toBe(429);
    expect((await s.parte('user-b', b)).statusCode).toBe(200);

    trava.soltar();
    await emAndamento;
    expect((await s.parte('user-a', a2)).statusCode).toBe(200);
  });

  it('autenticação vem antes da vaga: sem credencial é 401 mesmo com o processo lotado', async () => {
    const s = await montar(1, 1);
    const a = await s.criar('user-a');
    const trava = s.store.travar(a);
    const emAndamento = s.parte('user-a', a);
    await trava.entrou;

    const semAuth = await s.inst.inject({
      method: 'PUT',
      url: `${PREFIX}/${randomUUID()}/parts/0`,
      headers: HEADERS_BIN,
      payload: Buffer.from('x'),
    });
    expect(semAuth.statusCode).toBe(401);

    trava.soltar();
    await emAndamento;
  });

  it('a vaga volta depois de 413, 400 e 404 — nenhuma recusa vaza vaga', async () => {
    const s = await montar(1, 1);
    const a = await s.criar('user-a', CHUNK + 10);

    expect((await s.parte('user-a', a, Buffer.alloc(CHUNK + 2 * 1024))).statusCode).toBe(413);
    expect((await s.parte('user-a', a, Buffer.alloc(9), 1)).statusCode).toBe(400);
    expect((await s.parte('user-a', randomUUID(), Buffer.alloc(10))).statusCode).toBe(404);
    const indiceInvalido = await s.inst.inject({
      method: 'PUT', url: `${PREFIX}/${a}/parts/x`, headers: { ...HEADERS_BIN, 'x-user': 'user-a' }, payload: Buffer.from('x'),
    });
    expect(indiceInvalido.statusCode).toBe(400);
    const semBinario = await s.inst.inject({
      method: 'PUT', url: `${PREFIX}/${a}/parts/1`, headers: { 'x-user': 'user-a' }, payload: { parte: 1 },
    });
    expect(semBinario.statusCode).toBe(400);

    expect((await s.parte('user-a', a, Buffer.alloc(10, 1), 1)).statusCode).toBe(200);
  });

  it('a vaga volta quando o cliente desiste no meio do corpo', async () => {
    let avisarChegada!: () => void;
    const chegou = new Promise<void>((r) => { avisarChegada = r; });
    const marcaChegada: onRequestAsyncHookHandler = async (request) => {
      if (request.headers['x-marca'] === '1') avisarChegada();
    };
    const s = await montar(1, 1, marcaChegada);
    const a = await s.criar('user-a', CHUNK);
    const b = await s.criar('user-b');
    const endereco = await s.inst.listen({ port: 0, host: '127.0.0.1' });

    const cliente = parteQueDesiste(endereco, a, 'user-a', { 'x-marca': '1' });
    await chegou;
    await new Promise((r) => setTimeout(r, 20));
    // O PUT real passou da autenticação e está lendo o corpo: a vaga é dele.
    expect((await s.parte('user-b', b)).statusCode).toBe(429);

    cliente.destroy();
    await vi.waitFor(async () => expect((await s.parte('user-b', b)).statusCode).toBe(200));
  });

  it('cliente que cai durante a autenticação não fica com vaga presa', async () => {
    let avisarEntrada!: () => void;
    const entrouNaAuth = new Promise<void>((r) => { avisarEntrada = r; });
    let liberarAuth!: () => void;
    const authLiberada = new Promise<void>((r) => { liberarAuth = r; });
    let bruto: http.IncomingMessage | undefined;
    const authLenta: onRequestAsyncHookHandler = async (request) => {
      if (request.headers['x-auth-lenta'] !== '1') return;
      bruto = request.raw;
      avisarEntrada();
      await authLiberada;
    };

    const s = await montar(1, 1, authLenta);
    const a = await s.criar('user-a', CHUNK);
    const b = await s.criar('user-b');
    const endereco = await s.inst.listen({ port: 0, host: '127.0.0.1' });

    const cliente = parteQueDesiste(endereco, a, 'user-a', { 'x-auth-lenta': '1' });
    await entrouNaAuth;
    cliente.destroy();
    await vi.waitFor(() => expect(bruto?.destroyed).toBe(true));

    // A autenticação termina depois do `close`: ninguém mais devolveria uma vaga tomada agora.
    liberarAuth();
    await new Promise((r) => setTimeout(r, 20));
    expect((await s.parte('user-b', b)).statusCode).toBe(200);
  });
});
