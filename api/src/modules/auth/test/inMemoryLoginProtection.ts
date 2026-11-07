import type {
  FailureQuery,
  ILoginCodeRepository,
  ILoginEventRepository,
  LoginCodeRecord,
  LoginEventInput,
} from '../domain/contracts/ILoginProtectionRepository';

/** Fakes em memória dos repositórios da proteção do login (só para testes). */
export const loginStore = {
  events: [] as (LoginEventInput & { id: string; createdAt: Date })[],
  codes: [] as LoginCodeRecord[],
  clock: () => Date.now(),
  reset() {
    this.events = [];
    this.codes = [];
    this.clock = () => Date.now();
  },
};

let seq = 0;
const isFailure = (type: string, q?: FailureQuery) => type === 'LOGIN_FAILED' || (!!q?.includePending && type === 'LOGIN_ATTEMPT');

export class InMemoryLoginEventRepository implements ILoginEventRepository {
  async record(input: LoginEventInput): Promise<string> {
    const id = `e${++seq}`;
    const keepUser = input.type === 'LOGIN_OK' || input.type === 'LOGIN_CODE_VERIFIED';
    loginStore.events.push({ ...input, id, userId: keepUser ? input.userId : null, createdAt: new Date(loginStore.clock()) });
    return id;
  }
  async markAttemptFailed(id: string): Promise<void> {
    const e = loginStore.events.find((x) => x.id === id && x.type === 'LOGIN_ATTEMPT');
    if (e) e.type = 'LOGIN_FAILED';
  }
  async discardAttempt(id: string): Promise<void> {
    loginStore.events = loginStore.events.filter((x) => !(x.id === id && x.type === 'LOGIN_ATTEMPT'));
  }
  async emailFailuresSince(email: string, since: Date, afterReset: boolean, q?: FailureQuery): Promise<Date[]> {
    let from = since.getTime() - 1;
    if (afterReset) {
      const resets = loginStore.events.filter((e) => e.email === email && (e.type === 'LOGIN_OK' || e.type === 'LOGIN_CODE_VERIFIED') && e.createdAt >= since);
      if (resets.length) from = Math.max(...resets.map((e) => e.createdAt.getTime()));
    }
    return loginStore.events
      .filter((e) => e.email === email && isFailure(e.type, q) && e.id !== q?.excludeId && e.createdAt.getTime() > from)
      .map((e) => e.createdAt);
  }
  async ipFailuresSince(ip: string, since: Date, q?: FailureQuery): Promise<Date[]> {
    return loginStore.events.filter((e) => e.ip === ip && isFailure(e.type, q) && e.id !== q?.excludeId && e.createdAt >= since).map((e) => e.createdAt);
  }
  async prune(): Promise<void> {}
}

const locks = new Map<string, Promise<unknown>>();

export class InMemoryLoginCodeRepository implements ILoginCodeRepository {
  async withUserLock<T>(userId: string, fn: (repo: ILoginCodeRepository) => Promise<T>): Promise<T> {
    const prev = locks.get(userId) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(() => fn(this));
    locks.set(userId, run.catch(() => undefined));
    return run;
  }
  async createPending(input: { userId: string; codeHash: string; expiresAt: Date }): Promise<LoginCodeRecord> {
    const rec: LoginCodeRecord = { id: `c${++seq}`, ...input, attempts: 0, sentAt: null, consumedAt: null, invalidatedAt: null, createdAt: new Date(loginStore.clock()) };
    loginStore.codes.push(rec);
    return rec;
  }
  async markSent(id: string, userId: string, sentAt: Date): Promise<void> {
    for (const c of loginStore.codes) {
      if (c.userId === userId && c.id !== id && c.sentAt && c.sentAt <= sentAt && !c.consumedAt && !c.invalidatedAt) c.invalidatedAt = sentAt;
    }
    const own = loginStore.codes.find((c) => c.id === id);
    if (own) own.sentAt = sentAt;
  }
  async deletePending(id: string): Promise<void> {
    loginStore.codes = loginStore.codes.filter((c) => !(c.id === id && !c.sentAt));
  }
  async createdSince(userId: string, since: Date): Promise<Date[]> {
    return loginStore.codes.filter((c) => c.userId === userId && c.createdAt >= since).map((c) => c.createdAt);
  }
  async exhaustedSince(userId: string, since: Date, max: number): Promise<Date[]> {
    return loginStore.codes.filter((c) => c.userId === userId && c.createdAt >= since && c.attempts >= max).map((c) => c.createdAt);
  }
  async findLatestOpen(userId: string): Promise<LoginCodeRecord | null> {
    const open = loginStore.codes.filter((c) => c.userId === userId && c.sentAt && !c.consumedAt && !c.invalidatedAt);
    return open.sort((a, b) => b.sentAt!.getTime() - a.sentAt!.getTime())[0] ?? null;
  }
  async registerAttempt(id: string, max: number): Promise<number | null> {
    const c = loginStore.codes.find((x) => x.id === id);
    if (!c || c.attempts >= max || c.consumedAt || c.invalidatedAt) return null;
    return ++c.attempts;
  }
  async consume(id: string, at: Date): Promise<boolean> {
    const c = loginStore.codes.find((x) => x.id === id);
    if (!c || c.consumedAt || c.invalidatedAt) return false;
    c.consumedAt = at;
    return true;
  }
}
