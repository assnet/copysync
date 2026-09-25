import { Prisma, type PrismaClient } from '@prisma/client';
import type { IChatListRepository } from '../../domain/contracts/IChatListRepository';
import type { ChatList, ChatListSummary } from '../../domain/entities/ChatList';
import { PrismaChatListMapper } from '../mappers/PrismaChatListMapper';
import { chatConversationTagsSql } from './chatConversationTagsSql';

type Db = Prisma.TransactionClient | PrismaClient;

export class PrismaChatListRepository implements IChatListRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listWithCounts(tenantId: string): Promise<ChatListSummary[]> {
    // FULL OUTER JOIN: entrada do catálogo sem conversa (cnt 0) e nome só em tags (id null)
    // aparecem os dois. A junção é pelo nome exato — variante de caixa vira item próprio.
    const rows = await this.prisma.$queryRaw<ChatListSummary[]>`
      WITH catalog AS (
        SELECT "id", "name" FROM "chat_lists" WHERE "tenantId" = ${tenantId}
      ),
      tagged AS (
        SELECT t.name, COUNT(*)::int AS cnt
        FROM "chat_conversations" c
        CROSS JOIN LATERAL unnest(c."tags") AS t(name)
        WHERE c."tenantId" = ${tenantId}
        GROUP BY t.name
      )
      SELECT
        c."id" AS "id",
        COALESCE(c."name", t.name) AS "name",
        COALESCE(t.cnt, 0)::int AS "conversationCount"
      FROM catalog c
      FULL OUTER JOIN tagged t ON t.name = c."name"
      ORDER BY lower(COALESCE(c."name", t.name)) ASC, COALESCE(c."name", t.name) ASC
    `;
    return rows.map((r) => ({ id: r.id ?? null, name: r.name, conversationCount: Number(r.conversationCount) }));
  }

  async findById(tenantId: string, id: string): Promise<ChatList | null> {
    const raw = await this.prisma.chatList.findFirst({ where: { id, tenantId } });
    return raw ? PrismaChatListMapper.toDomain(raw) : null;
  }

  async findByName(tenantId: string, name: string): Promise<ChatList | null> {
    const raw = await PrismaChatListRepository.findByNameWith(this.prisma, tenantId, name);
    return raw ? PrismaChatListMapper.toDomain(raw) : null;
  }

  countConversations(tenantId: string, name: string): Promise<number> {
    return this.prisma.chatConversation.count({ where: { tenantId, tags: { has: name } } });
  }

  async create(tenantId: string, name: string): Promise<ChatList> {
    const raw = await this.prisma.chatList.create({ data: { tenantId, name } });
    return PrismaChatListMapper.toDomain(raw);
  }

  async ensure(tenantId: string, name: string): Promise<ChatList> {
    const existing = await this.findByName(tenantId, name);
    if (existing) return existing;
    try {
      return await this.create(tenantId, name);
    } catch (err) {
      // Corrida com outra escrita do mesmo nome: a unique (tenantId, name) segura e a
      // linha vencedora é a resposta.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.findByName(tenantId, name);
        if (winner) return winner;
      }
      throw err;
    }
  }

  rename(tenantId: string, id: string, newName: string): Promise<ChatList> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.chatList.findFirst({ where: { id, tenantId } });
      if (!current) throw new Error(`ChatList not found: ${id}`);
      const raw = await tx.chatList.update({ where: { id: current.id }, data: { name: newName } });
      if (current.name !== newName) {
        await chatConversationTagsSql.replace(tx, tenantId, current.name, newName);
      }
      return PrismaChatListMapper.toDomain(raw);
    });
  }

  renameByName(tenantId: string, oldName: string, newName: string): Promise<ChatList> {
    return this.prisma.$transaction(async (tx) => {
      // Se o nome antigo já tem entrada (painel desatualizado), renomeia-a; senão nasce
      // uma com o nome novo — é o que promove dado antigo, só em tags, ao catálogo.
      const current = await PrismaChatListRepository.findByNameWith(tx, tenantId, oldName);
      const raw = current
        ? await tx.chatList.update({ where: { id: current.id }, data: { name: newName } })
        : await tx.chatList.create({ data: { tenantId, name: newName } });
      if (oldName !== newName) {
        await chatConversationTagsSql.replace(tx, tenantId, oldName, newName);
      }
      return PrismaChatListMapper.toDomain(raw);
    });
  }

  delete(tenantId: string, id: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.chatList.findFirst({ where: { id, tenantId } });
      if (!current) return;
      await tx.chatList.delete({ where: { id: current.id } });
      await chatConversationTagsSql.remove(tx, tenantId, current.name);
    });
  }

  deleteByName(tenantId: string, name: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      await tx.chatList.deleteMany({ where: { tenantId, name: { equals: name, mode: 'insensitive' } } });
      await chatConversationTagsSql.remove(tx, tenantId, name);
    });
  }

  private static findByNameWith(db: Db, tenantId: string, name: string) {
    return db.chatList.findFirst({ where: { tenantId, name: { equals: name, mode: 'insensitive' } } });
  }
}
