import { describe, expect, it, vi } from 'vitest';
import type { IGroupMonitorRepository } from '../../domain/contracts/IGroupMonitorRepository';
import type { ICapturedOfferRepository } from '../../domain/contracts/ICapturedOfferRepository';
import { RegisterCapturedMessageUseCase } from './RegisterCapturedMessageUseCase';

const group = {
  id: 'g1', tenantId: 't1', configId: 'c1', keywords: [],
  windowStartMinute: 0, windowEndMinute: 1440, weekdaysMask: 127, captureOutsideWindow: false,
};
const message = {
  tenantId: 't1', sessionId: 's1', isGroup: true, fromMe: false, groupJid: 'j@g.us',
  externalMessageId: 'm1', body: 'oferta https://loja.exemplo/p/1',
};

function build(products?: { has: () => Promise<boolean> }) {
  const createPending = vi.fn(async () => true);
  const useCase = new RegisterCapturedMessageUseCase({
    monitors: { findActiveMonitoredGroup: async () => group } as unknown as IGroupMonitorRepository,
    captured: { createPending } as unknown as ICapturedOfferRepository,
    entitlements: { getBoolean: async () => null },
    ...(products && { products }),
  });
  return { useCase, createPending };
}

describe('RegisterCapturedMessageUseCase: acesso por produto', () => {
  it('sem leitor (ou Afiliados ativo) captura como hoje', async () => {
    expect(await build().useCase.execute(message)).toBe('captured');
    expect(await build({ has: async () => true }).useCase.execute(message)).toBe('captured');
  });

  it('Afiliados inativo: ignorada, sem gravar captura', async () => {
    const { useCase, createPending } = build({ has: async () => false });
    expect(await useCase.execute(message)).toBe('ignored');
    expect(createPending).not.toHaveBeenCalled();
  });
});
