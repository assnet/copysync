import { describe, it, expect, vi } from 'vitest';
import { buildBaileysAuthState } from './BaileysAuthStatePersistence';
import type {
  ISessionAuthStateRepository,
  SessionAuthKeyBatch,
  SessionAuthStateRecord,
  SessionAuthStateUpsertData,
} from '../../../../sessions/domain/contracts/ISessionAuthStateRepository';

const SESSION = 'sess-1';
const TENANT = 'tenant-1';

/** Repositório em memória: uma linha por chave + blob legado opcional. */
class InMemoryAuthRepo implements ISessionAuthStateRepository {
  keys = new Map<string, unknown>();
  legacy: SessionAuthStateRecord | null = null;
  batches: SessionAuthKeyBatch[] = [];
  failNext = 0;

  async findBySessionId(_sessionId: string) { return this.legacy; }
  async upsert(data: SessionAuthStateUpsertData) {
    this.legacy = { sessionId: data.sessionId, tenantId: data.tenantId, provider: data.provider, statePayload: data.statePayload, version: 0 };
  }
  async findAllKeys(_sessionId: string) { return Object.fromEntries(this.keys); }
  async writeKeys(batch: SessionAuthKeyBatch) {
    if (this.failNext > 0) { this.failNext--; throw new Error('db down'); }
    this.batches.push(structuredClone(batch));
    for (const [k, v] of Object.entries(batch.upserts)) this.keys.set(k, v);
    for (const k of batch.deletes) this.keys.delete(k);
  }
  async clearCredentials(_sessionId: string) { this.keys.clear(); }
  async deleteBySessionId(_sessionId: string) { this.keys.clear(); this.legacy = null; }
}

// Debounce longo: nada grava sozinho; os testes sincronizam pelo forceFlush
const fast = { flushDebounceMs: 60_000, maxRetries: 2, retryDelayMs: 0 };
const tick = () => new Promise((r) => setTimeout(r, 5));
const kp1 = (n: number) => ({ public: Buffer.from([n]), private: Buffer.from([n + 1]) });

async function build(repo: InMemoryAuthRepo) {
  return buildBaileysAuthState(SESSION, TENANT, repo, fast);
}

