import { afterEach, describe, expect, it, vi } from 'vitest';
import { canShareImage, dataUrlToFile, downloadImage, shareImage, storyFileName } from './shareImage';

const DATA_URL = `data:image/jpeg;base64,${btoa('\xff\xd8\xff\xe0abc')}`;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('shareImage', () => {
  it('nome do arquivo com a data local', () => {
    expect(storyFileName(new Date(2026, 9, 5, 23, 59))).toBe('story-oferta-2026-10-05.jpg');
  });

  it('dataUrlToFile monta o JPEG com os bytes e o tipo', async () => {
    const file = dataUrlToFile(DATA_URL, 'a.jpg');
    expect(file.type).toBe('image/jpeg');
    expect(file.name).toBe('a.jpg');
    const bytes = new Uint8Array(await file.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0xff, 0xd8, 0xff, 0xe0]);
    expect(() => dataUrlToFile('nope', 'a.jpg')).toThrow();
  });

  it('canShareImage segue navigator.canShare({ files })', () => {
    const file = dataUrlToFile(DATA_URL, 'a.jpg');
    vi.stubGlobal('navigator', { share: vi.fn(), canShare: vi.fn(() => true) });
    expect(canShareImage(file)).toBe(true);
    expect((navigator.canShare as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual({ files: [file] });
    vi.stubGlobal('navigator', { share: vi.fn(), canShare: () => false });
    expect(canShareImage(file)).toBe(false);
    vi.stubGlobal('navigator', {});
    expect(canShareImage(file)).toBe(false);
  });

  it('shareImage distingue cancelado de falha', async () => {
    const file = dataUrlToFile(DATA_URL, 'a.jpg');
    vi.stubGlobal('navigator', { share: vi.fn().mockResolvedValue(undefined) });
    expect(await shareImage(file)).toBe('shared');
    vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' })) });
    expect(await shareImage(file)).toBe('cancelled');
    vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(new Error('x')) });
    expect(await shareImage(file)).toBe('failed');
  });

  it('downloadImage clica num <a download> e revoga o object URL', () => {
    vi.useFakeTimers();
    const create = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const file = dataUrlToFile(DATA_URL, 'story-oferta-2026-10-29.jpg');
    downloadImage(file);
    expect(create).toHaveBeenCalledWith(file);
    expect(click).toHaveBeenCalledTimes(1);
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('story-oferta-2026-10-29.jpg');
    expect(document.querySelector('a[download]')).toBeNull();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:x');
  });
});
