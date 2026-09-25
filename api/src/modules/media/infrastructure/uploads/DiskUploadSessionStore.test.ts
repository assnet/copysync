import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { DiskUploadSessionStore, uploadVoiceFilePath } from './DiskUploadSessionStore';
import type { CreateUploadSessionInput } from '../../domain/contracts/IUploadSessionStore';
import { logger } from '../../../../shared/logger/logger';

const MINUTE = 60_000;
const T0 = new Date('2026-09-25T12:00:00.000Z');

let root: string;
let dir: string;
let clock: Date;

function makeStore(): DiskUploadSessionStore {
  return new DiskUploadSessionStore({ dir, now: () => clock });
}

function input(overrides: Partial<CreateUploadSessionInput> = {}): CreateUploadSessionInput {
  return {
    tenantId: 'tenant-a',
    userId: 'user-a',
    purpose: 'document',
    fileName: 'relatorio.pdf',
    declaredMimeType: 'application/pdf',
    sizeBytes: 10,
    chunkSizeBytes: 4,
    ...overrides,
  };
}

/** Conteúdo de 10 bytes em 3 partes de chunk 4: [0..3], [4..7], [8..9]. */
const CONTENT = Buffer.from('0123456789');
const part = (index: number) => CONTENT.subarray(index * 4, Math.min(index * 4 + 4, CONTENT.length));

