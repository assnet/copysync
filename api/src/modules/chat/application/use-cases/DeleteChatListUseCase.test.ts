import { describe, it, expect, vi } from 'vitest';
import { DeleteChatListUseCase } from './DeleteChatListUseCase';
import type { IChatListRepository } from '../../domain/contracts/IChatListRepository';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';

const TENANT = 'tenant-1';

function makeRepo(byId: { id: string; name: string } | null = { id: 'list-1', name: 'Clientes' }) {
  return {
    findById: vi.fn().mockResolvedValue(byId),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteByName: vi.fn().mockResolvedValue(undefined),
  } as unknown as IChatListRepository;
}

describe('DeleteChatListUseCase', () => {
  it('por id: remove do catálogo (a cascata em tags é do repositório)', async () => {
    const repo = makeRepo();
    await new DeleteChatListUseCase(repo).execute({ tenantId: TENANT, target: { id: 'list-1' } });
    expect(repo.delete).toHaveBeenCalledWith(TENANT, 'list-1');
  });

  it('por id inexistente responde não encontrado', async () => {
    const repo = makeRepo(null);
    await expect(new DeleteChatListUseCase(repo).execute({ tenantId: TENANT, target: { id: 'x' } }))
      .rejects.toBeInstanceOf(NotFoundError);
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('por nome (lista só em tags): remove com o nome aparado, sem exigir entrada no catálogo', async () => {
    const repo = makeRepo(null);
    await new DeleteChatListUseCase(repo).execute({ tenantId: TENANT, target: { name: ' antiga ' } });
    expect(repo.deleteByName).toHaveBeenCalledWith(TENANT, 'antiga');
  });
});
