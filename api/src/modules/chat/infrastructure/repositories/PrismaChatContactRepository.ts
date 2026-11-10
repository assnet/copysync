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

  async findByIds(ids: string[], tenantId: string): Promise<ChatContact[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.chatContact.findMany({
      where: { id: { in: [...new Set(ids)] }, tenantId },
    });
    return rows.map(PrismaChatContactMapper.toDomain);
  }

  async findByPhones(phones: string[], tenantId: string): Promise<ChatContact[]> {
    if (phones.length === 0) return [];
    const rows = await this.prisma.chatContact.findMany({
      where: { phone: { in: [...new Set(phones)] }, tenantId },
    });
    return rows.map(PrismaChatContactMapper.toDomain);
  }

  async findByPhone(phone: string, tenantId: string): Promise<ChatContact | null> {
    const raw = await this.prisma.chatContact.findUnique({
      where: { tenantId_phone: { tenantId, phone } },
    });
    return raw ? PrismaChatContactMapper.toDomain(raw) : null;
  }

  async findByLid(tenantId: string, lid: string): Promise<ChatContact | null> {
    // Sem unique em `lid`: o mais recente vence se dois telefones já carregaram o mesmo LID.
    const raw = await this.prisma.chatContact.findFirst({
      where: { tenantId, lid },
      orderBy: { updatedAt: 'desc' },
    });
    return raw ? PrismaChatContactMapper.toDomain(raw) : null;
  }

  async search(term: string, tenantId: string, limit: number): Promise<ChatContact[]> {
    const digits = term.replace(/\D/g, '');
    const rows = await this.prisma.chatContact.findMany({
      where: {
        tenantId,
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
        ],
      },
      orderBy: { name: 'asc' },
      take: limit,
    });
    return rows.map(PrismaChatContactMapper.toDomain);
  }

  async findOrCreate(data: ChatContactCreateData): Promise<ChatContact> {
    const existing = await this.findByPhone(data.phone, data.tenantId);
    if (existing) {
      // Promove nome: se o nome atual é numérico (LID/phone fallback) e chegou um nome real
      const currentIsNumeric = /^\d+$/.test(existing.name);
      const newIsReal = !!data.name && !/^\d+$/.test(data.name);
      const promoteName = currentIsNumeric && newIsReal;
      // LID novo ou trocado grava; ausente nunca apaga o existente.
      const newLid = data.lid && data.lid !== existing.lid ? data.lid : null;
      if (promoteName || newLid) {
        const raw = await this.prisma.chatContact.update({
          where: { tenantId_phone: { tenantId: data.tenantId, phone: data.phone } },
          data: { ...(promoteName ? { name: data.name } : {}), ...(newLid ? { lid: newLid } : {}) },
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
        lid: data.lid ?? null,
        avatarUrl: data.avatarUrl ?? null,
        notes: data.notes ?? null,
      },
    });
    return PrismaChatContactMapper.toDomain(raw);
  }

  async upsert(data: ChatContactCreateData): Promise<ChatContact> {
    const raw = await this.prisma.chatContact.upsert({
      where: { tenantId_phone: { tenantId: data.tenantId, phone: data.phone } },
      update: {
        name: data.name,
        // Só atualiza avatarUrl se foi explicitamente fornecido — nunca apaga avatar existente
        ...(data.avatarUrl !== undefined ? { avatarUrl: data.avatarUrl } : {}),
        // `lid` só quando veio; null/ausente nunca apaga o par já gravado
        ...(data.lid ? { lid: data.lid } : {}),
      },
      create: {
        tenantId: data.tenantId,
        name: data.name,
        phone: data.phone,
        lid: data.lid ?? null,
        avatarUrl: data.avatarUrl ?? null,
        notes: data.notes ?? null,
      },
    });
    return PrismaChatContactMapper.toDomain(raw);
  }

  async updateAvatarUrlByPhone(phone: string, tenantId: string, avatarUrl: string): Promise<void> {
    // Atualiza apenas avatarUrl — não toca em nome nem outros campos
    await this.prisma.chatContact.updateMany({
      where: { tenantId, phone },
      data: { avatarUrl },
    });
  }
}
