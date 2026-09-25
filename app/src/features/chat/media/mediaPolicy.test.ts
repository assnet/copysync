import { describe, it, expect } from 'vitest';
import type { MediaUploadConfigDto } from '@/types/media.api.types';
import { classifyAttachment, formatBytesLabel, validateBatch } from './mediaPolicy';

type Limits = MediaUploadConfigDto['limits'];

/** Limites padrão do servidor: imagem 16 MB, vídeo inline e documento 180 MB, lote de 30. */
function configCom(limits: Partial<Limits> = {}): MediaUploadConfigDto {
  return {
    chunkSizeBytes: 4_000_000,
    maxFilesPerBatch: 30,
    maxVoiceSeconds: 900,
    maxCaptionLength: 4096,
    limits: {
      imageBytes: 16_000_000,
      inlineVideoBytes: 180_000_000,
      documentBytes: 180_000_000,
      voiceBytes: 16_000_000,
      ...limits,
    },
    capabilities: { voiceNotes: true, videoMetadata: true },
  };
}

const padrao = configCom();
/** Documento maior que o vídeo inline: separa "vira documento" de "passa do limite". */
const documentoMaior = configCom({ documentBytes: 250_000_000 });

const arquivo = (name: string, type: string, size = 1_000) => ({ name, type, size });

describe('anexo escolhido como documento', () => {
  it('envia qualquer arquivo como documento, sem aviso de conversão', () => {
    expect(classifyAttachment(arquivo('contrato.pdf', 'application/pdf'), 'document', padrao)).toEqual({
      kind: 'document',
      purpose: 'document',
      convertedToDocument: false,
      blocked: null,
      limitBytes: 180_000_000,
    });
  });

  it('envia foto e vídeo também como documento quando o operador escolhe "Documento"', () => {
    const foto = classifyAttachment(arquivo('foto.jpg', 'image/jpeg'), 'document', padrao);
    const video = classifyAttachment(arquivo('video.mp4', 'video/mp4'), 'document', padrao);
    expect(foto).toMatchObject({ kind: 'document', purpose: 'document', convertedToDocument: false });
    expect(video).toMatchObject({ kind: 'document', purpose: 'document', convertedToDocument: false });
  });

  it('aceita exatamente no limite de documento e bloqueia 1 byte acima', () => {
    const noLimite = classifyAttachment(arquivo('a.zip', 'application/zip', 180_000_000), 'document', padrao);
    const acima = classifyAttachment(arquivo('a.zip', 'application/zip', 180_000_001), 'document', padrao);
    expect(noLimite.blocked).toBeNull();
    expect(acima).toMatchObject({ blocked: 'too_large', limitBytes: 180_000_000 });
  });
});

describe('arquivo vazio', () => {
  it.each(['media', 'document', 'auto'] as const)('é bloqueado na origem %s', (origin) => {
    expect(classifyAttachment(arquivo('foto.jpg', 'image/jpeg', 0), origin, padrao).blocked).toBe('empty');
  });
});

describe('anexo escolhido em "Fotos e vídeos"', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('envia %s dentro do limite como imagem', (type) => {
    expect(classifyAttachment(arquivo('foto', type), 'media', padrao)).toEqual({
      kind: 'image',
      purpose: 'media',
      convertedToDocument: false,
      blocked: null,
      limitBytes: 16_000_000,
    });
  });

  it('aceita a imagem exatamente no limite e converte 1 byte acima em documento', () => {
    const noLimite = classifyAttachment(arquivo('foto.png', 'image/png', 16_000_000), 'media', padrao);
    const acima = classifyAttachment(arquivo('foto.png', 'image/png', 16_000_001), 'media', padrao);
    expect(noLimite.kind).toBe('image');
    expect(acima).toEqual({
      kind: 'document',
      purpose: 'media',
      convertedToDocument: true,
      blocked: null,
      limitBytes: 180_000_000,
    });
  });

  it.each(['image/heic', 'image/heif', 'image/gif', 'image/svg+xml'])(
    'converte %s em documento com aviso',
    (type) => {
      expect(classifyAttachment(arquivo('foto', type), 'media', padrao)).toMatchObject({
        kind: 'document',
        purpose: 'media',
        convertedToDocument: true,
        blocked: null,
      });
    },
  );

  it.each(['video/mp4', 'video/3gpp'])('envia %s dentro do limite inline como vídeo', (type) => {
    expect(classifyAttachment(arquivo('video', type, 180_000_000), 'media', padrao)).toEqual({
      kind: 'video',
      purpose: 'media',
      convertedToDocument: false,
      blocked: null,
      limitBytes: 180_000_000,
    });
  });

  it('converte em documento o vídeo 1 byte acima do limite inline', () => {
    expect(classifyAttachment(arquivo('v.mp4', 'video/mp4', 180_000_001), 'media', documentoMaior)).toEqual({
      kind: 'document',
      purpose: 'media',
      convertedToDocument: true,
      blocked: null,
      limitBytes: 250_000_000,
    });
  });

  it.each(['video/quicktime', 'video/webm', 'video/x-matroska'])('converte %s em documento com aviso', (type) => {
    expect(classifyAttachment(arquivo('video', type), 'media', padrao)).toMatchObject({
      kind: 'document',
      purpose: 'media',
      convertedToDocument: true,
      blocked: null,
    });
  });

  it('bloqueia o vídeo que passa do inline e também do limite de documento', () => {
    expect(classifyAttachment(arquivo('v.mp4', 'video/mp4', 180_000_001), 'media', padrao)).toMatchObject({
      kind: 'document',
      convertedToDocument: true,
      blocked: 'too_large',
      limitBytes: 180_000_000,
    });
  });

  it('avisa que vai como documento o arquivo que não é foto nem vídeo', () => {
    expect(classifyAttachment(arquivo('nota.pdf', 'application/pdf'), 'media', padrao)).toMatchObject({
      kind: 'document',
      purpose: 'document',
      convertedToDocument: true,
      blocked: null,
    });
  });
});

