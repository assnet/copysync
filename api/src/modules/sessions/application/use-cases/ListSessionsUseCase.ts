import type { ISessionRepository } from '../../domain/contracts/ISessionRepository';
import type { Session } from '../../domain/entities/Session';

export interface ListSessionsInput {
  tenantId: string;
}

export class ListSessionsUseCase {
  constructor(private readonly sessionRepo: ISessionRepository) {}

  async execute(input: ListSessionsInput): Promise<Session[]> {
    return this.sessionRepo.findAllByTenant(input.tenantId);
  }
}
