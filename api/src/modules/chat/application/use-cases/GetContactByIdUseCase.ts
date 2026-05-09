import type { IChatContactRepository } from '../../domain/contracts/IChatContactRepository';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';

export interface GetContactByIdInput {
  contactId: string;
  tenantId: string;
}

export interface ChatContactDto {
  id: string;
  tenantId: string;
  name: string;
  phone: string;
  avatarUrl: string | null;
  notes: string | null;
  initials: string;
  createdAt: string;
  updatedAt: string;
}

export class GetContactByIdUseCase {
  constructor(private readonly contactRepo: IChatContactRepository) {}

  async execute(input: GetContactByIdInput): Promise<ChatContactDto> {
    const contact = await this.contactRepo.findById(input.contactId, input.tenantId);
    if (!contact) throw new NotFoundError('Contact', input.contactId);

    return {
      id: contact.id,
      tenantId: contact.tenantId,
      name: contact.name,
      phone: contact.phone,
      avatarUrl: contact.avatarUrl,
      notes: contact.notes,
      initials: contact.initials,
      createdAt: contact.createdAt.toISOString(),
      updatedAt: contact.updatedAt.toISOString(),
    };
  }
}
