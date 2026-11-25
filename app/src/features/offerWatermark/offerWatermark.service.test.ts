import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/services/apiClient';
import { offerWatermarkService } from './offerWatermark.service';

const mark = { enabled: true, kind: 'IMAGE', text: null, position: 'CENTER', size: 'SMALL', opacity: 50, imageUrl: 'https://x/l.png', canEdit: true, updatedAt: null };
const ok = (data: unknown) => ({ data: { success: true, data } });

afterEach(() => vi.restoreAllMocks());

describe('offerWatermarkService', () => {
  it('rotas e corpos do contrato', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValueOnce(ok({ visible: true })).mockResolvedValueOnce(ok(mark));
    const put = vi.spyOn(apiClient, 'put').mockResolvedValue(ok(mark));
    const del = vi.spyOn(apiClient, 'delete').mockResolvedValue(ok({ ...mark, imageUrl: null }));

    await expect(offerWatermarkService.getAccess()).resolves.toEqual({ visible: true });
    await expect(offerWatermarkService.get()).resolves.toEqual(mark);
    await offerWatermarkService.update({ text: null, opacity: 40 });
    await offerWatermarkService.setImage('u-1');
    await expect(offerWatermarkService.removeImage()).resolves.toMatchObject({ imageUrl: null });

    expect(get.mock.calls.map((c) => c[0])).toEqual(['/offer-watermark/access', '/offer-watermark']);
    expect(put).toHaveBeenNthCalledWith(1, '/offer-watermark', { text: null, opacity: 40 });
    expect(put).toHaveBeenNthCalledWith(2, '/offer-watermark/image', { uploadId: 'u-1' });
    expect(del).toHaveBeenCalledWith('/offer-watermark/image');
  });
});
