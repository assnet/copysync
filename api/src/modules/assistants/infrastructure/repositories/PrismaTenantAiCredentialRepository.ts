import type { PrismaClient } from '@prisma/client';
import type { ITenantAiCredentialRepository } from '../../domain/contracts/ITenantAiCredentialRepository';
import type { EncryptedBlob, UpsertTenantAiCredentialRecord } from '../../domain/contracts/AiRecords';
import type { TenantAiCredential } from '../../domain/entities/TenantAiCredential';
import { PrismaAiMapper as Mapper } from '../mappers/PrismaAiMapper';
import { AiCredentialInvalidError } from '../../../../shared/errors/internal/AiErrors';

/** Uma linha por tenant (`tenantId` é a chave primária). */
export class PrismaTenantAiCredentialRepository implements ITenantAiCredentialRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async find(tenantId: string): Promise<TenantAiCredential | null> {
    const row = await this.prisma.tenantAiCredential.findUnique({ where: { tenantId } });
    return row ? Mapper.credentialToDomain(row) : null;
  }

  async findKey(tenantId: string): Promise<EncryptedBlob | null> {
    const row = await this.prisma.tenantAiCredential.findUnique({
      where: { tenantId },
      select: { apiKeyCiphertext: true, apiKeyIv: true, apiKeyTag: true, keyVersion: true },
    });
    return row ? Mapper.toBlob(row) : null;
  }

  async upsert(r: UpsertTenantAiCredentialRecord): Promise<TenantAiCredential> {
    const fields = { kind: r.kind, model: r.model, enabled: r.enabled };
    const key = r.apiKey ? Mapper.fromBlob(r.apiKey) : null;
    if (!key) {
      // Sem chave nova só se edita linha existente: nunca cria credencial vazia.
      const { count } = await this.prisma.tenantAiCredential.updateMany({ where: { tenantId: r.tenantId }, data: fields });
      if (count === 0) throw new AiCredentialInvalidError('API key is required', 'apiKey');
    } else {
      await this.prisma.tenantAiCredential.upsert({
        where: { tenantId: r.tenantId },
        create: { tenantId: r.tenantId, ...fields, ...key },
        update: { ...fields, ...key },
      });
    }
    const row = await this.prisma.tenantAiCredential.findUniqueOrThrow({ where: { tenantId: r.tenantId } });
    return Mapper.credentialToDomain(row);
  }

  async delete(tenantId: string): Promise<boolean> {
    const { count } = await this.prisma.tenantAiCredential.deleteMany({ where: { tenantId } });
    return count > 0;
  }
}
