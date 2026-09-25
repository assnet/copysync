import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { LocalMediaFileStore } from './LocalMediaFileStore';
import { mediaPublicUrl } from '../../../../shared/storage/MediaStorage';

// Pasta temporária própria por teste: roda em paralelo sem disputar arquivo.
let root: string;
let mediaDir: string;
let store: LocalMediaFileStore;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'local-media-file-store-'));
  mediaDir = path.join(root, 'media');
  store = new LocalMediaFileStore(mediaDir);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function createSource(content = 'conteudo-da-midia'): Promise<string> {
  const srcPath = path.join(root, 'upload.part');
  await fs.writeFile(srcPath, content);
  return srcPath;
}

async function fileExists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(() => true, () => false);
}

describe('LocalMediaFileStore.promote', () => {
  it('move o arquivo para a pasta de mídia com o nome que o download usaria', async () => {
    const srcPath = await createSource('abc123');

    const result = await store.promote({
      srcPath,
      sessionId: 'sess_1',
      externalMessageId: '3EB0ABC',
      mimeType: 'application/pdf',
    });

    expect(result.localPath).toBe(path.join(mediaDir, 'sess_1_3EB0ABC.pdf'));
    expect(result.publicUrl).toBe(mediaPublicUrl('sess_1_3EB0ABC.pdf'));
    expect(result.sizeBytes).toBe(6);
    expect(await fs.readFile(result.localPath, 'utf8')).toBe('abc123');
    expect(await fileExists(srcPath)).toBe(false);
  });

  it('usa a extensão do mesmo mapa do download (parâmetros do MIME type não entram)', async () => {
    const result = await store.promote({
      srcPath: await createSource(),
      sessionId: 'sess-1',
      externalMessageId: 'ABC_123',
      mimeType: 'audio/ogg; codecs=opus',
    });

    expect(path.basename(result.localPath)).toBe('sess-1_ABC_123.ogg');
  });

  it('copia e apaga a origem quando a pasta temporária está em outro disco', async () => {
    const srcPath = await createSource('entre-discos');
    const crossDevice = Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' });
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(crossDevice);

    const result = await store.promote({
      srcPath,
      sessionId: 'sess_1',
      externalMessageId: 'MSG1',
      mimeType: 'image/jpeg',
    });

    expect(path.basename(result.localPath)).toBe('sess_1_MSG1.jpg');
    expect(await fs.readFile(result.localPath, 'utf8')).toBe('entre-discos');
    expect(result.sizeBytes).toBe(12);
    expect(await fileExists(srcPath)).toBe(false);
  });

  it('propaga outra falha do rename sem apagar a origem', async () => {
    const srcPath = await createSource();
    const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(denied);

    await expect(
      store.promote({ srcPath, sessionId: 'sess_1', externalMessageId: 'MSG1', mimeType: 'image/jpeg' }),
    ).rejects.toBe(denied);
    expect(await fileExists(srcPath)).toBe(true);
  });

  it.each([
    ['sessão com ..', '../fora', 'MSG1'],
    ['sessão com barra', 'a/b', 'MSG1'],
    ['sessão vazia', '', 'MSG1'],
    ['id com barra invertida', 'sess_1', 'a\\b'],
    ['id com ponto', 'sess_1', 'a.b'],
    ['id vazio', 'sess_1', ''],
  ])('recusa montar caminho com identificador inválido (%s)', async (_caso, sessionId, externalMessageId) => {
    const srcPath = await createSource();

    await expect(
      store.promote({ srcPath, sessionId, externalMessageId, mimeType: 'image/jpeg' }),
    ).rejects.toThrow();
    expect(await fileExists(srcPath)).toBe(true);
    expect(await fileExists(mediaDir)).toBe(false);
  });
});

describe('LocalMediaFileStore.resolveLocalPath', () => {
  it('devolve o caminho no disco de uma URL de mídia desta pasta', () => {
    expect(store.resolveLocalPath(mediaPublicUrl('sess_1_MSG1.jpg'))).toBe(
      path.join(mediaDir, 'sess_1_MSG1.jpg'),
    );
  });

  it('aceita de volta a URL que a promoção devolveu', async () => {
    const result = await store.promote({
      srcPath: await createSource(),
      sessionId: 'sess_1',
      externalMessageId: 'MSG1',
      mimeType: 'video/mp4',
    });

    expect(store.resolveLocalPath(result.publicUrl)).toBe(result.localPath);
  });

  it.each([
    ['sobe de pasta', mediaPublicUrl('../segredo.txt')],
    ['sobe no meio do caminho', mediaPublicUrl('a/../../segredo.txt')],
    ['subpasta', mediaPublicUrl('sub/a.jpg')],
    ['barra invertida', mediaPublicUrl('..\\segredo.txt')],
    ['.. no nome', mediaPublicUrl('a..b.jpg')],
    ['arquivo oculto', mediaPublicUrl('.oculto')],
    ['nome vazio', mediaPublicUrl('')],
    ['byte nulo', mediaPublicUrl('a.jpg\0.txt')],
    ['outro prefixo', '/outro/storage/media/a.jpg'],
    ['prefixo sem a barra final', mediaPublicUrl('').slice(0, -1)],
    ['URL absoluta', `http://externo${mediaPublicUrl('a.jpg')}`],
  ])('recusa URL que não aponta para um arquivo da pasta (%s)', (_caso, mediaUrl) => {
    expect(store.resolveLocalPath(mediaUrl)).toBeNull();
  });
});

describe('LocalMediaFileStore.remove / exists', () => {
  it('apaga o arquivo e não falha quando ele já não existe', async () => {
    const { localPath } = await store.promote({
      srcPath: await createSource(),
      sessionId: 'sess_1',
      externalMessageId: 'MSG1',
      mimeType: 'image/png',
    });
    expect(await store.exists(localPath)).toBe(true);

    await store.remove(localPath);
    expect(await store.exists(localPath)).toBe(false);

    await expect(store.remove(localPath)).resolves.toBeUndefined();
  });

  it('diz que não existe o arquivo nunca criado', async () => {
    expect(await store.exists(path.join(mediaDir, 'nada.jpg'))).toBe(false);
  });
});
