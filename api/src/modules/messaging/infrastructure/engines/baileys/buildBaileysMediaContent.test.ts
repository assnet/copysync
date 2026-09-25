import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareWAMessageMedia, type AnyMediaMessageContent } from '@whiskeysockets/baileys';
import { buildBaileysMediaContent } from './buildBaileysMediaContent';
import type { OutboundMedia } from '../../../domain/contracts/IMessagingEngine';

const ARQUIVO = '/srv/media/sessao-1/ABC123.bin';
const MINIATURA = Buffer.from('miniatura-jpeg').toString('base64');
const ONDA = new Uint8Array([0, 12, 40, 63, 20]);

const media = (over: Partial<OutboundMedia> = {}): OutboundMedia => ({
  kind: 'image',
  filePath: ARQUIVO,
  mimeType: 'image/jpeg',
  sizeBytes: 1_024,
  ...over,
});

describe('buildBaileysMediaContent — imagem', () => {
  it('envia o arquivo do disco com MIME e legenda', () => {
    expect(buildBaileysMediaContent(media({ caption: 'foto do pedido' }))).toStrictEqual({
      image: { url: ARQUIVO },
      mimetype: 'image/jpeg',
      caption: 'foto do pedido',
    });
  });

  it('não leva metadados que a imagem não usa', () => {
    const content = buildBaileysMediaContent(media({
      width: 800, height: 600, durationSeconds: 3, thumbnailJpegBase64: MINIATURA, waveform: ONDA, fileName: 'x.jpg',
    }));
    expect(content).toStrictEqual({ image: { url: ARQUIVO }, mimetype: 'image/jpeg' });
  });
});

describe('buildBaileysMediaContent — vídeo', () => {
  it('leva duração, dimensões, miniatura em base64 e nunca vira GIF', () => {
    const content = buildBaileysMediaContent(media({
      kind: 'video', mimeType: 'video/mp4', caption: 'olha isso',
      durationSeconds: 42, width: 1280, height: 720, thumbnailJpegBase64: MINIATURA,
    }));
    expect(content).toStrictEqual({
      video: { url: ARQUIVO },
      mimetype: 'video/mp4',
      caption: 'olha isso',
      seconds: 42,
      width: 1280,
      height: 720,
      jpegThumbnail: MINIATURA,
      gifPlayback: false,
    });
  });

  it('sem metadados sai só o essencial (a lib gera a miniatura dela)', () => {
    const content = buildBaileysMediaContent(media({
      kind: 'video', mimeType: 'video/mp4',
      durationSeconds: null, width: null, height: null, thumbnailJpegBase64: null,
    }));
    expect(content).toStrictEqual({ video: { url: ARQUIVO }, mimetype: 'video/mp4', gifPlayback: false });
  });
});

describe('buildBaileysMediaContent — voz', () => {
  it('marca ptt no nível de cima, com MIME de nota de voz, duração e forma de onda', () => {
    const content = buildBaileysMediaContent(media({
      kind: 'voice', mimeType: 'audio/ogg', durationSeconds: 7, waveform: ONDA,
    }));
    expect(content).toStrictEqual({
      audio: { url: ARQUIVO },
      ptt: true,
      mimetype: 'audio/ogg; codecs=opus',
      seconds: 7,
      waveform: ONDA,
    });
    // `ptt` dentro do objeto do arquivo é ignorado pela lib — o áudio chegaria como arquivo.
    expect((content as { audio: object }).audio).toStrictEqual({ url: ARQUIVO });
  });

  it('nota de voz não tem legenda', () => {
    const content = buildBaileysMediaContent(media({ kind: 'voice', caption: 'não vai' }));
    expect(content).not.toHaveProperty('caption');
  });

  it('forma de onda ausente ou vazia fica de fora (a lib calcula a dela)', () => {
    for (const waveform of [null, undefined, new Uint8Array(0)]) {
      expect(buildBaileysMediaContent(media({ kind: 'voice', waveform }))).not.toHaveProperty('waveform');
    }
  });
});

describe('buildBaileysMediaContent — documento', () => {
  it('sempre leva MIME e nome do arquivo, com legenda quando houver', () => {
    const content = buildBaileysMediaContent(media({
      kind: 'document', mimeType: 'application/zip', fileName: 'contrato.zip', caption: 'segue',
    }));
    expect(content).toStrictEqual({
      document: { url: ARQUIVO },
      mimetype: 'application/zip',
      fileName: 'contrato.zip',
      caption: 'segue',
    });
  });

  it('sem MIME nem nome não cai no padrão da lib (PDF): vai como binário genérico', () => {
    const content = buildBaileysMediaContent(media({ kind: 'document', mimeType: '', fileName: '  ' }));
    expect(content).toStrictEqual({
      document: { url: ARQUIVO },
      mimetype: 'application/octet-stream',
      fileName: 'file',
    });
  });
});

