import { describe, expect, it, vi } from 'vitest';
import { CapacityLimitedLeaseGate, LOGIN_RESTART_GRACE_MS, type SessionCapacitySource } from './CapacityLimitedLeaseGate';

/** Fonte em que toda sessão local está autenticada e toda sessão nova tem credencial (comportamento pré-T24). */
const source = (local: string[], over: Partial<SessionCapacitySource> = {}): SessionCapacitySource => ({
  listLocal: () => local,
  listAuthenticated: () => local,
  hasStoredCredentials: async () => true,
  ...over,
});

const setup = (local: string[], max: number, acquire = vi.fn(async () => true)) => {
  const log = { warn: vi.fn() };
  const gate = new CapacityLimitedLeaseGate({ acquire }, source(local), { maxSessions: max, maxPendingLogins: 50 }, log as never);
  return { gate, acquire, log };
};

describe('CapacityLimitedLeaseGate', () => {
  it('cheio nega sessão nova sem chamar o acquire e loga', async () => {
    const { gate, acquire, log } = setup(['a', 'b'], 2);
    expect(await gate.acquire('c')).toBe(false);
    expect(acquire).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith({ sessionId: 'c', active: 2, max: 2 }, expect.any(String));
  });

  it('cheio aceita a sessão já local (repassa)', async () => {
    const { gate, acquire } = setup(['a', 'b'], 2);
    expect(await gate.acquire('a')).toBe(true);
    expect(acquire).toHaveBeenCalledWith('a');
  });

  it('acima do teto também nega sessão nova', async () => {
    const { gate } = setup(['a', 'b', 'c'], 2);
    expect(await gate.acquire('d')).toBe(false);
  });

  it('abaixo do teto chama o acquire e devolve o resultado', async () => {
    const acquire = vi.fn(async () => false);
    const { gate } = setup(['a'], 2, acquire);
    expect(await gate.acquire('b')).toBe(false);
    expect(acquire).toHaveBeenCalledWith('b');
  });

  it('erro do acquire vira false', async () => {
    const acquire = vi.fn(async () => {
      throw new Error('db');
    });
    const { gate, log } = setup([], 2, acquire);
    expect(await gate.acquire('a')).toBe(false);
    expect(log.warn).toHaveBeenCalled();
  });
});

