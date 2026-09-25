import { describe, it, expect, vi } from 'vitest';
import { RenameChatListUseCase } from './RenameChatListUseCase';
import type { IChatListRepository } from '../../domain/contracts/IChatListRepository';
import { ConflictError, NotFoundError, ValidationError } from '../../../../shared/errors/internal/ResourceErrors';

const TENANT = 'tenant-1';

function makeRepo(over: {
  byId?: { id: string; name: string } | null;
  byName?: Record<string, { id: string; name: string }>;
} = {}) {
  const byName = over.byName ?? {};
  return {
    findById: vi.fn().mockResolvedValue(over.byId === undefined ? { id: 'list-1', name: 'Clientes' } : over.byId),
    findByName: vi.fn().mockImplementation(async (_t: string, name: string) => byName[name.toLowerCase()] ?? null),
    rename: vi.fn().mockImplementation(async (_t: string, id: string, newName: string) => ({ id, name: newName })),
    renameByName: vi.fn().mockImplementation(async (_t: string, _old: string, newName: string) => ({ id: 'list-new', name: newName })),
    countConversations: vi.fn().mockResolvedValue(2),
  } as unknown as IChatListRepository;
}

describe('RenameChatListUseCase', () => {
  it('por id: renomeia no catálogo (a cascata em tags é do repositório) e devolve a contagem', async () => {
    const repo = makeRepo();
    const result = await new RenameChatListUseCase(repo).execute({ tenantId: TENANT, target: { id: 'list-1' }, newName: ' Leads ' });

    expect(repo.rename).toHaveBeenCalledWith(TENANT, 'list-1', 'Leads');
    expect(result).toEqual({ id: 'list-1', name: 'Leads', conversationCount: 2 });
  });

  it('por id inexistente responde não encontrado', async () => {
    const repo = makeRepo({ byId: null });
    await expect(new RenameChatListUseCase(repo).execute({ tenantId: TENANT, target: { id: 'x' }, newName: 'Leads' }))
      .rejects.toBeInstanceOf(NotFoundError);
    expect(repo.rename).not.toHaveBeenCalled();
  });

  it('novo nome de outra lista é conflito', async () => {
    const repo = makeRepo({ byName: { leads: { id: 'list-2', name: 'Leads' } } });
    await expect(new RenameChatListUseCase(repo).execute({ tenantId: TENANT, target: { id: 'list-1' }, newName: 'leads' }))
      .rejects.toBeInstanceOf(ConflictError);
    expect(repo.rename).not.toHaveBeenCalled();
  });

  it('mudar só a caixa do próprio nome não é conflito', async () => {
    const repo = makeRepo({ byName: { clientes: { id: 'list-1', name: 'Clientes' } } });
    const result = await new RenameChatListUseCase(repo).execute({ tenantId: TENANT, target: { id: 'list-1' }, newName: 'CLIENTES' });
    expect(result.name).toBe('CLIENTES');
  });

  it('por nome (lista só em tags): promove ao catálogo com o nome novo', async () => {
    const repo = makeRepo();
    const result = await new RenameChatListUseCase(repo).execute({ tenantId: TENANT, target: { name: 'antiga' }, newName: 'Nova' });

    expect(repo.renameByName).toHaveBeenCalledWith(TENANT, 'antiga', 'Nova');
    expect(result).toEqual({ id: 'list-new', name: 'Nova', conversationCount: 2 });
  });

  it('nome novo inválido é recusado antes de consultar o catálogo', async () => {
    const repo = makeRepo();
    await expect(new RenameChatListUseCase(repo).execute({ tenantId: TENANT, target: { id: 'list-1' }, newName: ' ' }))
      .rejects.toBeInstanceOf(ValidationError);
    expect(repo.findById).not.toHaveBeenCalled();
  });
});
