import { describe, expect, it } from 'vitest';
import { isUnpostable, postBlockedText } from './postBlocked';

describe('postBlocked', () => {
  it('motivo conhecido traz texto curto e longo próprios', () => {
    expect(postBlockedText('ADMINS_ONLY').short).toBe('Só admins podem enviar');
    expect(postBlockedText('CHANNEL_READONLY').long).toMatch(/publicar neste canal/);
  });

  it('sem motivo cai no texto genérico', () => {
    expect(postBlockedText(null).short).toBe('Sem permissão para postar');
  });

  it('só canPost false bloqueia; null e ausente não', () => {
    expect(isUnpostable({ canPost: false })).toBe(true);
    expect(isUnpostable({ canPost: null })).toBe(false);
    expect(isUnpostable({})).toBe(false);
  });
});
