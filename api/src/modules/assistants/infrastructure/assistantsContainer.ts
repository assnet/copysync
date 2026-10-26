import { prisma } from '../../../shared/database/prisma.client';
import { SecretCipherFactory } from '../../../shared/security/SecretCipherFactory';
import type { IAiTextGenerator } from '../domain/contracts/IAiTextGenerator';
import { PrismaAiSettingsRepository } from './repositories/PrismaAiSettingsRepository';
import { PrismaAiPlatformProviderRepository } from './repositories/PrismaAiPlatformProviderRepository';
import { PrismaTenantAiCredentialRepository } from './repositories/PrismaTenantAiCredentialRepository';
import { PrismaAiUsageLogRepository } from './repositories/PrismaAiUsageLogRepository';
import { PrismaAiEntitlementReader } from './repositories/PrismaAiEntitlementReader';
import { LoggerAiAuditTrail } from './LoggerAiAuditTrail';
import { createAiTextProviderAdapterFactory } from './adapters/AiTextProviderAdapterFactory';
import { GetAiSettingsUseCase, UpdateAiSettingsUseCase } from '../application/use-cases/AiSettingsUseCases';
import {
  CreateAiPlatformProviderUseCase,
  DeleteAiPlatformProviderUseCase,
  ListAiPlatformProvidersUseCase,
  UpdateAiPlatformProviderUseCase,
} from '../application/use-cases/AiPlatformProviderUseCases';
import {
  DeleteTenantAiCredentialUseCase,
  UpsertTenantAiCredentialUseCase,
} from '../application/use-cases/TenantAiCredentialUseCases';
import {
  TestAiPlatformProviderUseCase,
  TestTenantAiCredentialUseCase,
} from '../application/use-cases/TestAiProviderUseCases';
import { ResolveAiTextProviderUseCase } from '../application/use-cases/ResolveAiTextProviderUseCase';
import { GetAiStatusUseCase } from '../application/use-cases/GetAiStatusUseCase';
import { AiTextGeneratorService } from '../application/services/AiTextGeneratorService';

/**
 * Composição única do módulo `assistants`. Outros módulos só consomem `aiTextGenerator()`
 * (porta `IAiTextGenerator`); nada aqui é criado antes do primeiro uso.
 */
function build() {
  const settings = new PrismaAiSettingsRepository(prisma);
  const providers = new PrismaAiPlatformProviderRepository(prisma);
  const credentials = new PrismaTenantAiCredentialRepository(prisma);
  const usage = new PrismaAiUsageLogRepository(prisma);
  const entitlements = new PrismaAiEntitlementReader(prisma);
  const audit = new LoggerAiAuditTrail();
  // Cifra resolvida no uso: sem chave, só quem cifra/decifra responde 503.
  const cipher = () => SecretCipherFactory.get();
  const adapters = createAiTextProviderAdapterFactory();
  const resolve = new ResolveAiTextProviderUseCase(settings, providers, credentials, entitlements, cipher);

  return {
    getSettings: new GetAiSettingsUseCase(settings),
    updateSettings: new UpdateAiSettingsUseCase(settings, audit),
    listProviders: new ListAiPlatformProvidersUseCase(providers),
    createProvider: new CreateAiPlatformProviderUseCase(providers, cipher, audit),
    updateProvider: new UpdateAiPlatformProviderUseCase(providers, cipher, audit),
    deleteProvider: new DeleteAiPlatformProviderUseCase(providers, audit),
    testProvider: new TestAiPlatformProviderUseCase(providers, cipher, adapters),
    status: new GetAiStatusUseCase(settings, providers, credentials, entitlements),
    upsertCredential: new UpsertTenantAiCredentialUseCase(credentials, cipher, audit),
    deleteCredential: new DeleteTenantAiCredentialUseCase(credentials, audit),
    testCredential: new TestTenantAiCredentialUseCase(credentials, cipher, adapters),
    resolve,
    generator: new AiTextGeneratorService(resolve, adapters, usage) as IAiTextGenerator,
  };
}

let built: ReturnType<typeof build> | null = null;

export const assistantsContainer = {
  useCases(): ReturnType<typeof build> {
    built ??= build();
    return built;
  },
  /** Porta de texto por IA para outros módulos (ex. `campaigns`). */
  aiTextGenerator(): IAiTextGenerator {
    return this.useCases().generator;
  },
};
