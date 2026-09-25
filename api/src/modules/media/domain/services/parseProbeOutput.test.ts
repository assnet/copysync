import { describe, it, expect } from 'vitest';
import { InvalidProbeOutputError, parseProbeOutput } from './parseProbeOutput';

/** Stream de vídeo como o ffprobe devolve com o `-show_entries` do processador. */
function video(extra: Record<string, unknown> = {}) {
  return { codec_name: 'h264', codec_type: 'video', width: 320, height: 240, pix_fmt: 'yuv420p', tags: {}, ...extra };
}
const audio = { codec_name: 'aac', codec_type: 'audio', tags: {} };

function saida(streams: unknown[], duration: unknown = '2.600000'): string {
  return JSON.stringify({ programs: [], stream_groups: [], streams, format: { duration } });
}

describe('parseProbeOutput', () => {
  it('lê vídeo com áudio (saída real do ffprobe 8.1)', () => {
    const real = `{
    "programs": [

    ],
    "stream_groups": [

    ],
    "streams": [
        {
            "codec_name": "h264",
            "codec_type": "video",
            "width": 320,
            "height": 240,
            "pix_fmt": "yuv420p",
            "tags": {

            },
            "side_data_list": [
                {
                    "rotation": 90
                }
            ]
        },
        {
            "codec_name": "aac",
            "codec_type": "audio",
            "tags": {

            }
        }
    ],
    "format": {
        "duration": "2.600000"
    }
}`;
    expect(parseProbeOutput(real)).toEqual({
      durationSeconds: 3,
      width: 240,
      height: 320,
      videoCodec: 'h264',
      pixelFormat: 'yuv420p',
      audioCodec: 'aac',
      hasAudio: true,
    });
  });

  it('lê áudio sem vídeo com dimensões e codecs de vídeo nulos', () => {
    const probe = parseProbeOutput(saida([{ codec_name: 'opus', codec_type: 'audio', tags: {} }], '1.406500'));
    expect(probe).toEqual({
      durationSeconds: 1,
      width: null,
      height: null,
      videoCodec: null,
      pixelFormat: null,
      audioCodec: 'opus',
      hasAudio: true,
    });
  });

  it('marca vídeo mudo sem áudio', () => {
    const probe = parseProbeOutput(saida([video()]));
    expect(probe.hasAudio).toBe(false);
    expect(probe.audioCodec).toBeNull();
    expect(probe.videoCodec).toBe('h264');
  });

  it('arredonda a duração', () => {
    expect(parseProbeOutput(saida([audio], '0.4')).durationSeconds).toBe(0);
    expect(parseProbeOutput(saida([audio], '12.5')).durationSeconds).toBe(13);
    expect(parseProbeOutput(saida([audio], 7.49)).durationSeconds).toBe(7);
  });

  it('deixa a duração nula quando ausente ou N/A', () => {
    expect(parseProbeOutput(saida([audio], 'N/A')).durationSeconds).toBeNull();
    expect(parseProbeOutput(JSON.stringify({ streams: [audio] })).durationSeconds).toBeNull();
  });

  it.each([90, -90, 270, -270, '90', '-90', '270'])('troca largura e altura com rotação %s no side data', (rotation) => {
    const probe = parseProbeOutput(saida([video({ side_data_list: [{ rotation }] })]));
    expect([probe.width, probe.height]).toEqual([240, 320]);
  });

  it.each(['90', '270', 90])('troca largura e altura com a tag rotate %s', (rotate) => {
    const probe = parseProbeOutput(saida([video({ tags: { rotate } })]));
    expect([probe.width, probe.height]).toEqual([240, 320]);
  });

  it.each([0, 180, -180, '0', '180'])('mantém as dimensões com rotação %s', (rotation) => {
    const probe = parseProbeOutput(saida([video({ side_data_list: [{ rotation }], tags: { rotate: rotation } })]));
    expect([probe.width, probe.height]).toEqual([320, 240]);
  });

  it('usa a primeira stream de vídeo e a primeira de áudio', () => {
    const probe = parseProbeOutput(
      saida([
        audio,
        video(),
        { codec_name: 'mp3', codec_type: 'audio' },
        video({ codec_name: 'hevc', width: 1920, height: 1080, pix_fmt: 'yuv420p10le' }),
      ]),
    );
    expect(probe).toMatchObject({ videoCodec: 'h264', width: 320, height: 240, pixelFormat: 'yuv420p', audioCodec: 'aac' });
  });

  it('ignora a capa embutida do áudio (stream mjpeg com attached_pic)', () => {
    const capa = video({ codec_name: 'mjpeg', width: 600, height: 600, pix_fmt: 'yuvj420p', disposition: { attached_pic: 1 } });
    const probe = parseProbeOutput(saida([{ codec_name: 'mp3', codec_type: 'audio', disposition: { attached_pic: 0 } }, capa]));
    expect(probe).toEqual({
      durationSeconds: 3,
      width: null,
      height: null,
      videoCodec: null,
      pixelFormat: null,
      audioCodec: 'mp3',
      hasAudio: true,
    });
  });

  it('usa o vídeo real quando a capa embutida vem antes dele', () => {
    const capa = video({ codec_name: 'png', width: 600, height: 600, disposition: { attached_pic: 1 } });
    const probe = parseProbeOutput(saida([capa, video({ disposition: { attached_pic: 0 } }), audio]));
    expect(probe).toMatchObject({ videoCodec: 'h264', width: 320, height: 240, pixelFormat: 'yuv420p' });
  });

  it('ignora streams que não são de áudio nem de vídeo', () => {
    const probe = parseProbeOutput(saida([{ codec_name: 'mov_text', codec_type: 'subtitle' }]));
    expect(probe).toMatchObject({ videoCodec: null, audioCodec: null, hasAudio: false });
  });

  it('deixa nulos os campos que o ffprobe não trouxe', () => {
    const probe = parseProbeOutput(saida([{ codec_type: 'video' }, { codec_type: 'audio' }]));
    expect(probe).toMatchObject({ width: null, height: null, videoCodec: null, pixelFormat: null, audioCodec: null });
    expect(probe.hasAudio).toBe(true);
  });

  it('aceita saída sem streams', () => {
    expect(parseProbeOutput('{}')).toEqual({
      durationSeconds: null,
      width: null,
      height: null,
      videoCodec: null,
      pixelFormat: null,
      audioCodec: null,
      hasAudio: false,
    });
  });

  it.each(['', 'não é json', '{"streams": [', 'null', '[]', '42'])('lança erro de domínio para saída inválida %j', (json) => {
    expect(() => parseProbeOutput(json)).toThrow(InvalidProbeOutputError);
  });

  it('o erro carrega código estável e não depende de HTTP', () => {
    try {
      parseProbeOutput('lixo');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidProbeOutputError);
      expect(err).toBeInstanceOf(Error);
      expect((err as InvalidProbeOutputError).code).toBe('INVALID_PROBE_OUTPUT');
      expect(err).not.toHaveProperty('statusCode');
    }
  });
});
