import { describe, it, expect } from 'vitest';
import { ListOfferDestinationsUseCase } from './ListOfferDestinationsUseCase';
import { ReplaceOfferDestinationsUseCase } from './ReplaceOfferDestinationsUseCase';
import { InMemoryOfferDestinationRepository, TENANT } from './offerTestFakes';

function setup() {
  const repo = new InMemoryOfferDestinationRepository({ [TENANT]: ['c1', 'c2', 'c3'], other: ['x1'] });
  return { repo, replace: new ReplaceOfferDestinationsUseCase(repo), list: new ListOfferDestinationsUseCase(repo) };
}

describe('Offer destinations', () => {
  it('substitui, deduplica e lista', async () => {
    const s = setup();
    const out = await s.replace.execute({ tenantId: TENANT, conversationIds: ['c1', 'c2', 'c1'] });
    expect(out.map((d) => d.conversationId)).toEqual(['c1', 'c2']);
    expect((await s.list.execute(TENANT)).map((d) => d.conversationId)).toEqual(['c1', 'c2']);
  });

  it('lista vazia limpa', async () => {
    const s = setup();
    s.repo.selected = ['c1'];
    expect(await s.replace.execute({ tenantId: TENANT, conversationIds: [] })).toEqual([]);
  });

  it('conversa de outro tenant → NOT_FOUND e nada muda', async () => {
    const s = setup();
    s.repo.selected = ['c3'];
    await expect(s.replace.execute({ tenantId: TENANT, conversationIds: ['c1', 'x1'] })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      statusCode: 404,
    });
    expect(s.repo.selected).toEqual(['c3']);
  });

  it('mais de 200 → 422', async () => {
    const s = setup();
    const ids = Array.from({ length: 201 }, (_, i) => `c${i}`);
    await expect(s.replace.execute({ tenantId: TENANT, conversationIds: ids })).rejects.toMatchObject({ statusCode: 422 });
  });
});
