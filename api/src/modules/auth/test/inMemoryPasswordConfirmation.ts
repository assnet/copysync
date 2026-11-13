// Fake em memória das tentativas de confirmação de senha — só para testes.
import type {
  IPasswordConfirmationRepository,
  ReservePasswordConfirmationInput,
} from '../domain/contracts/IPasswordConfirmationRepository';

export interface PasswordConfirmationRow extends ReservePasswordConfirmationInput {
  id: string;
  success: boolean;
}

export class InMemoryPasswordConfirmationRepository implements IPasswordConfirmationRepository {
  rows: PasswordConfirmationRow[] = [];
  private seq = 0;
  private chain: Promise<unknown> = Promise.resolve();

  /** Serializa como a trava do banco: um `fn` por vez. */
  withUserLock<T>(_userId: string, fn: (repo: IPasswordConfirmationRepository) => Promise<T>): Promise<T> {
    const run = this.chain.then(() => fn(this));
    this.chain = run.catch(() => undefined);
    return run;
  }

  async failuresSince(userId: string, since: Date) {
    return this.rows.filter((r) => r.userId === userId && !r.success && r.createdAt >= since).map((r) => r.createdAt);
  }

  async reserve(input: ReservePasswordConfirmationInput) {
    const id = `pc-${++this.seq}`;
    this.rows.push({ ...input, id, success: false });
    return id;
  }

  async markSucceeded(id: string) {
    const row = this.rows.find((r) => r.id === id);
    if (row) row.success = true;
  }

  async discard(id: string) { this.rows = this.rows.filter((r) => !(r.id === id && !r.success)); }

  async pruneUser(userId: string, before: Date) {
    this.rows = this.rows.filter((r) => !(r.userId === userId && r.createdAt < before));
  }
}
