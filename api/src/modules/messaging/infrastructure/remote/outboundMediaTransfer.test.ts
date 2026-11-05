import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessagingEngine, SendMediaMessageInput } from '../../domain/contracts/IMessagingEngine';
import { EngineNotReadyError, MessageSendFailedError } from '../../../../shared/errors/internal/MessagingErrors';
import { SessionNotConnectedError } from '../../../../shared/errors/internal/SessionErrors';
import { decodeEngineCall, encodeEngineCall } from './engineCallCodec';
import type { EngineCall } from './engineCallPlan';
import { EngineCommandServer } from './EngineCommandServer';
import { OutboundMediaTransfer, isStagedMediaKey, type OutboundObjectStore } from './outboundMediaTransfer';
import { RemoteMessagingEngineAdapter } from './RemoteMessagingEngineAdapter';

/** Store dublê em memória. */
function memoryStore() {
  const objects = new Map<string, Buffer>();
  const store: OutboundObjectStore = {
    upload: vi.fn(async (key: string, filePath: string) => { objects.set(key, await fs.readFile(filePath)); }),
    download: vi.fn(async (key: string, dest: string) => {
      const b = objects.get(key);
      if (!b) throw new Error('NoSuchKey');
      await fs.writeFile(dest, b);
    }),
    delete: vi.fn(async (key: string) => { objects.delete(key); }),
  };
  return { objects, store };
}

let dir: string;
let httpFile: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'omt-test-'));
  httpFile = path.join(dir, 'foto.JPG');
  writeFileSync(httpFile, 'bytes-da-foto');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('OutboundMediaTransfer', () => {
  it('stage sobe com chave outbound-tmp/{uuid}.ext e não apaga o arquivo local', async () => {
    const { objects, store } = memoryStore();
    const key = await new OutboundMediaTransfer(store).stage(httpFile, 'image/jpeg');
    expect(key).toMatch(/^outbound-tmp\/[0-9a-f-]{36}\.jpg$/);
    expect(isStagedMediaKey(key)).toBe(true);
    expect(store.upload).toHaveBeenCalledWith(key, httpFile, 'image/jpeg');
    expect(objects.get(key)?.toString()).toBe('bytes-da-foto');
    expect(readFileSync(httpFile, 'utf8')).toBe('bytes-da-foto');
  });

  it('fetch baixa para tmp local; release apaga o tmp; discard apaga a chave', async () => {
    const { objects, store } = memoryStore();
    const t = new OutboundMediaTransfer(store);
    const key = await t.stage(httpFile, 'image/jpeg');
    const local = await t.fetch(key);
    expect(local.filePath).not.toBe(httpFile);
    expect(readFileSync(local.filePath, 'utf8')).toBe('bytes-da-foto');
    await local.release();
    expect(existsSync(local.filePath)).toBe(false);
    await t.discard(key);
    expect(objects.has(key)).toBe(false);
  });

  it('fetch de chave ausente lança e não deixa tmp; chave fora do formato é recusada', async () => {
    const { store } = memoryStore();
    const t = new OutboundMediaTransfer(store);
    await expect(t.fetch('outbound-tmp/00000000-0000-4000-8000-000000000000')).rejects.toThrow('NoSuchKey');
    await expect(t.fetch('media/s1_m1.jpg')).rejects.toBeInstanceOf(TypeError);
    await expect(t.fetch('outbound-tmp/../media/x')).rejects.toBeInstanceOf(TypeError);
    await t.discard('media/s1_m1.jpg');
    expect(store.delete).not.toHaveBeenCalled();
  });

  it('discard nunca lança', async () => {
    const { store } = memoryStore();
    (store.delete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('s3 down'));
    await expect(new OutboundMediaTransfer(store).discard('outbound-tmp/00000000-0000-4000-8000-000000000000')).resolves.toBeUndefined();
  });

  it('caminho local absoluto nunca é chave', () => {
    expect(isStagedMediaKey('/var/media/s1_m1.jpg')).toBe(false);
  });
});

/** http (adapter remoto) → codec → worker (servidor) com o mesmo store dublê. */
function pipelineSetup(engineSend: (input: SendMediaMessageInput) => Promise<unknown>, owner: string | null = 'w1') {
  const { objects, store } = memoryStore();
  const transfer = new OutboundMediaTransfer(store);
  const seen: { filePath?: string; bytes?: string } = {};
  const engine = {
    sendMediaMessage: vi.fn(async (input: SendMediaMessageInput) => {
      seen.filePath = input.media.filePath;
      seen.bytes = readFileSync(input.media.filePath, 'utf8');
      return engineSend(input);
    }),
  } as unknown as IMessagingEngine;
  const server = new EngineCommandServer(engine, { listLocalSessionIds: () => ['s1'] }, { execute: vi.fn() }, transfer);
  const sent: EngineCall[] = [];
  const adapter = new RemoteMessagingEngineAdapter({
    owners: { findLiveOwner: async () => owner },
    rpc: { call: vi.fn(), close: vi.fn() } as never,
    commands: {
      send: async (_t: string, call: EngineCall) => {
        sent.push(call);
        return server.handle(decodeEngineCall(encodeEngineCall(call)));
      },
      close: vi.fn(),
    } as never,
    mediaTransfer: transfer,
    enabledEngines: new Set(['baileys']),
  });
  const input: SendMediaMessageInput = {
    sessionId: 's1', tenantId: 't1', to: '5511', messageId: 'm1',
    media: { kind: 'image', filePath: httpFile, mimeType: 'image/jpeg', sizeBytes: 13 },
  };
  return { objects, store, adapter, engine, seen, sent, input };
}

