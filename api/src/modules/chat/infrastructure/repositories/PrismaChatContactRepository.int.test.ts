import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaChatContactRepository } from './PrismaChatContactRepository';

/** Coluna `lid` (MQ-19) contra Postgres local: migration, unique tenant+telefone, `findByLid`. */
const repo = new PrismaChatContactRepository(prisma);
let tenantId = '';
let otherTenantId = '';

const cleanup = () => prisma.chatContact.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });

beforeAll(async () => {
  const stamp = Date.now();
  tenantId = (await prisma.tenant.create({ data: { name: 'int', slug: `int-lid-${stamp}` } })).id;
  otherTenantId = (await prisma.tenant.create({ data: { name: 'int2', slug: `int-lid2-${stamp}` } })).id;
});
beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await prisma.$disconnect();
});

describe('PrismaChatContactRepository — lid', () => {
  it('migration: coluna nula e índice (tenantId, lid)', async () => {
    const cols = await prisma.$queryRaw<Array<{ is_nullable: string }>>`
      SELECT is_nullable FROM information_schema.columns WHERE table_name = 'chat_contacts' AND column_name = 'lid'`;
    expect(cols).toEqual([{ is_nullable: 'YES' }]);
    const idx = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'chat_contacts' AND indexname = 'chat_contacts_tenantId_lid_idx'`;
    expect(idx).toHaveLength(1);
  });

  it('findOrCreate grava lid ao criar; findByLid acha; outro tenant não', async () => {
    await repo.findOrCreate({ tenantId, phone: '5511', name: 'Ana', lid: '777' });
    expect((await repo.findByLid(tenantId, '777'))?.phone).toBe('5511');
    expect(await repo.findByLid(otherTenantId, '777')).toBeNull();
    expect(await repo.findByLid(tenantId, '000')).toBeNull();
  });

  it('findOrCreate sem lid não apaga o existente; com lid novo grava no contato antigo', async () => {
    await repo.findOrCreate({ tenantId, phone: '5511', name: 'Ana' });
    expect((await repo.findByPhone('5511', tenantId))?.lid).toBeNull();
    await repo.findOrCreate({ tenantId, phone: '5511', name: 'Ana', lid: '777' });
    await repo.findOrCreate({ tenantId, phone: '5511', name: 'Ana' });
    await repo.findOrCreate({ tenantId, phone: '5511', name: 'Ana', lid: null });
    expect((await repo.findByPhone('5511', tenantId))?.lid).toBe('777');
  });

  it('upsert sem lid preserva; com lid atualiza', async () => {
    await repo.upsert({ tenantId, phone: '5522', name: 'Bia', lid: '888' });
    await repo.upsert({ tenantId, phone: '5522', name: 'Bia 2' });
    const c = await repo.findByPhone('5522', tenantId);
    expect(c).toMatchObject({ name: 'Bia 2', lid: '888' });
  });

  it('unique continua tenant+telefone: mesmo LID em dois telefones é permitido; telefone repetido não', async () => {
    await repo.upsert({ tenantId, phone: '5511', name: 'A', lid: '777' });
    await repo.upsert({ tenantId, phone: '5533', name: 'B', lid: '777' });
    await expect(prisma.chatContact.create({ data: { tenantId, phone: '5511', name: 'dup' } })).rejects.toMatchObject({ code: 'P2002' });
    expect(await prisma.chatContact.count({ where: { tenantId, lid: '777' } })).toBe(2);
  });
});
