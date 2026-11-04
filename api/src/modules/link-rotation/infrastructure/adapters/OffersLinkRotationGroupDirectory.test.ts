import { describe, it, expect, vi } from 'vitest';
import { OffersLinkRotationGroupDirectory } from './OffersLinkRotationGroupDirectory';

const { execute, ensure } = vi.hoisted(() => ({
  execute: vi.fn(),
  ensure: vi.fn(async (_i: unknown) => ({ conversationId: 'conv-1' })),
}));
vi.mock('../../../campaigns/infrastructure/offersContainer', () => ({
  offersContainer: { listSessionGroups: () => ({ execute }), ensureSessionGroup: () => ({ execute: ensure }) },
}));

const item = (groupJid: string, canInvite: boolean) => ({
  groupJid, title: groupJid, avatarUrl: null, conversationId: null,
  canPost: true, postBlockedReason: null, canInvite, inviteBlockedReason: canInvite ? null : 'NOT_ADMIN',
});

describe('OffersLinkRotationGroupDirectory', () => {
  it('devolve todos (sem filtrar) com canInvite/inviteBlockedReason e só os campos do rodízio', async () => {
    execute.mockResolvedValueOnce({ partial: false, groups: [item('A', true), item('B', false)] });
    const out = await new OffersLinkRotationGroupDirectory().listSessionGroups('t', 's');
    expect(out).toEqual({
      partial: false,
      groups: [
        { groupJid: 'A', title: 'A', avatarUrl: null, conversationId: null, canInvite: true, inviteBlockedReason: null },
        { groupJid: 'B', title: 'B', avatarUrl: null, conversationId: null, canInvite: false, inviteBlockedReason: 'NOT_ADMIN' },
      ],
    });
  });

  it('ensure do rodízio não exige postar (purpose monitor)', async () => {
    await new OffersLinkRotationGroupDirectory().ensureConversation('t', 's', 'A');
    expect(ensure).toHaveBeenCalledWith({ tenantId: 't', sessionId: 's', groupJid: 'A', purpose: 'monitor' });
  });
});
