import type { ExtensionSession } from '../entities/ExtensionSession';
import type { ExtensionConsentMarketplace } from '../constants';

export interface CreateExtensionSessionInput {
  userId: string;
  installationId: string;
  mlTenantId: string;
  tokenHash: string;
  extVersion: string;
  mlConsentAt: Date | null;
  /** Sempre null na emissão: re-vínculo zera o consentimento Shein. */
  sheinConsentAt: Date | null;
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
  /** Stops ML sync for every extension session bound to the tenant. Same as `revokeConsentForTenant('ML', …)`. */
  revokeMlConsentForTenant(mlTenantId: string): Promise<number>;
  /** false = no active session for this user/installation/tenant. Same as `grantConsent('ML', …)`. */
  grantMlConsent(userId: string, installationId: string, mlTenantId: string, at: Date): Promise<boolean>;
  /** Stops the marketplace sync for every extension session bound to the tenant. */
  revokeConsentForTenant(marketplace: ExtensionConsentMarketplace, mlTenantId: string): Promise<number>;
  /** false = no active session for this user/installation/tenant. */
  grantConsent(
    marketplace: ExtensionConsentMarketplace,
    userId: string,
    installationId: string,
    mlTenantId: string,
    at: Date,
  ): Promise<boolean>;
  /** Fresh read (not the auth-hook snapshot): consent still granted and session not revoked. */
  hasConsent(sessionId: string, marketplace: ExtensionConsentMarketplace): Promise<boolean>;
  /** Fresh read: some non-revoked session bound to the tenant still has the marketplace consent. */
  hasAnyConsentForTenant(mlTenantId: string, marketplace: ExtensionConsentMarketplace): Promise<boolean>;
  deleteExpiredBefore(date: Date): Promise<number>;
}
