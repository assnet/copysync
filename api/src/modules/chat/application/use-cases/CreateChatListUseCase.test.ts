import { describe, it, expect, vi } from 'vitest';
import { CreateChatListUseCase } from './CreateChatListUseCase';
import type { IChatListRepository } from '../../domain/contracts/IChatListRepository';
import { ValidationError } from '../../../../shared/errors/internal/ResourceErrors';

const TENANT = 'tenant-1';

function makeRepo(existing: { id: string; name: string } | null = null) {
  return {
    findByName: vi.fn().mockResolvedValue(existing),
    ensure: vi.fn().mockImplementation(async (_t: string, name: string) => ({ id: 'list-new', name })),
    countConversations: vi.fn().mockResolvedValue(3),
  } as unknown as IChatListRepository;
}

describe('CreateChatListUseCase', () => {
  it('cria a lista com o nome aparado e devolve a contagem de conversas', async () => {
    const repo = makeRepo();
    const result = await new CreateChatListUseCase(repo).execute({ tenantId: TENANT, name: '  VIP  ' });

    expect(repo.ensure).toHaveBeenCalledWith(TENANT, 'VIP');
    expect(result).toEqual({ created: true, list: { id: 'list-new', name: 'VIP', conversationCount: 3 } });
  });

  it('nome já existente (sem diferenciar maiúsculas) devolve a lista existente sem criar', async () => {
    const repo = makeRepo({ id: 'list-1', name: 'VIP' });
    const result = await new CreateChatListUseCase(repo).execute({ tenantId: TENANT, name: 'vip' });

    expect(repo.ensure).not.toHaveBeenCalled();
    expect(result).toEqual({ created: false, list: { id: 'list-1', name: 'VIP', conversationCount: 3 } });
  });

  it.each([['vazio', '   '], ['longo demais', 'x'.repeat(41)]])('nome %s é recusado antes de tocar o catálogo', async (_c, name) => {
    const repo = makeRepo();
    await expect(new CreateChatListUseCase(repo).execute({ tenantId: TENANT, name })).rejects.toBeInstanceOf(ValidationError);
    expect(repo.findByName).not.toHaveBeenCalled();
  });
});