async function completeUpload(store: DiskUploadSessionStore, uploadId: string): Promise<void> {
  for (const index of [0, 1, 2]) await store.writePart(uploadId, index, part(index));
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'upload-store-'));
  dir = path.join(root, 'media-uploads');
  await fs.mkdir(dir);
  clock = T0;
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('DiskUploadSessionStore', () => {
  it('cria o upload aberto com o arquivo já do tamanho declarado', async () => {
    const store = makeStore();

    const record = await store.create(input());

    expect(record).toMatchObject({
      tenantId: 'tenant-a',
      userId: 'user-a',
      purpose: 'document',
      fileName: 'relatorio.pdf',
      declaredMimeType: 'application/pdf',
      sizeBytes: 10,
      chunkSizeBytes: 4,
      totalParts: 3,
      receivedParts: [],
      state: 'OPEN',
      externalMessageId: null,
      messageId: null,
      createdAt: T0.toISOString(),
      updatedAt: T0.toISOString(),
    });
    expect(record.uploadId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect((await fs.stat(path.join(dir, `${record.uploadId}.bin`))).size).toBe(10);
    expect(await store.get(record.uploadId, 'tenant-a', 'user-a')).toEqual(record);
  });

  it('partes fora de ordem montam o arquivo byte a byte certo', async () => {
    const store = makeStore();
    const { uploadId } = await store.create(input());

    await store.writePart(uploadId, 2, part(2));
    await store.writePart(uploadId, 0, part(0));
    const result = await store.writePart(uploadId, 1, part(1));

    expect(result).toMatchObject({ status: 'written', record: { receivedParts: [0, 1, 2] } });
    expect(await fs.readFile(store.binPath(uploadId) as string)).toEqual(CONTENT);
  });

  it('parte repetida sobrescreve igual e não duplica o registro de recebidas', async () => {
    const store = makeStore();
    const { uploadId } = await store.create(input());

    await store.writePart(uploadId, 1, part(1));
    await store.writePart(uploadId, 1, part(1));

    const record = await store.get(uploadId, 'tenant-a', 'user-a');
    expect(record?.receivedParts).toEqual([1]);
    const bin = await fs.readFile(store.binPath(uploadId) as string);
    expect(bin.subarray(4, 8)).toEqual(part(1));
  });

  it('escritas concorrentes da mesma parte e de partes diferentes não corrompem o lateral', async () => {
    const store = makeStore();
    const { uploadId } = await store.create(input());

    await Promise.all([2, 0, 1, 1, 0, 2, 1].map((index) => store.writePart(uploadId, index, part(index))));

    const lateral = JSON.parse(await fs.readFile(path.join(dir, `${uploadId}.json`), 'utf8'));
    expect(lateral.receivedParts).toEqual([0, 1, 2]);
    expect(await fs.readFile(store.binPath(uploadId) as string)).toEqual(CONTENT);
    expect((await fs.readdir(dir)).sort()).toEqual([`${uploadId}.bin`, `${uploadId}.json`]);
  });

  it('uma nova instância retoma o upload de onde parou (reinício do processo)', async () => {
    const first = makeStore();
    const { uploadId } = await first.create(input());
    await first.writePart(uploadId, 0, part(0));

    const second = makeStore();
    expect((await second.get(uploadId, 'tenant-a', 'user-a'))?.receivedParts).toEqual([0]);

    await second.writePart(uploadId, 1, part(1));
    await second.writePart(uploadId, 2, part(2));
    expect(await fs.readFile(second.binPath(uploadId) as string)).toEqual(CONTENT);
  });

  it('parte fora do plano é recusada sem tocar no arquivo', async () => {
    const store = makeStore();
    const { uploadId } = await store.create(input());

    await expect(store.writePart(uploadId, 3, Buffer.from('ab'))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(store.writePart(uploadId, 2, Buffer.from('abcd'))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect((await fs.stat(store.binPath(uploadId) as string)).size).toBe(10);
    expect((await store.get(uploadId, 'tenant-a', 'user-a'))?.receivedParts).toEqual([]);
  });

  it('upload de outro tenant ou de outro usuário é tratado como inexistente', async () => {
    const store = makeStore();
    const { uploadId } = await store.create(input());

    expect(await store.get(uploadId, 'tenant-b', 'user-a')).toBeNull();
    expect(await store.get(uploadId, 'tenant-a', 'user-b')).toBeNull();
    expect(await store.beginConsume(uploadId, 'tenant-b', 'user-a')).toEqual({ outcome: 'not_found' });
  });

  it('id com travessia de caminho é tratado como inexistente e não alcança arquivo fora da pasta', async () => {
    const store = makeStore();
    const { uploadId } = await store.create(input());
    const outside = path.join(root, `${uploadId}.json`);
    await fs.copyFile(path.join(dir, `${uploadId}.json`), outside);
    const traversal = `../${uploadId}`;

    expect(await store.get(traversal, 'tenant-a', 'user-a')).toBeNull();
    expect(await store.writePart(traversal, 0, part(0))).toEqual({ status: 'not_found' });
    expect(await store.beginConsume(traversal, 'tenant-a', 'user-a')).toEqual({ outcome: 'not_found' });
    expect(await store.readHead(traversal, 4)).toBeNull();
    expect(store.binPath(traversal)).toBeNull();
    await store.discard(traversal);
    await expect(fs.access(outside)).resolves.toBeUndefined();
  });

  it('confirmar upload incompleto não muda o estado', async () => {
    const store = makeStore();
    const { uploadId } = await store.create(input());
    await store.writePart(uploadId, 0, part(0));
    const before = await store.get(uploadId, 'tenant-a', 'user-a');

    clock = new Date(T0.getTime() + MINUTE);
    const result = await store.beginConsume(uploadId, 'tenant-a', 'user-a');

    expect(result).toEqual({ outcome: 'incomplete', record: before });
    expect(await store.get(uploadId, 'tenant-a', 'user-a')).toEqual(before);
  });

  it('percorre o consumo: começa, grava id externo, conclui e responde a repetição com a mesma mensagem', async () => {
    const store = makeStore();
    const { uploadId } = await store.create(input());
    await completeUpload(store, uploadId);

    const started = await store.beginConsume(uploadId, 'tenant-a', 'user-a');
    expect(started).toMatchObject({ outcome: 'started', record: { state: 'CONSUMING' } });
    expect(await store.beginConsume(uploadId, 'tenant-a', 'user-a')).toMatchObject({ outcome: 'in_progress' });
    expect(await store.writePart(uploadId, 0, part(0))).toMatchObject({ status: 'not_open' });

    expect(await store.setExternalId(uploadId, 'EXT-1')).toMatchObject({ externalMessageId: 'EXT-1' });
    expect(await store.finishConsume(uploadId, 'msg-1')).toMatchObject({ state: 'CONSUMED', messageId: 'msg-1' });

    expect(await store.beginConsume(uploadId, 'tenant-a', 'user-a')).toMatchObject({
      outcome: 'consumed',
      messageId: 'msg-1',
    });
  });

  it('liberar o consumo devolve o upload para aberto e esquece o id externo', async () => {
    const store = makeStore();
    const { uploadId } = await store.create(input());
    await completeUpload(store, uploadId);
    await store.beginConsume(uploadId, 'tenant-a', 'user-a');
    await store.setExternalId(uploadId, 'EXT-1');

    const released = await store.releaseConsume(uploadId);

    expect(released).toMatchObject({ state: 'OPEN', externalMessageId: null });
    expect(await store.beginConsume(uploadId, 'tenant-a', 'user-a')).toMatchObject({ outcome: 'started' });
  });

  it('reserva de disco soma só uploads abertos ou em consumo', async () => {
    const store = makeStore();
    await store.create(input({ sizeBytes: 10 }));
    const consuming = await store.create(input({ sizeBytes: 20, chunkSizeBytes: 20 }));
    const consumed = await store.create(input({ sizeBytes: 30, chunkSizeBytes: 30 }));
    await store.writePart(consuming.uploadId, 0, Buffer.alloc(20));
    await store.writePart(consumed.uploadId, 0, Buffer.alloc(30));
    await store.beginConsume(consuming.uploadId, 'tenant-a', 'user-a');
    await store.beginConsume(consumed.uploadId, 'tenant-a', 'user-a');
    await store.finishConsume(consumed.uploadId, 'msg-1');

    expect(await store.openReservedBytes()).toBe(30);
  });

  it('conta os uploads não consumidos só do usuário no tenant', async () => {
    const store = makeStore();
    await store.create(input());
    const consuming = await store.create(input());
    const consumed = await store.create(input());
    await store.create(input({ userId: 'user-b' }));
    await store.create(input({ tenantId: 'tenant-b' }));
    await completeUpload(store, consuming.uploadId);
    await completeUpload(store, consumed.uploadId);
    await store.beginConsume(consuming.uploadId, 'tenant-a', 'user-a');
    await store.beginConsume(consumed.uploadId, 'tenant-a', 'user-a');
    await store.finishConsume(consumed.uploadId, 'msg-1');

    expect(await store.countOpenByUser('tenant-a', 'user-a')).toBe(2);
  });

  it('lista por estado para a reconciliação encontrar consumos interrompidos', async () => {
    const store = makeStore();
    await store.create(input());
    const consuming = await store.create(input());
    await completeUpload(store, consuming.uploadId);
    await store.beginConsume(consuming.uploadId, 'tenant-a', 'user-a');
    await store.setExternalId(consuming.uploadId, 'EXT-9');

    const found = await store.listByState('CONSUMING');

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ uploadId: consuming.uploadId, externalMessageId: 'EXT-9' });
  });

  it('expira pela última atividade, não pela criação', async () => {
    const store = makeStore();
    const active = await store.create(input());
    clock = new Date(T0.getTime() + 10 * MINUTE);
    const idle = await store.create(input());
    clock = new Date(T0.getTime() + 20 * MINUTE);
    await store.writePart(active.uploadId, 0, part(0));

    const now = new Date(T0.getTime() + 131 * MINUTE);

    expect(await store.listExpired(now, 120 * MINUTE)).toEqual([idle.uploadId]);
  });

  it('arquivo sem lateral expira pelo horário de modificação', async () => {
    const store = makeStore();
    const staleId = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
    const freshId = '6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b';
    await fs.writeFile(path.join(dir, `${staleId}.bin`), '');
    await fs.writeFile(path.join(dir, `${freshId}.bin`), '');
    await fs.writeFile(path.join(dir, 'arquivo-estranho.txt'), '');
    const old = new Date(Date.now() - 200 * MINUTE);
    await fs.utimes(path.join(dir, `${staleId}.bin`), old, old);

    expect(await store.listExpired(new Date(), 120 * MINUTE)).toEqual([staleId]);
  });

  it('descartar apaga arquivo e lateral e pode ser repetido', async () => {
    const store = makeStore();
    const { uploadId } = await store.create(input());

    await store.discard(uploadId);
    await store.discard(uploadId);

    expect(await store.get(uploadId, 'tenant-a', 'user-a')).toBeNull();
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('a nota de voz transcodificada fica na pasta de uploads e expira junto com o upload', async () => {
    const store = makeStore();
    const { uploadId } = await store.create(input({ purpose: 'voice' }));
    const voz = uploadVoiceFilePath(dir, uploadId, 'ogg');
    await fs.writeFile(voz, 'opus');

    expect(path.dirname(voz)).toBe(dir);
    expect(path.basename(voz)).toBe(`${uploadId}.voice.ogg`);
    expect(await store.listExpired(new Date(T0.getTime() + 121 * MINUTE), 120 * MINUTE)).toEqual([uploadId]);
  });

  it('nota de voz que sobrou sozinha (transcode interrompido) expira pelo horário de modificação', async () => {
    const store = makeStore();
    const orfaId = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
    const voz = uploadVoiceFilePath(dir, orfaId, 'ogg');
    await fs.writeFile(voz, 'opus');
    const old = new Date(Date.now() - 200 * MINUTE);
    await fs.utimes(voz, old, old);

    expect(await store.listExpired(new Date(), 120 * MINUTE)).toEqual([orfaId]);

    await store.discard(orfaId);
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('descartar apaga também a nota de voz do upload e preserva a de outro upload', async () => {
    const store = makeStore();
    const { uploadId } = await store.create(input({ purpose: 'voice' }));
    const outro = await store.create(input({ purpose: 'voice' }));
    await fs.writeFile(uploadVoiceFilePath(dir, uploadId, 'ogg'), 'opus');
    await fs.writeFile(uploadVoiceFilePath(dir, outro.uploadId, 'ogg'), 'opus');

    await store.discard(uploadId);

    expect((await fs.readdir(dir)).sort()).toEqual(
      [`${outro.uploadId}.bin`, `${outro.uploadId}.json`, `${outro.uploadId}.voice.ogg`].sort(),
    );
  });

  it('descarte condicional de upload aberto apaga também a nota de voz', async () => {
    const store = makeStore();
    const { uploadId } = await store.create(input({ purpose: 'voice' }));
    await fs.writeFile(uploadVoiceFilePath(dir, uploadId, 'ogg'), 'opus');

    expect(await store.discardIfOpen(uploadId)).toBe(true);
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('descarte condicional apaga upload aberto e preserva o que já está em consumo', async () => {
    const store = makeStore();
    const aberto = await store.create(input());
    const consumindo = await store.create(input());
    await completeUpload(store, consumindo.uploadId);
    await store.beginConsume(consumindo.uploadId, 'tenant-a', 'user-a');

    expect(await store.discardIfOpen(aberto.uploadId)).toBe(true);
    expect(await store.discardIfOpen(consumindo.uploadId)).toBe(false);

    expect(await store.get(aberto.uploadId, 'tenant-a', 'user-a')).toBeNull();
    expect((await store.get(consumindo.uploadId, 'tenant-a', 'user-a'))?.state).toBe('CONSUMING');
    expect(await store.readHead(consumindo.uploadId, 4)).not.toBeNull();
  });

  it('descarte condicional concorrente com o início do consumo nunca apaga o arquivo do consumo', async () => {
    const store = makeStore();
    const { uploadId } = await store.create(input());
    await completeUpload(store, uploadId);

    const [consumo, descartou] = await Promise.all([
      store.beginConsume(uploadId, 'tenant-a', 'user-a'),
      store.discardIfOpen(uploadId),
    ]);

    // O mutex serializa: ou o consumo começou e o arquivo fica, ou o descarte venceu e não há consumo.
    if (consumo.outcome === 'started') {
      expect(descartou).toBe(false);
      expect(await store.readHead(uploadId, 4)).not.toBeNull();
    } else {
      expect(descartou).toBe(true);
      expect(consumo.outcome).toBe('not_found');
    }
  });

  it('lê o começo do arquivo para identificar o tipo', async () => {
    const store = makeStore();
    const { uploadId } = await store.create(input());
    await completeUpload(store, uploadId);

    expect(Buffer.from((await store.readHead(uploadId, 4)) as Uint8Array)).toEqual(Buffer.from('0123'));
    expect(Buffer.from((await store.readHead(uploadId, 4096)) as Uint8Array)).toEqual(CONTENT);
    expect(store.binPath(uploadId)).toBe(path.join(dir, `${uploadId}.bin`));
  });

  it('informa total e livre do disco da pasta de uploads', async () => {
    const stats = await makeStore().diskStats();

    expect(stats.totalBytes).toBeGreaterThan(0);
    expect(stats.freeBytes).toBeGreaterThanOrEqual(0);
    expect(stats.freeBytes).toBeLessThanOrEqual(stats.totalBytes);
  });

  it('no boot cria a pasta e reconhece a mídia no mesmo dispositivo sem alertar', async () => {
    const warn = vi.spyOn(logger, 'warn');
    dir = path.join(root, 'nova', 'media-uploads');
    const mediaDir = path.join(root, 'storage', 'media');

    const result = await makeStore().ensureReady(mediaDir);

    expect(result).toEqual({ sameDevice: true });
    expect((await fs.stat(dir)).isDirectory()).toBe(true);
    expect(await fs.readdir(dir)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});
