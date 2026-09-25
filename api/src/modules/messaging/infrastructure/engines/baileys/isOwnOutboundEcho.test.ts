import { describe, it, expect, vi } from 'vitest';
import { isOwnOutboundEcho } from './isOwnOutboundEcho';

describe('isOwnOutboundEcho', () => {
  it('pula o eco da mídia enviada pelo painel e retira o id do registro', () => {
    const consume = vi.fn(() => true);

    expect(isOwnOutboundEcho({ fromMe: true, id: 'MSG-1' }, consume)).toBe(true);
    expect(consume).toHaveBeenCalledWith('MSG-1');
  });

  it('segue o fluxo para mídia enviada pelo celular, que não está no registro', () => {
    const consume = vi.fn(() => false);

    expect(isOwnOutboundEcho({ fromMe: true, id: 'MSG-2' }, consume)).toBe(false);
    expect(consume).toHaveBeenCalledWith('MSG-2');
  });

  it('segue o fluxo para mensagem recebida sem consultar o registro', () => {
    // Consumir aqui gastaria à toa um id que pode ser do nosso próprio eco.
    const consume = vi.fn(() => true);

    expect(isOwnOutboundEcho({ fromMe: false, id: 'MSG-3' }, consume)).toBe(false);
    expect(isOwnOutboundEcho({ fromMe: null, id: 'MSG-3' }, consume)).toBe(false);
    expect(isOwnOutboundEcho({ id: 'MSG-3' }, consume)).toBe(false);
    expect(consume).not.toHaveBeenCalled();
  });

  it('segue o fluxo quando a mensagem não traz id', () => {
    const consume = vi.fn(() => true);

    expect(isOwnOutboundEcho({ fromMe: true, id: null }, consume)).toBe(false);
    expect(isOwnOutboundEcho({ fromMe: true, id: '' }, consume)).toBe(false);
    expect(isOwnOutboundEcho({ fromMe: true }, consume)).toBe(false);
    expect(isOwnOutboundEcho(null, consume)).toBe(false);
    expect(isOwnOutboundEcho(undefined, consume)).toBe(false);
    expect(consume).not.toHaveBeenCalled();
  });
});