describe('CapacityLimitedLeaseGate — reserva síncrona (T22)', () => {
  const deferred = () => {
    let resolve!: (v: boolean) => void;
    const promise = new Promise<boolean>((r) => (resolve = r));
    return { promise, resolve };
  };

  it('5 acquires simultâneos com max=3 e local=2 → só 1 passa', async () => {
    const d = deferred();
    const acquire = vi.fn(() => d.promise);
    const { gate } = setup(['a', 'b'], 3, acquire);
    const all = ['c', 'd', 'e', 'f', 'g'].map((id) => gate.acquire(id));
    d.resolve(true);
    expect(await Promise.all(all)).toEqual([true, false, false, false, false]);
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it('acquireResult simultâneo também reserva: excedentes viram held', async () => {
    const d = deferred();
    const { gate } = setup(['a', 'b'], 3, vi.fn(() => d.promise));
    const all = [gate.acquireResult('c'), gate.acquireResult('d')];
    d.resolve(true);
    expect(await Promise.all(all)).toEqual(['acquired', 'held']);
  });

  it('sessão já local passa sem reservar (não consome vaga)', async () => {
    const local = ['a', 'b'];
    const { gate } = setup(local, 3);
    expect(await gate.acquire('a')).toBe(true);
    expect(await gate.acquire('c')).toBe(true);
  });

  it('negação ou erro do inner libera a vaga na hora', async () => {
    const acquire = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('db'))
      .mockResolvedValueOnce(true);
    const { gate } = setup(['a', 'b'], 3, acquire);
    expect(await gate.acquire('c')).toBe(false);
    expect(await gate.acquire('d')).toBe(false);
    expect(await gate.acquire('e')).toBe(true);
  });

  it('sucesso segura a vaga até a sessão aparecer em listLocal, sem contar duas vezes', async () => {
    const local = ['a'];
    const { gate } = setup(local, 3);
    expect(await gate.acquire('b')).toBe(true);
    expect(await gate.acquire('c')).toBe(true);
    expect(await gate.acquire('d')).toBe(false);
    local.push('b', 'c');
    expect(await gate.acquire('d')).toBe(false);
    local.splice(local.indexOf('b'), 1);
    expect(await gate.acquire('d')).toBe(true);
  });

  it('sucesso sem aparecer em listLocal libera após o TTL', async () => {
    vi.useFakeTimers();
    try {
      const log = { warn: vi.fn() };
      const gate = new CapacityLimitedLeaseGate(
        { acquire: async () => true }, source([]), { maxSessions: 1, maxPendingLogins: 50 }, log as never, 1_000,
      );
      expect(await gate.acquire('a')).toBe(true);
      expect(await gate.acquire('b')).toBe(false);
      vi.advanceTimersByTime(1_000);
      expect(await gate.acquire('b')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('mesma sessão em voo duas vezes não reserva duas vagas', async () => {
    const d = deferred();
    const { gate } = setup([], 2, vi.fn(() => d.promise));
    const all = [gate.acquire('a'), gate.acquire('a'), gate.acquire('b')];
    d.resolve(true);
    expect(await Promise.all(all)).toEqual([true, true, true]);
  });
});

describe('CapacityLimitedLeaseGate — só login concluído ocupa vaga (T24)', () => {
  const build = (opts: { local: string[]; auth: string[]; creds?: Set<string>; max?: number; maxPending?: number; now?: () => number }) => {
    const log = { warn: vi.fn() };
    const acquire = vi.fn(async () => true);
    const gate = new CapacityLimitedLeaseGate(
      { acquire },
      source(opts.local, {
        listAuthenticated: () => opts.auth,
        hasStoredCredentials: async (id) => opts.creds?.has(id) ?? false,
      }),
      { maxSessions: opts.max ?? 1, maxPendingLogins: opts.maxPending ?? 50 },
      log as never,
      15_000,
      opts.now,
    );
    return { gate, acquire, log };
  };

  it('teto 1 com 1 autenticada: sessão nova em QR abre e não muda a contagem de sessões', async () => {
    const local = ['a'];
    const { gate, acquire } = build({ local, auth: ['a'] });
    expect(await gate.acquire('qr')).toBe(true);
    expect(acquire).toHaveBeenCalledWith('qr');
    local.push('qr');
    expect(gate.occupancy()).toEqual({ sessions: 1, pendingLogins: 1 });
  });

  it('QR lido → passa a contar como sessão (teto pode ser excedido)', async () => {
    const local = ['a', 'qr'];
    const auth = ['a'];
    const { gate } = build({ local, auth });
    expect(gate.occupancy()).toEqual({ sessions: 1, pendingLogins: 1 });
    auth.push('qr');
    expect(gate.occupancy()).toEqual({ sessions: 2, pendingLogins: 0 });
  });

  it('reabertura de sessão com credencial reserva vaga; cheio nega', async () => {
    const local: string[] = [];
    const { gate, log } = build({ local, auth: [], creds: new Set(['r1', 'r2']) });
    expect(await gate.acquire('r1')).toBe(true);
    expect(gate.occupancy()).toEqual({ sessions: 1, pendingLogins: 0 });
    expect(await gate.acquire('r2')).toBe(false);
    expect(log.warn).toHaveBeenCalledWith({ sessionId: 'r2', active: 1, max: 1 }, expect.any(String));
  });

  it('reabertura com credencial abrindo (local, ainda sem login) não conta como login pendente', async () => {
    const local: string[] = [];
    const { gate } = build({ local, auth: [], creds: new Set(['r1']) });
    expect(await gate.acquire('r1')).toBe(true);
    local.push('r1');
    expect(gate.occupancy()).toEqual({ sessions: 1, pendingLogins: 0 });
  });

  it('sessão nova sem credencial não reserva vaga de sessão', async () => {
    const { gate } = build({ local: [], auth: [], creds: new Set(['r1']) });
    expect(await gate.acquire('qr')).toBe(true);
    expect(gate.occupancy()).toEqual({ sessions: 0, pendingLogins: 1 });
    expect(await gate.acquire('r1')).toBe(true);
  });

  it('teto de logins pendentes respeitado (reservas e locais sem login)', async () => {
    const local = ['p1'];
    const { gate, log } = build({ local, auth: [], maxPending: 2 });
    expect(await gate.acquire('p2')).toBe(true);
    expect(await gate.acquire('p3')).toBe(false);
    expect(log.warn).toHaveBeenCalledWith({ sessionId: 'p3', pendingLogins: 2, max: 2 }, expect.any(String));
    local.splice(0, 1);
    expect(await gate.acquire('p3')).toBe(true);
  });

  it('login visto em andamento que reabre com credencial (reinício pós-QR) passa com o teto cheio', async () => {
    let now = 0;
    const local = ['a', 'qr'];
    const creds = new Set<string>();
    const { gate } = build({ local, auth: ['a'], creds, now: () => now });
    expect(gate.occupancy().pendingLogins).toBe(1); // vê o login em andamento
    local.splice(local.indexOf('qr'), 1); // socket fecha para reiniciar
    creds.add('qr');
    now += 3_000;
    expect(await gate.acquire('qr')).toBe(true);
  });

  it('janela do reinício vence: credencial salva volta a passar pelo teto', async () => {
    let now = 0;
    const local = ['a', 'qr'];
    const { gate } = build({ local, auth: ['a'], creds: new Set(['qr']), now: () => now });
    gate.occupancy();
    local.splice(local.indexOf('qr'), 1);
    now += LOGIN_RESTART_GRACE_MS + 1;
    expect(await gate.acquire('qr')).toBe(false);
  });

  it('erro ao checar credencial conta como sessão (lado seguro)', async () => {
    const log = { warn: vi.fn() };
    const gate = new CapacityLimitedLeaseGate(
      { acquire: async () => true },
      source(['a'], { hasStoredCredentials: async () => { throw new Error('db'); } }),
      { maxSessions: 1, maxPendingLogins: 50 },
      log as never,
    );
    expect(await gate.acquire('x')).toBe(false);
  });

  it('sessão já local não consulta credencial', async () => {
    const hasStoredCredentials = vi.fn(async () => true);
    const gate = new CapacityLimitedLeaseGate(
      { acquire: async () => true }, source(['a'], { hasStoredCredentials }), { maxSessions: 1, maxPendingLogins: 1 },
    );
    expect(await gate.acquire('a')).toBe(true);
    expect(hasStoredCredentials).not.toHaveBeenCalled();
  });
});