describe('anexo arrastado ou colado (classificação automática)', () => {
  it('segue as regras de foto e vídeo para imagem e vídeo', () => {
    expect(classifyAttachment(arquivo('a.jpg', 'image/jpeg'), 'auto', padrao).kind).toBe('image');
    expect(classifyAttachment(arquivo('a.mp4', 'video/mp4'), 'auto', padrao).kind).toBe('video');
    expect(classifyAttachment(arquivo('a.heic', 'image/heic'), 'auto', padrao)).toMatchObject({
      kind: 'document',
      purpose: 'media',
      convertedToDocument: true,
    });
  });

  it('envia o que não é foto nem vídeo como documento, sem aviso de conversão', () => {
    expect(classifyAttachment(arquivo('planilha.xlsx', 'application/vnd.ms-excel'), 'auto', padrao)).toEqual({
      kind: 'document',
      purpose: 'document',
      convertedToDocument: false,
      blocked: null,
      limitBytes: 180_000_000,
    });
  });

  it('bloqueia documento acima do limite', () => {
    const grande = arquivo('backup.zip', 'application/zip', 180_000_001);
    expect(classifyAttachment(grande, 'auto', padrao).blocked).toBe('too_large');
  });
});

describe('tipo vazio informado pelo navegador', () => {
  it.each([
    ['foto.JPG', 'image', false],
    ['foto.jpeg', 'image', false],
    ['foto.png', 'image', false],
    ['foto.webp', 'image', false],
    ['foto.heic', 'document', true],
    ['anim.gif', 'document', true],
    ['logo.svg', 'document', true],
    ['video.mp4', 'video', false],
    ['video.3gp', 'video', false],
    ['video.mov', 'document', true],
    ['video.webm', 'document', true],
  ] as const)('deduz pela extensão de %s', (name, kind, convertedToDocument) => {
    expect(classifyAttachment(arquivo(name, ''), 'auto', padrao)).toMatchObject({ kind, convertedToDocument });
  });

  it.each(['LEIAME', 'dados.xyz', 'arquivo.'])('trata %s como documento sem aviso', (name) => {
    expect(classifyAttachment(arquivo(name, ''), 'auto', padrao)).toMatchObject({
      kind: 'document',
      purpose: 'document',
      convertedToDocument: false,
    });
  });
});

describe('tamanho do lote', () => {
  it('aceita até o máximo de arquivos por lote', () => {
    expect(validateBatch(1, padrao)).toEqual({ ok: true });
    expect(validateBatch(30, padrao)).toEqual({ ok: true });
  });

  it('recusa acima do máximo informando o limite', () => {
    expect(validateBatch(31, padrao)).toEqual({ ok: false, reason: 'too_many', max: 30 });
  });
});

describe('rótulo de tamanho nas mensagens de limite', () => {
  it.each([
    [180_000_000, '180 MB'],
    [16_000_000, '16 MB'],
    [1_500_000_000, '1,5 GB'],
    [900_000, '900 KB'],
    [1_200_000, '1,2 MB'],
    [500, '500 B'],
    [999_999, '1 MB'],
  ])('%i bytes vira "%s"', (bytes, label) => {
    expect(formatBytesLabel(bytes)).toBe(label);
  });
});
