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
  /** One session per (user, installation): re-linking replaces token and clears revocation. */
  issue(input: CreateExtensionSessionInput): Promise<ExtensionSession>;
  rotateToken(id: string, newTokenHash: string, newExpiresAt: Date, graceUntil: Date): Promise<ExtensionSession>;
  slideExpiration(id: string, newExpiresAt: Date): Promise<void>;
  revoke(id: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<number>;
  /** Stops ML sync for every extension session bound to the tenant. */
  revokeMlConsentForTenant(mlTenantId: string): Promise<number>;
  /** false = no active session for this user/installation/tenant. */
  grantMlConsent(userId: string, installationId: string, mlTenantId: string, at: Date): Promise<boolean>;
  deleteExpiredBefore(date: Date): Promise<number>;
}
