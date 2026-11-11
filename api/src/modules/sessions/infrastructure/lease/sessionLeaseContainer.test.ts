import { describe, it, expect, vi } from 'vitest';

vi.mock('../repositories/PrismaSessionLeaseRepository', () => ({
  PrismaSessionLeaseRepository: class {
    tryAcquire = vi.fn(async () => true);
    renew = vi.fn();
    release = vi.fn();
    releaseAllOwned = vi.fn();
    findLiveOwner = vi.fn();
  },
}));
vi.mock('../repositories/PrismaSessionRepository', () => ({
  PrismaSessionRepository: class {
    markDisconnectedIfNoLiveLease = vi.fn();
  },
}));
vi.mock('../../../../shared/config/workerIdentity', () => ({ currentWorkerId: () => 'worker-test' }));
const adoptionCfg = vi.hoisted(() => ({ enabled: false, shard: null as string | null }));
vi.mock('../../../../shared/config/workerAdoption', () => ({
  workerAdoptionConfig: () => adoptionCfg,
  workerScalingEnvDefaults: () => ({ maxSessionsPerWorker: 1, maxPendingLoginsPerWorker: 50 }),
}));
vi.mock('../../../../shared/database/prisma.client', () => ({ prisma: {} }));
/** Linha salva em `platform_settings` (`get` do repositório); `Error` = banco fora. */
const stored = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../repositories/PrismaWorkerScalingSettingsRepository', () => ({
  PrismaWorkerScalingSettingsRepository: class {
    get = vi.fn(async () => {
      if (stored.value instanceof Error) throw stored.value;
      return stored.value ? { value: stored.value, updatedAt: new Date(0), updatedById: null } : null;
    });
  },
}));

import { buildSessionLeaseContainer, sessionLeaseContainer } from './sessionLeaseContainer';
import type { ISessionLeaseRepository } from '../../domain/contracts/ISessionLeaseRepository';
import type { ISessionSocketControl } from '../../../messaging/domain/contracts/ISessionSocketControl';

/** Controle de socket falso: `auth` padrão = todas as locais autenticadas; credencial salva padrão = sim. */
function ctl(
  local: () => string[],
  over: Partial<ISessionSocketControl> & { auth?: () => string[]; creds?: boolean } = {},
): ISessionSocketControl {
  const { auth, creds = true, ...rest } = over;
  return {
    abortSession: vi.fn(), suspendSession: vi.fn(), resumeSession: vi.fn(), forgetSuspension: vi.fn(), adoptSession: vi.fn(),
    closeAllSockets: vi.fn(),
    listLocalSessionIds: local,
    listAuthenticatedSessionIds: auth ?? local,
    hasStoredCredentials: vi.fn(async () => creds),
    ...rest,
  };
}

function fakeRepo(): ISessionLeaseRepository {
  return {
    tryAcquire: vi.fn().mockResolvedValue(true),
    renew: vi.fn().mockResolvedValue([]),
    release: vi.fn().mockResolvedValue(undefined),
    releaseAllOwned: vi.fn().mockResolvedValue(0),
    findLiveOwner: vi.fn().mockResolvedValue(null),
  } as unknown as ISessionLeaseRepository;
}

