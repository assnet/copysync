import { Prisma, type PrismaClient } from '@prisma/client';
import type { IAiPlatformProviderRepository } from '../../domain/contracts/IAiPlatformProviderRepository';
import type {
  CreateAiPlatformProviderRecord,
  EncryptedBlob,
  UpdateAiPlatformProviderRecord,
} from '../../domain/contracts/AiRecords';
import type { AiPlatformProvider } from '../../domain/entities/AiPlatformProvider';
import { PrismaAiMapper as Mapper } from '../mappers/PrismaAiMapper';

function isNotFound(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025';
}

/** Tabela global da plataforma (sem tenantId por desenho). */
export class PrismaAiPlatformProviderRepository implements IAiPlatformProviderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(): Promise<AiPlatformProvider[]> {
    const rows = await this.prisma.aiPlatformProvider.findMany({ orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] });
    return rows.map(Mapper.providerToDomain);
  }

  async findById(id: string): Promise<AiPlatformProvider | null> {
    const row = await this.prisma.aiPlatformProvider.findUnique({ where: { id } });
    return row ? Mapper.providerToDomain(row) : null;
  }

  async findFirstEnabled(): Promise<AiPlatformProvider | null> {
    const row = await this.prisma.aiPlatformProvider.findFirst({
      where: { enabled: true },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
    return row ? Mapper.providerToDomain(row) : null;
  }

  async findKey(id: string): Promise<EncryptedBlob | null> {
    const row = await this.prisma.aiPlatformProvider.findUnique({
      where: { id },
      select: { apiKeyCiphertext: true, apiKeyIv: true, apiKeyTag: true, keyVersion: true },
    });
    return row ? Mapper.toBlob(row) : null;
  }

  async create(r: CreateAiPlatformProviderRecord): Promise<AiPlatformProvider> {
    const row = await this.prisma.aiPlatformProvider.create({
      data: {
        id: r.id,
        kind: r.kind,
        label: r.label,
        model: r.model,
        enabled: r.enabled,
        priority: r.priority,
        dailyLimitPerTenant: r.dailyLimitPerTenant,
        baseUrl: r.baseUrl,
        ...Mapper.fromBlob(r.apiKey),
      },
    });
    return Mapper.providerToDomain(row);
  }

  async update(id: string, r: UpdateAiPlatformProviderRecord): Promise<AiPlatformProvider | null> {
    const { apiKey, ...fields } = r;
    try {
      const row = await this.prisma.aiPlatformProvider.update({
        where: { id },
        data: { ...fields, ...(apiKey && Mapper.fromBlob(apiKey)) },
      });
      return Mapper.providerToDomain(row);
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async delete(id: string): Promise<boolean> {
    const { count } = await this.prisma.aiPlatformProvider.deleteMany({ where: { id } });
    return count > 0;
  }
}