describe('mídia de envio entre processos (WROLE-11)', () => {
  it('sucesso: chave criada, consumida pelo worker e apagada; tmp do worker apagado; arquivo do http intocado', async () => {
    const { objects, store, adapter, seen, sent, input } = pipelineSetup(async () => ({ messageId: 'm1' }));
    await expect(adapter.sendMediaMessage(input)).resolves.toEqual({ messageId: 'm1' });
    const key = (sent[0].args[0] as SendMediaMessageInput).media.filePath;
    expect(isStagedMediaKey(key)).toBe(true);
    expect(store.upload).toHaveBeenCalledTimes(1);
    expect(store.download).toHaveBeenCalledWith(key, expect.any(String));
    expect(seen.bytes).toBe('bytes-da-foto');
    expect(seen.filePath).not.toBe(httpFile);
    expect(existsSync(seen.filePath!)).toBe(false);
    expect(objects.size).toBe(0);
    expect(readFileSync(httpFile, 'utf8')).toBe('bytes-da-foto');
    expect(input.media.filePath).toBe(httpFile); // entrada do chamador não muda
  });

  it('erro da engine no worker: tmp e chave apagados; erro volta; arquivo do http intocado', async () => {
    const { objects, adapter, seen, input } = pipelineSetup(async () => { throw new MessageSendFailedError('boom'); });
    await expect(adapter.sendMediaMessage(input)).rejects.toBeInstanceOf(MessageSendFailedError);
    expect(existsSync(seen.filePath!)).toBe(false);
    expect(objects.size).toBe(0);
    expect(readFileSync(httpFile, 'utf8')).toBe('bytes-da-foto');
  });

  it('erro antes do worker (sem dono): chave descartada pelo http', async () => {
    const { objects, store, adapter, engine, input } = pipelineSetup(async () => ({ messageId: 'm1' }), null);
    await expect(adapter.sendMediaMessage(input)).rejects.toBeInstanceOf(SessionNotConnectedError);
    expect(store.upload).toHaveBeenCalledTimes(1);
    expect(objects.size).toBe(0);
    expect(engine.sendMediaMessage).not.toHaveBeenCalled();
    expect(readFileSync(httpFile, 'utf8')).toBe('bytes-da-foto');
  });

  it('timeout da fila: chave descartada pelo http', async () => {
    const { objects, store } = memoryStore();
    const transfer = new OutboundMediaTransfer(store);
    const adapter = new RemoteMessagingEngineAdapter({
      owners: { findLiveOwner: async () => 'w1' },
      rpc: { call: vi.fn(), close: vi.fn() } as never,
      commands: { send: async () => { throw new EngineNotReadyError(); }, close: vi.fn() } as never,
      mediaTransfer: transfer,
      enabledEngines: new Set(['baileys']),
    });
    await expect(adapter.sendMediaMessage({
      sessionId: 's1', tenantId: 't1', to: '5511', messageId: 'm1',
      media: { kind: 'image', filePath: httpFile, mimeType: 'image/jpeg', sizeBytes: 13 },
    })).rejects.toBeInstanceOf(EngineNotReadyError);
    expect(objects.size).toBe(0);
  });

  it('download falha no worker: engine não roda e a chave é apagada', async () => {
    const { objects, store, adapter, engine, input } = pipelineSetup(async () => ({ messageId: 'm1' }));
    (store.download as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('s3 down'));
    await expect(adapter.sendMediaMessage(input)).rejects.toThrow('s3 down');
    expect(engine.sendMediaMessage).not.toHaveBeenCalled();
    expect(objects.size).toBe(0);
  });

  it('worker com caminho local (papel all/legado) envia direto, sem storage', async () => {
    const { store } = memoryStore();
    const engine = { sendMediaMessage: vi.fn(async () => ({ messageId: 'm1' })) } as unknown as IMessagingEngine;
    const server = new EngineCommandServer(engine, { listLocalSessionIds: () => ['s1'] }, { execute: vi.fn() }, new OutboundMediaTransfer(store));
    const input: SendMediaMessageInput = {
      sessionId: 's1', tenantId: 't1', to: '5511', messageId: 'm1',
      media: { kind: 'image', filePath: httpFile, mimeType: 'image/jpeg', sizeBytes: 13 },
    };
    await server.handle({ method: 'sendMediaMessage', args: [input] });
    expect(engine.sendMediaMessage).toHaveBeenCalledWith(input);
    expect(store.download).not.toHaveBeenCalled();
    expect(store.delete).not.toHaveBeenCalled();
  });
});