describe('buildBaileysAuthState — por chave', () => {
  it('sessão nova: credenciais iniciais; saveCreds grava só __creds__', async () => {
    const repo = new InMemoryAuthRepo();
    const h = await build(repo);
    expect(h.state.creds.registrationId).toBeTypeOf('number');
    await h.saveCreds();
    await h.forceFlush();
    expect(repo.batches).toHaveLength(1);
    expect(Object.keys(repo.batches[0]!.upserts)).toEqual(['__creds__']);
    expect(repo.batches[0]!.deletes).toEqual([]);
    expect(repo.batches[0]!).toMatchObject({ sessionId: SESSION, tenantId: TENANT, provider: 'baileys' });
  });

  it('keys.set grava só as chaves alteradas; valor igual não suja; null apaga', async () => {
    const repo = new InMemoryAuthRepo();
    const h = await build(repo);
    const kp = { public: Buffer.from([1, 2]), private: Buffer.from([3, 4]) };
    await h.state.keys.set({ 'pre-key': { '1': kp, '2': kp } });
    await h.forceFlush();
    expect(Object.keys(repo.batches[0]!.upserts).sort()).toEqual(['pre-key__1', 'pre-key__2']);

    // mesmo valor de novo: nada vai ao banco
    await h.state.keys.set({ 'pre-key': { '1': kp } });
    await h.forceFlush();
    expect(repo.batches).toHaveLength(1);

    // apaga a 2 e muda a 1: um lote com um upsert e um delete
    await h.state.keys.set({ 'pre-key': { '1': { ...kp, private: Buffer.from([9]) }, '2': null } });
    await h.forceFlush();
    expect(repo.batches).toHaveLength(2);
    expect(Object.keys(repo.batches[1]!.upserts)).toEqual(['pre-key__1']);
    expect(repo.batches[1]!.deletes).toEqual(['pre-key__2']);
    expect(repo.keys.has('pre-key__2')).toBe(false);
  });

  it('Buffer faz a volta inteira (BufferJSON) e o get lê da memória sem consultar o banco', async () => {
    const repo = new InMemoryAuthRepo();
    const h = await build(repo);
    const kp = { public: Buffer.from([1, 2, 3]), private: Buffer.from([4, 5, 6]) };
    await h.state.keys.set({ 'pre-key': { '7': kp } });
    const spy = vi.spyOn(repo, 'findAllKeys');
    const got = await h.state.keys.get('pre-key', ['7', 'nope']);
    expect(Buffer.from(got['7']!.public).equals(kp.public)).toBe(true);
    expect(got['nope']).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it('carrega da tabela por chave numa nova instância (reboot)', async () => {
    const repo = new InMemoryAuthRepo();
    const a = await build(repo);
    await a.state.keys.set({ session: { 'jid-1': Buffer.from([7]) } });
    await a.saveCreds();
    await a.forceFlush();

    const b = await build(repo);
    expect(b.state.creds.registrationId).toBe(a.state.creds.registrationId);
    const got = await b.state.keys.get('session', ['jid-1']);
    expect(Buffer.from(got['jid-1'] as Uint8Array).equals(Buffer.from([7]))).toBe(true);
  });

  it('migra o blob legado na primeira carga, sem zerar o blob', async () => {
    const repo = new InMemoryAuthRepo();
    repo.legacy = {
      sessionId: SESSION, tenantId: TENANT, provider: 'baileys', version: 3,
      statePayload: {
        __creds__: { registrationId: 4242, noiseKey: { public: { type: 'Buffer', data: 'AQI=' }, private: { type: 'Buffer', data: 'AwQ=' } } },
        'pre-key__1': { public: { type: 'Buffer', data: 'AQ==' }, private: { type: 'Buffer', data: 'Ag==' } },
      },
    };
    const h = await build(repo);
    expect(h.state.creds.registrationId).toBe(4242);
    expect(repo.batches).toHaveLength(1);
    expect(Object.keys(repo.batches[0]!.upserts).sort()).toEqual(['__creds__', 'pre-key__1']);
    expect(repo.keys.size).toBe(2);
    expect(repo.legacy.statePayload).not.toEqual({});
    // segunda carga: já tem chaves, não migra de novo
    await build(repo);
    expect(repo.batches).toHaveLength(1);
  });

  it('blob legado vazio ({}) não migra nada e começa do zero', async () => {
    const repo = new InMemoryAuthRepo();
    repo.legacy = { sessionId: SESSION, tenantId: TENANT, provider: 'baileys', version: 1, statePayload: {} };
    const h = await build(repo);
    expect(repo.batches).toHaveLength(0);
    expect(h.state.creds.registrationId).toBeTypeOf('number');
  });

  it('chave que suja durante a gravação sai na volta seguinte do mesmo flush', async () => {
    const repo = new InMemoryAuthRepo();
    const h = await build(repo);
    let release!: () => void;
    const original = repo.writeKeys.bind(repo);
    let first = true;
    vi.spyOn(repo, 'writeKeys').mockImplementation(async (b) => {
      if (first) { first = false; await new Promise<void>((r) => { release = r; }); }
      return original(b);
    });
    await h.state.keys.set({ 'pre-key': { '1': kp1(1) } });
    const flushing = h.forceFlush();
    await tick();
    // set não espera a gravação (o Baileys chama isto ao descriptografar mensagens)
    const setDone = Promise.resolve(h.state.keys.set({ 'pre-key': { '2': kp1(2) } }));
    await expect(Promise.race([setDone.then(() => 'set'), tick().then(() => 'tick')])).resolves.toBe('set');
    release();
    await flushing;
    expect(repo.batches.map((b) => Object.keys(b.upserts))).toEqual([['pre-key__1'], ['pre-key__2']]);
    h.dispose();
  });

  it('falha de banda esgotando as tentativas: chaves voltam a sujas e saem no próximo flush', async () => {
    const repo = new InMemoryAuthRepo();
    const h = await build(repo);
    await h.state.keys.set({ 'pre-key': { '1': kp1(1) } });
    repo.failNext = 2; // maxRetries = 2
    await expect(h.forceFlush()).rejects.toThrow('db down');
    expect(repo.keys.size).toBe(0);
    await h.forceFlush();
    expect(repo.keys.has('pre-key__1')).toBe(true);
    h.dispose();
  });

  it('retry: a primeira falha é tolerada', async () => {
    const repo = new InMemoryAuthRepo();
    const h = await build(repo);
    await h.saveCreds();
    repo.failNext = 1;
    await h.forceFlush();
    expect(repo.keys.has('__creds__')).toBe(true);
    h.dispose();
  });

  it('debounce agrupa várias alterações numa gravação', async () => {
    const repo = new InMemoryAuthRepo();
    const h = await buildBaileysAuthState(SESSION, TENANT, repo, { ...fast, flushDebounceMs: 20 });
    void h.state.keys.set({ 'pre-key': { '1': kp1(1) } });
    void h.state.keys.set({ 'pre-key': { '2': kp1(2) } });
    void h.saveCreds();
    await new Promise((r) => setTimeout(r, 60));
    expect(repo.batches).toHaveLength(1);
    expect(Object.keys(repo.batches[0]!.upserts).sort()).toEqual(['__creds__', 'pre-key__1', 'pre-key__2']);
    h.dispose();
  });
});

describe('buildBaileysAuthState — ciclo de vida do handle', () => {
  it('reconexão: o handle novo grava o pendente do antigo antes de ler, e o antigo não escreve mais', async () => {
    const repo = new InMemoryAuthRepo();
    const a = await build(repo);
    await a.state.keys.set({ session: { 'jid-1': Buffer.from([1]) } }); // pendente (debounce longo)
    const b = await build(repo);
    expect(repo.keys.has('session__jid-1')).toBe(true); // gravado na troca
    const got = await b.state.keys.get('session', ['jid-1']);
    expect(Buffer.from(got['jid-1'] as Uint8Array).equals(Buffer.from([1]))).toBe(true);
    // o antigo foi descartado: set nele não vai ao banco
    await a.state.keys.set({ session: { 'jid-1': Buffer.from([9]) } });
    await a.forceFlush();
    expect(Buffer.from((await b.state.keys.get('session', ['jid-1']))['jid-1'] as Uint8Array).equals(Buffer.from([1]))).toBe(true);
    expect(JSON.stringify(repo.keys.get('session__jid-1'))).toContain('"AQ=="');
    b.dispose();
  });

  it('discardAuthState: pendente vira lixo (logout/revogação); clear não é desfeito por flush atrasado', async () => {
    const { discardAuthState } = await import('./BaileysAuthStatePersistence');
    const repo = new InMemoryAuthRepo();
    const h = await build(repo);
    await h.saveCreds();
    await discardAuthState(SESSION);
    await repo.clearCredentials(SESSION);
    await h.forceFlush();
    expect(repo.keys.size).toBe(0);
    expect(repo.batches).toHaveLength(0);
  });

  it('releaseAuthState: grava o pendente e solta o handle (desconexão)', async () => {
    const { releaseAuthState } = await import('./BaileysAuthStatePersistence');
    const repo = new InMemoryAuthRepo();
    const h = await build(repo);
    await h.saveCreds();
    await releaseAuthState(SESSION);
    expect(repo.keys.has('__creds__')).toBe(true);
    await h.saveCreds();
    await h.forceFlush();
    expect(repo.batches).toHaveLength(1);
  });

  it('após reboot, set com valor idêntico não grava, mesmo com o jsonb reordenando as chaves', async () => {
    const repo = new InMemoryAuthRepo();
    const a = await build(repo);
    const kp = { public: Buffer.from([1, 2]), private: Buffer.from([3]) };
    await a.state.keys.set({ 'pre-key': { '1': kp } });
    await a.forceFlush();
    // simula a ordem do jsonb (chaves menores primeiro): private antes de public
    const stored = repo.keys.get('pre-key__1') as Record<string, unknown>;
    repo.keys.set('pre-key__1', { private: stored['private'], public: stored['public'] });
    const b = await build(repo);
    await b.state.keys.set({ 'pre-key': { '1': kp } });
    await b.forceFlush();
    expect(repo.batches).toHaveLength(1);
    b.dispose();
  });

  it('falha esgotando retries pelo timer: rearma sozinho e grava quando o banco volta', async () => {
    const repo = new InMemoryAuthRepo();
    const h = await buildBaileysAuthState(SESSION, TENANT, repo, { flushDebounceMs: 5, maxRetries: 1, retryDelayMs: 1 });
    repo.failNext = 1;
    await h.saveCreds();
    await new Promise((r) => setTimeout(r, 30));
    expect(repo.keys.has('__creds__')).toBe(false);
    await new Promise((r) => setTimeout(r, 1_100)); // backoff mínimo de 1 s
    expect(repo.keys.has('__creds__')).toBe(true);
    h.dispose();
  });
});

describe('buildBaileysAuthState — concorrência (revisão)', () => {
  it('forceFlush concorrente durante escrita em voo não trava: os dois terminam e o pendente sai', async () => {
    const repo = new InMemoryAuthRepo();
    const h = await build(repo);
    let release!: () => void;
    const original = repo.writeKeys.bind(repo);
    let first = true;
    vi.spyOn(repo, 'writeKeys').mockImplementation(async (b) => {
      if (first) { first = false; await new Promise<void>((r) => { release = r; }); }
      return original(b);
    });
    await h.state.keys.set({ 'pre-key': { '1': kp1(1) } });
    const a = h.forceFlush();
    await tick();
    await h.state.keys.set({ 'pre-key': { '2': kp1(2) } }); // agenda timer durante a escrita
    const b = h.forceFlush(); // cancela o timer e espera a escrita em voo
    release();
    await Promise.race([Promise.all([a, b]), new Promise((_, rej) => setTimeout(() => rej(new Error('pendurou')), 2000))]);
    expect(repo.keys.has('pre-key__1') && repo.keys.has('pre-key__2')).toBe(true);
    h.dispose();
  });

  it('releaseAuthState com banco fora: o pendente passa para o handle novo e sai depois', async () => {
    const repo = new InMemoryAuthRepo();
    const a = await build(repo);
    await a.saveCreds();
    repo.failNext = 2;
    const b = await build(repo); // release falha, mas o pendente vem junto
    expect(repo.keys.has('__creds__')).toBe(false);
    await b.forceFlush();
    expect(repo.keys.has('__creds__')).toBe(true);
    expect(b.state.creds.registrationId).toBe(a.state.creds.registrationId);
    b.dispose();
  });

  it('discardAuthState espera a escrita em voo: clear depois dela não é desfeito', async () => {
    const { discardAuthState } = await import('./BaileysAuthStatePersistence');
    const repo = new InMemoryAuthRepo();
    const h = await build(repo);
    let release!: () => void;
    const original = repo.writeKeys.bind(repo);
    vi.spyOn(repo, 'writeKeys').mockImplementationOnce(async (b) => { await new Promise<void>((r) => { release = r; }); return original(b); });
    await h.saveCreds();
    const flushing = h.forceFlush();
    await tick();
    const discarding = discardAuthState(SESSION);
    release();
    await discarding;
    await flushing;
    await repo.clearCredentials(SESSION);
    expect(repo.keys.size).toBe(0);
  });

  it('carga falha depois de soltar o handle antigo: o pendente vira órfão e o próximo build o herda', async () => {
    const repo = new InMemoryAuthRepo();
    const a = await build(repo);
    await a.saveCreds();
    repo.failNext = 2; // release falha
    vi.spyOn(repo, 'findAllKeys').mockRejectedValueOnce(new Error('db down'));
    await expect(build(repo)).rejects.toThrow('db down');
    const c = await build(repo);
    await c.forceFlush();
    expect(repo.keys.has('__creds__')).toBe(true);
    c.dispose();
  });

  it('discardAuthState durante um build em curso espera o build e descarta o handle novo', async () => {
    const { discardAuthState } = await import('./BaileysAuthStatePersistence');
    const repo = new InMemoryAuthRepo();
    let release!: () => void;
    vi.spyOn(repo, 'findAllKeys').mockImplementationOnce(async () => { await new Promise<void>((r) => { release = r; }); return {}; });
    const building = build(repo);
    await tick();
    const discarding = discardAuthState(SESSION);
    release();
    const h = await building;
    await discarding;
    await h.saveCreds();
    await h.forceFlush();
    expect(repo.batches).toHaveLength(0); // handle já nasceu descartado
  });

  it('forceFlush com escrita em voo que falha tenta de novo em vez de propagar', async () => {
    const repo = new InMemoryAuthRepo();
    const h = await buildBaileysAuthState(SESSION, TENANT, repo, { flushDebounceMs: 5, maxRetries: 1, retryDelayMs: 0 });
    repo.failNext = 1;
    await h.saveCreds(); // timer de 5 ms dispara a escrita que falha
    await tick();
    await h.forceFlush();
    expect(repo.keys.has('__creds__')).toBe(true);
    h.dispose();
  });

  it('builds concorrentes da mesma sessão são serializados: fica um handle só, sem zumbi', async () => {
    const repo = new InMemoryAuthRepo();
    const [a, b] = await Promise.all([build(repo), build(repo)]);
    await a.saveCreds();
    await a.forceFlush();
    expect(repo.batches).toHaveLength(0); // `a` já foi descartado por `b`
    await b.saveCreds();
    await b.forceFlush();
    expect(repo.batches).toHaveLength(1);
    b.dispose();
  });
});
