import type { ExtensionSession } from '../entities/ExtensionSession';

export interface CreateExtensionSessionInput {
  userId: string;
  installationId: string;
  mlTenantId: string;
  tokenHash: string;
  extVersion: string;
  mlConsentAt: Date | null;
  expiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface IExtensionSessionRepository {
  findByTokenHash(tokenHash: string): Promise<ExtensionSession | null>;
  findByPrevTokenHash(prevTokenHash: string): Promise<ExtensionSession | null>;
  findByUserAndInstallation(userId: string, installationId: string): Promise<ExtensionSession | null>;
  findActiveByUserId(userId: string): Promise<ExtensionSession[]>;
  create(input: CreateExtensionSessionInput): Promise<ExtensionSession>;
  rotateToken(id: string, newTokenHash: string, newExpiresAt: Date, graceUntil: Date): Promise<ExtensionSession>;
  slideExpiration(id: string, newExpiresAt: Date): Promise<void>;
  revoke(id: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<number>;
  deleteExpiredBefore(date: Date): Promise<number>;
}
