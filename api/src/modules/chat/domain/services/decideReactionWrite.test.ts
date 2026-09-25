import { describe, it, expect } from 'vitest';
import { decideReactionWrite, type CurrentReaction } from './decideReactionWrite';

const T0 = new Date('2026-09-24T10:00:00.000Z');
const T1 = new Date('2026-09-24T10:00:05.000Z');

function gravado(emoji: string | null, reactedAt: Date = T0): CurrentReaction {
  return { emoji, reactedAt };
}

describe('decideReactionWrite', () => {
  it('grava e publica a primeira reação do autor', () => {
    expect(decideReactionWrite(null, { emoji: '👍', reactedAt: T0 })).toEqual({
      applied: true,
      changed: true,
    });
  });

  it('grava tombstone sem publicar quando a remoção chega antes de qualquer reação', () => {
    // A linha guarda o carimbo da remoção: um set atrasado com carimbo menor perde para ela.
    expect(decideReactionWrite(null, { emoji: null, reactedAt: T0 })).toEqual({
      applied: true,
      changed: false,
    });
  });

  it('ignora evento mais antigo que o estado gravado', () => {
    // Eco do 👍 (T0) processado depois do ❤️ (T1) não pode sobrescrever o gesto novo.
    expect(decideReactionWrite(gravado('❤️', T1), { emoji: '👍', reactedAt: T0 })).toEqual({
      applied: false,
      changed: false,
    });
  });

  it('ignora remoção mais antiga que o estado gravado', () => {
    expect(decideReactionWrite(gravado('❤️', T1), { emoji: null, reactedAt: T0 })).toEqual({
      applied: false,
      changed: false,
    });
  });

  it('ignora set mais antigo que um tombstone', () => {
    expect(decideReactionWrite(gravado(null, T1), { emoji: '👍', reactedAt: T0 })).toEqual({
      applied: false,
      changed: false,
    });
  });

  it('reaplica o mesmo emoji sem publicar', () => {
    // Eco do nosso envio: mesmo carimbo, mesmo emoji — atualiza a linha, nada visível muda.
    expect(decideReactionWrite(gravado('👍', T0), { emoji: '👍', reactedAt: T0 })).toEqual({
      applied: true,
      changed: false,
    });
  });

  it('atualiza o carimbo do mesmo emoji com evento mais novo sem publicar', () => {
    expect(decideReactionWrite(gravado('👍', T0), { emoji: '👍', reactedAt: T1 })).toEqual({
      applied: true,
      changed: false,
    });
  });

  it('troca o emoji com evento mais novo e publica', () => {
    expect(decideReactionWrite(gravado('👍', T0), { emoji: '❤️', reactedAt: T1 })).toEqual({
      applied: true,
      changed: true,
    });
  });

  it('troca o emoji com carimbo igual e publica', () => {
    // Carimbo igual conta como ≥: não há como ordenar, vence quem chegou por último.
    expect(decideReactionWrite(gravado('👍', T0), { emoji: '❤️', reactedAt: T0 })).toEqual({
      applied: true,
      changed: true,
    });
  });

  it('remove a reação ativa e publica', () => {
    expect(decideReactionWrite(gravado('👍', T0), { emoji: null, reactedAt: T1 })).toEqual({
      applied: true,
      changed: true,
    });
  });

  it('reage de novo sobre um tombstone e publica', () => {
    expect(decideReactionWrite(gravado(null, T0), { emoji: '👍', reactedAt: T1 })).toEqual({
      applied: true,
      changed: true,
    });
  });

  it('reaplica remoção sobre tombstone sem publicar', () => {
    expect(decideReactionWrite(gravado(null, T0), { emoji: null, reactedAt: T0 })).toEqual({
      applied: true,
      changed: false,
    });
  });
});
