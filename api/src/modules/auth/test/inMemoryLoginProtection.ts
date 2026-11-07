import type {
  ILoginCodeRepository,
  ILoginEventRepository,
  LoginCodeRecord,
  LoginEventInput,
} from '../domain/contracts/ILoginProtectionRepository';

/** Fakes em memória dos repositórios da proteção do login (só para testes). */
export const loginStore = {
  events: [] as (LoginEventInput & { createdAt: Date })[],
  codes: [] as LoginCodeRecord[],
  clock: () => Date.now(),
  reset() {
    this.events = [];
    this.codes = [];
    this.clock = () => Date.now();
  },
};

let seq = 0;

export class InMemoryLoginEventRepository implements ILoginEventRepository {
  async record(input: LoginEventInput): Promise<void> {
    loginStore.events.push({ ...input, userId: input.type === 'LOGIN_FAILED' ? null : input.userId, createdAt: new Date(loginStore.clock()) });
  }
  async emailFailuresSince(email: string, since: Date, afterReset: boolean): Promise<Date[]> {
    let from = since.getTime() - 1;
    if (afterReset) {
      const resets = loginStore.events.filter((e) => e.email === email && e.type !== 'LOGIN_FAILED' && e.createdAt >= since);
      if (resets.length) from = Math.max(...resets.map((e) => e.createdAt.getTime()));
    }
    return loginStore.events.filter((e) => e.email === email && e.type === 'LOGIN_FAILED' && e.createdAt.getTime() > from).map((e) => e.createdAt);
  }
  async ipFailuresSince(ip: string, since: Date): Promise<Date[]> {
    return loginStore.events.filter((e) => e.ip === ip && e.type === 'LOGIN_FAILED' && e.createdAt >= since).map((e) => e.createdAt);
  }
  async prune(): Promise<void> {}
}

export class InMemoryLoginCodeRepository implements ILoginCodeRepository {
  async createPending(input: { userId: string; codeHash: string; expiresAt: Date }): Promise<LoginCodeRecord> {
    const rec: LoginCodeRecord = { id: `c${++seq}`, ...input, attempts: 0, sentAt: null, consumedAt: null, invalidatedAt: null, createdAt: new Date(loginStore.clock()) };
    loginStore.codes.push(rec);
    return rec;
  }
  async markSent(id: string, userId: string, sentAt: Date): Promise<void> {
    for (const c of loginStore.codes) {
      if (c.userId === userId && c.id !== id && !c.consumedAt && !c.invalidatedAt) c.invalidatedAt = sentAt;
      if (c.id === id) c.sentAt = sentAt;
    }
  }
  async deletePending(id: string): Promise<void> {
    loginStore.codes = loginStore.codes.filter((c) => !(c.id === id && !c.sentAt));
  }
  async createdSince(userId: string, since: Date): Promise<Date[]> {
    return loginStore.codes.filter((c) => c.userId === userId && c.createdAt >= since).map((c) => c.createdAt);
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