describe('buildBaileysMediaContent — campos vazios', () => {
  it('legenda vazia ou só com espaços fica de fora', () => {
    for (const caption of [null, undefined, '', '   \n']) {
      expect(buildBaileysMediaContent(media({ caption }))).not.toHaveProperty('caption');
      expect(buildBaileysMediaContent(media({ kind: 'document', fileName: 'a.pdf', caption }))).not.toHaveProperty('caption');
    }
  });

  it('MIME vazio de imagem e vídeo fica de fora (a lib usa o padrão do tipo)', () => {
    expect(buildBaileysMediaContent(media({ mimeType: '' }))).not.toHaveProperty('mimetype');
    expect(buildBaileysMediaContent(media({ kind: 'video', mimeType: '' }))).not.toHaveProperty('mimetype');
  });

  it('números inválidos ficam de fora e os válidos saem inteiros', () => {
    const invalidos = buildBaileysMediaContent(media({
      kind: 'video', mimeType: 'video/mp4', durationSeconds: 0, width: -1, height: Number.NaN,
    }));
    expect(invalidos).not.toHaveProperty('seconds');
    expect(invalidos).not.toHaveProperty('width');
    expect(invalidos).not.toHaveProperty('height');

    const fracionados = buildBaileysMediaContent(media({
      kind: 'video', mimeType: 'video/mp4', durationSeconds: 12.6, width: 640.4, height: 359.5,
    }));
    expect(fracionados).toMatchObject({ seconds: 13, width: 640, height: 360 });
  });

  it('miniatura vazia fica de fora', () => {
    expect(buildBaileysMediaContent(media({ kind: 'video', thumbnailJpegBase64: '' }))).not.toHaveProperty('jpegThumbnail');
  });
});

/**
 * Passa o conteúdo pelo preparo real da lib (`prepareWAMessageMedia`) com um upload falso e um
 * arquivo pequeno: confirma que os campos chegam ao proto que vai para o WhatsApp. Nenhum dos
 * casos aciona sharp/ffmpeg da lib — duração, miniatura e onda já vêm prontas.
 */
describe('buildBaileysMediaContent — conteúdo aceito pelo preparo da lib', () => {
  let pasta: string;
  let arquivo: string;
  const upload = async () => ({ mediaUrl: 'https://midia.invalid/x', directPath: '/v/x' });
  const preparar = (content: unknown) => prepareWAMessageMedia(content as AnyMediaMessageContent, { upload });

  beforeAll(async () => {
    pasta = await mkdtemp(join(tmpdir(), 'media-content-'));
    arquivo = join(pasta, 'midia.bin');
    await writeFile(arquivo, Buffer.from('conteudo pequeno de teste'));
  });

  afterAll(async () => {
    await rm(pasta, { recursive: true, force: true });
  });

  it('voz chega como nota de voz com duração, onda e MIME', async () => {
    const proto = await preparar(buildBaileysMediaContent(media({
      kind: 'voice', filePath: arquivo, mimeType: 'audio/ogg', durationSeconds: 7, waveform: ONDA,
    })));
    expect(proto.audioMessage?.ptt).toBe(true);
    expect(proto.audioMessage?.seconds).toBe(7);
    expect(proto.audioMessage?.mimetype).toBe('audio/ogg; codecs=opus');
    expect(Array.from(proto.audioMessage?.waveform ?? [])).toEqual(Array.from(ONDA));
  });

  it('documento chega com nome, MIME e legenda', async () => {
    const proto = await preparar(buildBaileysMediaContent(media({
      kind: 'document', filePath: arquivo, mimeType: 'application/zip', fileName: 'contrato.zip', caption: 'segue',
    })));
    expect(proto.documentMessage?.fileName).toBe('contrato.zip');
    expect(proto.documentMessage?.mimetype).toBe('application/zip');
    expect(proto.documentMessage?.caption).toBe('segue');
  });

  it('vídeo chega com duração, dimensões e a miniatura decodificada', async () => {
    const proto = await preparar(buildBaileysMediaContent(media({
      kind: 'video', filePath: arquivo, mimeType: 'video/mp4',
      durationSeconds: 42, width: 1280, height: 720, thumbnailJpegBase64: MINIATURA,
    })));
    expect(proto.videoMessage?.seconds).toBe(42);
    expect(proto.videoMessage?.width).toBe(1280);
    expect(proto.videoMessage?.height).toBe(720);
    expect(proto.videoMessage?.gifPlayback).toBe(false);
    expect(Buffer.from(proto.videoMessage?.jpegThumbnail ?? []).toString('base64')).toBe(MINIATURA);
  });
});
