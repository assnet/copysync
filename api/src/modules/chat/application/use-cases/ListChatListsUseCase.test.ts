import { describe, it, expect, vi } from 'vitest';
import { ListChatListsUseCase } from './ListChatListsUseCase';
import type { IChatListRepository } from '../../domain/contracts/IChatListRepository';

describe('ListChatListsUseCase', () => {
  it('devolve o catálogo do tenant como o repositório o entrega, com id nulo para nome só em tags', async () => {
    const rows = [
      { id: 'list-1', name: 'Clientes', conversationCount: 0 },
      { id: null, name: 'legado', conversationCount: 4 },
    ];
    const repo = { listWithCounts: vi.fn().mockResolvedValue(rows) } as unknown as IChatListRepository;

    const result = await new ListChatListsUseCase(repo).execute({ tenantId: 'tenant-1' });

    expect(repo.listWithCounts).toHaveBeenCalledWith('tenant-1');
    expect(result).toEqual(rows);
  });
});
