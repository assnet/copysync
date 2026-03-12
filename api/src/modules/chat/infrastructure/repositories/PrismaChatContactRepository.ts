import type { PrismaClient } from '@prisma/client';
import type {
  ChatContactCreateData,
  IChatContactRepository,
} from '../../domain/contracts/IChatContactRepository';
import type { ChatContact } from '../../domain/entities/ChatContact';
import { PrismaChatContactMapper } from '../mappers/PrismaChatContactMapper';

export class PrismaChatContactRepository implements IChatContactRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string, tenantId: string): Promise<ChatContact | null> {
    const raw = await this.prisma.chatContact.findFirst({
      where: { id, tenantId },
    });
    return raw ? PrismaChatContactMapper.toDomain(raw) : null;
  }

  async findByPhone(phone: string, tenantId: string): Promise<ChatContact | null> {
    const raw = await this.prisma.chatContact.findUnique({
      where: { tenantId_phone: { tenantId, phone } },
    });
    return raw ? PrismaChatContactMapper.toDomain(raw) : null;
  }

  async findOrCreate(data: ChatContactCreateData): Promise<ChatContact> {
    const existing = await this.findByPhone(data.phone, data.tenantId);
    if (existing) {
      // Promove nome: se o nome atual é numérico (LID/phone fallback) e chegou um nome real
      const currentIsNumeric = /^\d+$/.test(existing.name);
      const newIsReal = !!data.name && !/^\d+$/.test(data.name);
      if (currentIsNumeric && newIsReal) {
        const raw = await this.prisma.chatContact.update({
          where: { tenantId_phone: { tenantId: data.tenantId, phone: data.phone } },
          data: { name: data.name },
        });
        return PrismaChatContactMapper.toDomain(raw);
      }
      return existing;
    }

    const raw = await this.prisma.chatContact.create({
      data: {
        tenantId: data.tenantId,
        name: data.name,
        phone: data.phone,
        avatarUrl: data.avatarUrl ?? null,
        notes: data.notes ?? null,
      },
    });
    return PrismaChatContactMapper.toDomain(raw);
  }

  async upsert(data: ChatContactCreateData): Promise<ChatContact> {
    const raw = await this.prisma.chatContact.upsert({
      where: { tenantId_phone: { tenantId: data.tenantId, phone: data.phone } },
      update: { name: data.name, avatarUrl: data.avatarUrl ?? null },
      create: {
        tenantId: data.tenantId,
        name: data.name,
        phone: data.phone,
        avatarUrl: data.avatarUrl ?? null,
        notes: data.notes ?? null,
      },
    });
    return PrismaChatContactMapper.toDomain(raw);
  }
}