describe('sessionLeaseContainer', () => {
  it('devolve as mesmas instâncias em chamadas repetidas', () => {
    const a = sessionLeaseContainer();
    const b = sessionLeaseContainer();
    expect(b).toBe(a);
    expect(b.acquire).toBe(a.acquire);
    expect(b.release).toBe(a.release);
    expect(b.keeper).toBe(a.keeper);
    expect(b.ledger).toBe(a.ledger);
    expect(a.workerId).toBe('worker-test');
  });

  it('gate, renovação e release compartilham o mesmo razão', async () => {
    const repo = fakeRepo();
    const c = buildSessionLeaseContainer(repo, 'w1');
    expect(await c.acquire.acquire('s1')).toBe(true);
    expect(repo.tryAcquire).toHaveBeenCalledWith('s1', 'w1', expect.any(Number));
    expect(c.ledger.ids()).toEqual(['s1']);
    await c.release.execute('s1');
    expect(repo.release).toHaveBeenCalledWith('s1', 'w1');
    expect(c.ledger.ids()).toEqual([]);
  });

  it('gate das engines: acquire e release usam o mesmo razão', async () => {
    const repo = fakeRepo();
    const c = buildSessionLeaseContainer(repo, 'w1');
    expect(await c.gate.acquire('s1')).toBe(true);
    expect(c.ledger.ids()).toEqual(['s1']);
    await c.gate.release!('s1');
    expect(repo.release).toHaveBeenCalledWith('s1', 'w1');
    expect(c.ledger.ids()).toEqual([]);
  });

  it('renovação sem socket ligado não faz nada; ligado, usa o controle de socket', async () => {
    const repo = fakeRepo();
    const c = buildSessionLeaseContainer(repo, 'w1');
    await c.acquire.acquire('s1');
    await c.renew.execute();
    expect(repo.renew).not.toHaveBeenCalled();
    expect(c.ledger.ids()).toEqual([]); // sem socket local: sai do razão

    await c.acquire.acquire('s1');
    const abortSession = vi.fn().mockResolvedValue(undefined);
    c.bindSocketControl(ctl(() => ['s1'], { abortSession }));
    await c.renew.execute(); // renew devolve [] = lease perdido → derruba
    expect(repo.renew).toHaveBeenCalledWith(['s1'], 'w1', expect.any(Number));
    expect(abortSession).toHaveBeenCalledWith('s1', undefined);
  });

  it('gate expõe acquire tipado: erro de banco = error, outro dono = held (com e sem teto)', async () => {
    for (const capacity of [undefined, () => ({ maxSessions: 5, maxPendingLogins: 5 })]) {
      const repo = fakeRepo();
      const c = buildSessionLeaseContainer(repo, 'w1', capacity);
      vi.mocked(repo.tryAcquire).mockRejectedValueOnce(new Error('db')).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      expect(await c.gate.acquireResult!('s1')).toBe('error');
      expect(await c.gate.acquireResult!('s1')).toBe('held');
      expect(await c.gate.acquireResult!('s1')).toBe('acquired');
    }
  });

  it('com teto cheio: acquire tipado de sessão nova = held', async () => {
    const c = buildSessionLeaseContainer(fakeRepo(), 'w1', () => ({ maxSessions: 1, maxPendingLogins: 5 }));
    c.bindSocketControl(ctl(() => ['a']));
    expect(await c.gate.acquireResult!('nova')).toBe('held');
  });

  it('flag off: gate é o de antes, sem teto (nega nada com sockets cheios)', async () => {
    const repo = fakeRepo();
    const c = buildSessionLeaseContainer(repo, 'w1');
    c.bindSocketControl(ctl(() => ['a', 'b', 'c']));
    expect(c.gate.constructor).toBe(Object);
    expect(await c.gate.acquire('s1')).toBe(true);
    expect(repo.tryAcquire).toHaveBeenCalledTimes(1);
  });

  it('com teto: cheio nega sessão nova, aceita a local; release segue o base', async () => {
    const repo = fakeRepo();
    const c = buildSessionLeaseContainer(repo, 'w1', () => ({ maxSessions: 2, maxPendingLogins: 5 }));
    let local = ['a'];
    c.bindSocketControl(ctl(() => local));
    expect(c.listLocal()).toEqual(['a']);
    expect(await c.gate.acquire('s1')).toBe(true);
    local = ['a', 's1'];
    expect(await c.gate.acquire('s2')).toBe(false);
    expect(await c.gate.acquire('a')).toBe(true);
    expect(repo.tryAcquire).toHaveBeenCalledTimes(2);
    await c.gate.release!('s1');
    expect(repo.release).toHaveBeenCalledWith('s1', 'w1');
  });

  it('T24: QR sem leitura não ocupa vaga; occupancy separa sessões e logins pendentes', async () => {
    const c = buildSessionLeaseContainer(fakeRepo(), 'w1', () => ({ maxSessions: 1, maxPendingLogins: 2 }));
    let local = ['a'];
    let auth = ['a'];
    let creds = false;
    c.bindSocketControl(ctl(() => local, { auth: () => auth, hasStoredCredentials: async () => creds }));
    expect(c.occupancy()).toEqual({ sessions: 1, pendingLogins: 0 });
    expect(await c.gate.acquire('qr')).toBe(true);
    local = ['a', 'qr'];
    expect(c.occupancy()).toEqual({ sessions: 1, pendingLogins: 1 });
    creds = true;
    expect(await c.gate.acquire('reaberta')).toBe(false);
    auth = ['a', 'qr'];
    expect(c.occupancy()).toEqual({ sessions: 2, pendingLogins: 0 });
  });

  it('sem teto: occupancy = sockets locais e nenhum login pendente', () => {
    const c = buildSessionLeaseContainer(fakeRepo(), 'w1');
    c.bindSocketControl(ctl(() => ['a', 'b'], { auth: () => [] }));
    expect(c.occupancy()).toEqual({ sessions: 2, pendingLogins: 0 });
  });

  it('singleton lê a flag: ligada monta o gate com o teto da env', async () => {
    vi.resetModules();
    adoptionCfg.enabled = true;
    try {
      const mod = await import('./sessionLeaseContainer');
      const c = mod.sessionLeaseContainer();
      c.bindSocketControl(ctl(() => ['x']));
      expect(await c.gate.acquire('nova')).toBe(false);
    } finally {
      adoptionCfg.enabled = false;
    }
  });

  it('flag ligada: o gate lê o teto do provider a cada acquire (WSCALE-04)', async () => {
    vi.resetModules();
    adoptionCfg.enabled = true;
    try {
      const mod = await import('./sessionLeaseContainer');
      const c = mod.sessionLeaseContainer();
      c.bindSocketControl(ctl(() => ['x']));
      expect(await c.gate.acquire('nova')).toBe(false);
      stored.value = { maxSessionsPerWorker: 2 };
      await mod.workerScalingSettingsProvider().refresh();
      expect(await c.gate.acquire('nova')).toBe(true);
    } finally {
      adoptionCfg.enabled = false;
      stored.value = null;
    }
  });

  it('flag desligada: gate sem teto mesmo com teto salvo; o provider existe para as rotas', async () => {
    vi.resetModules();
    stored.value = { maxSessionsPerWorker: 1 };
    try {
      const mod = await import('./sessionLeaseContainer');
      const c = mod.sessionLeaseContainer();
      await mod.workerScalingSettingsProvider().refresh();
      c.bindSocketControl(ctl(() => ['a', 'b', 'c']));
      expect(c.gate.constructor).toBe(Object);
      expect(await c.gate.acquire('nova')).toBe(true);
      expect(c.occupancy()).toEqual({ sessions: 3, pendingLogins: 0 });
      expect(mod.workerScalingSettingsProvider()).toBe(mod.workerScalingSettingsProvider());
      expect(mod.workerScalingSettingsProvider().current().value.maxSessionsPerWorker).toBe(1);
    } finally {
      stored.value = null;
    }
  });

  it('boot com falha de leitura: provider fica com o teto da env', async () => {
    vi.resetModules();
    stored.value = new Error('db down');
    try {
      const mod = await import('./sessionLeaseContainer');
      const provider = mod.workerScalingSettingsProvider();
      await provider.refresh();
      expect(provider.current().value).toMatchObject({ maxSessionsPerWorker: 1, maxPendingLoginsPerWorker: 50 });
      expect(provider.current().origin.maxSessionsPerWorker).toBe('default');
    } finally {
      stored.value = null;
    }
  });
});
