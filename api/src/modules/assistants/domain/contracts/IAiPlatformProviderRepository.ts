import type { AiPlatformProvider } from '../entities/AiPlatformProvider';
import type {
  CreateAiPlatformProviderRecord,
  EncryptedBlob,
  UpdateAiPlatformProviderRecord,
} from './AiRecords';

/** Tabela global (sem tenantId): só o super admin e a resolução de IA a usam. */
export interface IAiPlatformProviderRepository {
  list(): Promise<AiPlatformProvider[]>;
  findById(id: string): Promise<AiPlatformProvider | null>;
  /** Ativo de menor `priority` (desempate por criação), ou null. */
  findFirstEnabled(): Promise<AiPlatformProvider | null>;
  findKey(id: string): Promise<EncryptedBlob | null>;
  create(record: CreateAiPlatformProviderRecord): Promise<AiPlatformProvider>;
  /** null se não existe. */
  update(id: string, record: UpdateAiPlatformProviderRecord): Promise<AiPlatformProvider | null>;
  /** false se não existe. */
  delete(id: string): Promise<boolean>;
}
