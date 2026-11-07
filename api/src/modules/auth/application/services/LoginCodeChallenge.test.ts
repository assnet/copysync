import { beforeEach, describe, expect, it } from 'vitest';
import { LOGIN_GUARD_LIMITS as L } from '../../domain/services/loginGuardRules';
import { HmacLoginCodeHasher, HmacLoginTicketSigner } from '../../infrastructure/security/HmacLoginSecurity';
import { InMemoryLoginCodeRepository, loginStore } from '../../test/inMemoryLoginProtection';
import { LoginCodeChallenge } from './LoginCodeChallenge';

const user = { id: 'u1', email: 'ana@x.com', name: 'Ana' };
let now = Date.UTC(2026, 10, 7, 12);
let sends = 0;
const make = (delayMs = 0) => new LoginCodeChallenge(new InMemoryLoginCodeRepository(), new HmacLoginCodeHasher('k'.repeat(40)), new HmacLoginTicketSigner('k'.repeat(40)),
  { send: async () => { sends++; if (delayMs) await new Promise((r) => setTimeout(r, delayMs)); return { sent: true }; } });

beforeEach(() => { loginStore.reset(); now = Date.UTC(2026, 10, 7, 12); loginStore.clock = () => now; sends = 0; });

describe('LoginCodeChallenge', () => {
  it('envios paralelos: a trava por usuário deixa só 1 passar (intervalo de 60 s)', async () => {
    const c = make(5);
    const r = await Promise.allSettled(Array.from({ length: 5 }, () => c.start(user, now, { allowReuse: false })));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(sends).toBe(1);
  });

  it('teto diário: 2 códigos esgotados em 24 h travam novos envios até a janela vencer', async () => {
    const c = make();
    const exhaust = async () => {
      const { ticket } = await c.start(user, now, { allowReuse: false });
      for (let i = 0; i < L.maxCodeAttempts; i++) await c.verify(ticket, '999999', now).catch(() => {});
    };
    loginStore.codes = [];
    await exhaust();
    const first = now;
    now += 2 * L.windowMs;
    await exhaust();
    now += 2 * L.windowMs;
    await expect(c.start(user, now, { allowReuse: false })).rejects.toMatchObject({
      code: 'LOGIN_CODE_SEND_LIMIT', meta: { retryAt: new Date(first + L.dayMs).toISOString() },
    });
    now = first + L.dayMs + 1;
    await expect(c.start(user, now, { allowReuse: false })).resolves.toMatchObject({ codeSent: true });
  });

  it('markSent invalida só códigos já enviados antes (não o pendente de outro envio)', async () => {
    const repo = new InMemoryLoginCodeRepository();
    const a = await repo.createPending({ userId: 'u1', codeHash: 'a', expiresAt: new Date(now + 1) });
    await repo.markSent(a.id, 'u1', new Date(now));
    const pending = await repo.createPending({ userId: 'u1', codeHash: 'p', expiresAt: new Date(now + 1) });
    const b = await repo.createPending({ userId: 'u1', codeHash: 'b', expiresAt: new Date(now + 1) });
    await repo.markSent(b.id, 'u1', new Date(now + 10));
    expect(loginStore.codes.find((x) => x.id === a.id)?.invalidatedAt).not.toBeNull();
    expect(loginStore.codes.find((x) => x.id === pending.id)?.invalidatedAt).toBeNull();
  });
});
