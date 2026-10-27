import { describe, expect, it, vi } from 'vitest';
import { EnsureSessionGroupUseCase, ListSessionGroupsUseCase } from './SessionGroupsUseCases';
import { InMemoryOfferGeneratorConfigRepository } from './offerTestFakes';
import { SessionNotConnectedError } from '../../../../shared/errors/internal/SessionErrors';
import type { ISessionGroupDirectory } from '../../domain/contracts/ISessionGroupDirectory';

const T = 'tenant-1';
const S = 'sess-1';

function setup() {
  const configs = new InMemoryOfferGeneratorConfigRepository(
    [{ id: S, tenantId: T, status: 'CONNECTED' }],
    [{ id: 'c1', tenantId: T, sessionId: S, isGroup: true, groupJid: '111', title: 'Antigo' }],
  );
  const directory = {
    listParticipating: vi.fn().mockResolvedValue([{ groupJid: '111', name: 'Antigo' }, { groupJid: '222', name: 'Novo' }]),
    ensureConversation: vi.fn().mockResolvedValue('c-new'),
  } satisfies ISessionGroupDirectory;
  return { configs, directory };
}

describe('ListSessionGroupsUseCase', () => {
  it('lista os grupos do WhatsApp, inclusive os sem conversa', async () => {
    const d = setup();
    const r = await new ListSessionGroupsUseCase(d).execute({ tenantId: T, sessionId: S });
    expect(r.partial).toBe(false);
    expect(r.groups).toEqual([
      { groupJid: '111', title: 'Antigo', avatarUrl: null, conversationId: 'c1' },
      { groupJid: '222', title: 'Novo', avatarUrl: null, conversationId: null },
    ]);
  });

  it('sessão fora do ar: lista parcial com o que o chat conhece', async () => {
    const d = setup();
    d.directory.listParticipating.mockRejectedValueOnce(new SessionNotConnectedError(S));
    const r = await new ListSessionGroupsUseCase(d).execute({ tenantId: T, sessionId: S });
    expect(r).toEqual({ partial: true, groups: [{ groupJid: '111', title: 'Antigo', avatarUrl: null, conversationId: 'c1' }] });
  });

  it('sessão de outro tenant: 404', async () => {
    const d = setup();
    await expect(new ListSessionGroupsUseCase(d).execute({ tenantId: 'outro', sessionId: S })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('EnsureSessionGroupUseCase', () => {
  it('grupo da sessão: cria/acha a conversa', async () => {
    const d = setup();
    const r = await new EnsureSessionGroupUseCase(d).execute({ tenantId: T, sessionId: S, groupJid: '222' });
    expect(r).toEqual({ conversationId: 'c-new', title: 'Novo' });
    expect(d.directory.ensureConversation).toHaveBeenCalledWith(T, S, { groupJid: '222', name: 'Novo' });
  });

  it('grupo de que a sessão não participa: 404 e nada criado', async () => {
    const d = setup();
    await expect(new EnsureSessionGroupUseCase(d).execute({ tenantId: T, sessionId: S, groupJid: '777' })).rejects.toMatchObject({ statusCode: 404 });
    expect(d.directory.ensureConversation).not.toHaveBeenCalled();
  });
});
