import type { PrismaClient } from '@prisma/client';
import type {
  ISaverKnownContactReader,
  SaverKnownContact,
  SaverKnownContactKeys,
} from '../../domain/contracts/ISaverKnownContactReader';

const BATCH = 1000;

/**
 * Contatos que o tenant já conhece (`chat_contacts`: agenda e par LID↔telefone visto em conversa 1:1),
 * SÓ leitura e sempre por `tenantId`. Lê a tabela direto, sem importar o módulo de chat.
 */
export class PrismaSaverKnownContactReader implements ISaverKnownContactReader {
  constructor(private readonly prisma: PrismaClient) {}

  async findByKeys(tenantId: string, keys: SaverKnownContactKeys): Promise<SaverKnownContact[]> {
    const out: SaverKnownContact[] = [];
    const select = { phone: true, lid: true, name: true } as const;
    for (const lids of chunks(keys.lids)) {
      out.push(...(await this.prisma.chatContact.findMany({
        where: { tenantId, lid: { in: lids } }, select, orderBy: { updatedAt: 'desc' },
      })));
    }
    for (const phones of chunks(keys.phones)) {
      out.push(...(await this.prisma.chatContact.findMany({
        where: { tenantId, phone: { in: phones } }, select, orderBy: { updatedAt: 'desc' },
      })));
    }
    return out.map((r) => ({ phone: r.phone, lid: r.lid, name: r.name }));
  }
}

function chunks(values: readonly string[]): string[][] {
  const unique = [...new Set(values)];
  const out: string[][] = [];
  for (let i = 0; i < unique.length; i += BATCH) out.push(unique.slice(i, i + BATCH));
  return out;
}
