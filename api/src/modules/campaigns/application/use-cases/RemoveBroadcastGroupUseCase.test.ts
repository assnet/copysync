import { describe, expect, it } from 'vitest';
import { RemoveBroadcastGroupUseCase } from './RemoveBroadcastGroupUseCase';
import type { IBroadcastGroupRemover } from '../../domain/contracts/IBroadcastGroupRemover';

/** Fake: usos por tenant → conversa; remove só do tenant pedido. */
class FakeRemover implements IBroadcastGroupRemover {
  calls: Array<[string, string]> = [];
  constructor(private readonly uses: Record<string, Record<string, number>>) {}
  async removeEverywhere(tenantId: string, conversationId: string) {
    this.calls.push([tenantId, conversationId]);
    const tenant = this.uses[tenantId] ?? {};
    if (!(conversationId in tenant)) return { found: false, removed: 0 };
    const removed = tenant[conversationId] ?? 0;
    tenant[conversationId] = 0;
    return { found: true, removed };
  }
}

describe('RemoveBroadcastGroupUseCase', () => {
  it('remove todos os usos do grupo no tenant', async () => {
    const remover = new FakeRemover({ t1: { c1: 2 } });
    const out = await new RemoveBroadcastGroupUseCase({ groupRemover: remover }).execute({ tenantId: 't1', conversationId: 'c1' });
    expect(out).toEqual({ removed: 2 });
    expect(remover.calls).toEqual([['t1', 'c1']]);
  });

  it('é idempotente: segunda chamada não falha e remove 0', async () => {
    const uc = new RemoveBroadcastGroupUseCase({ groupRemover: new FakeRemover({ t1: { c1: 1 } }) });
    await uc.execute({ tenantId: 't1', conversationId: 'c1' });
    await expect(uc.execute({ tenantId: 't1', conversationId: 'c1' })).resolves.toEqual({ removed: 0 });
  });

  it('conversa de outro tenant → 404 NOT_FOUND', async () => {
    const uc = new RemoveBroadcastGroupUseCase({ groupRemover: new FakeRemover({ t2: { c2: 1 } }) });
    await expect(uc.execute({ tenantId: 't1', conversationId: 'c2' })).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
  });
});
