import { describe, expect, it } from 'vitest';
import { env } from './env';
import { DISPATCH_SEND_TIMEOUT_MS } from '../../modules/campaigns/application/use-cases/ProcessDueOfferDispatchesUseCase';

describe('LINK_PREVIEW_UPLOAD_TIMEOUT_MS', () => {
  it('padrão 15 s, abaixo do timeout do disparo (o envio cai na miniatura pequena antes)', () => {
    expect(env.LINK_PREVIEW_UPLOAD_TIMEOUT_MS).toBe(15_000);
    expect(env.LINK_PREVIEW_UPLOAD_TIMEOUT_MS).toBeLessThan(DISPATCH_SEND_TIMEOUT_MS);
  });
});
