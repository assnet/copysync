export interface ExtensionSession {
  id: string;
  tokenHash: string;
  prevTokenHash: string | null;
  prevValidUntil: Date | null;
  userId: string;
  installationId: string;
  mlTenantId: string;
  extVersion: string;
  mlConsentAt: Date | null;
  lastSeenAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
