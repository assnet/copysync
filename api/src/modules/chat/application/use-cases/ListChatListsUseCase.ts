import type { IChatListRepository } from '../../domain/contracts/IChatListRepository';
import type { ChatListSummary } from '../../domain/entities/ChatList';

export type ChatListDto = ChatListSummary;

/** Catálogo do tenant unido aos nomes que só existem em `tags` (dado anterior ao catálogo). */
export class ListChatListsUseCase {
  constructor(private readonly listRepo: IChatListRepository) {}

  execute(input: { tenantId: string }): Promise<ChatListDto[]> {
    return this.listRepo.listWithCounts(input.tenantId);
  }
}
