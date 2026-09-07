import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';

describe('constantes injetadas no build', () => {
  it('expõe __APP_VERSION__ também sob teste', () => {
    // A config do Vitest vive dentro do vite.config.ts justamente para herdar o `define`.
    // Se alguém separar as duas de novo, esta asserção quebra antes de um componente que
    // exibe a versão quebrar por ReferenceError.
    expect(__APP_VERSION__).toBe(pkg.version);
  });
});
