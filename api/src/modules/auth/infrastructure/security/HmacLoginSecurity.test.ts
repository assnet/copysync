import { describe, expect, it } from 'vitest';
import { HmacLoginCodeHasher, HmacLoginTicketSigner } from './HmacLoginSecurity';

const SECRET = 'x'.repeat(40);

describe('HmacLoginTicketSigner', () => {
  const s = new HmacLoginTicketSigner(SECRET);
  it('emite e valida dentro do prazo; vence depois', () => {
    const t = s.issue('u1', 600_000, 1_000);
    expect(s.verify(t, 2_000)).toBe('u1');
    expect(s.verify(t, 601_000)).toBeNull();
  });
  it('recusa adulterado, outra chave e JWT', () => {
    const t = s.issue('u1', 600_000, 1_000);
    const [v, , sig] = t.split('.');
    const forged = `${v}.${Buffer.from(JSON.stringify({ sub: 'u2', p: 'login-code', exp: 9e15 })).toString('base64url')}.${sig}`;
    expect(s.verify(forged, 2_000)).toBeNull();
    expect(new HmacLoginTicketSigner('y'.repeat(40)).verify(t, 2_000)).toBeNull();
    expect(s.verify('eyJhbGciOiJIUzI1NiJ9.e30.sig', 2_000)).toBeNull();
  });
});

describe('HmacLoginCodeHasher', () => {
  const h = new HmacLoginCodeHasher(SECRET);
  it('gera 6 dígitos e confere só com o mesmo usuário', () => {
    const code = h.generate();
    expect(code).toMatch(/^\d{6}$/);
    const hash = h.hash('u1', code);
    expect(hash).not.toContain(code);
    expect(h.matches('u1', code, hash)).toBe(true);
    expect(h.matches('u2', code, hash)).toBe(false);
  });
});
