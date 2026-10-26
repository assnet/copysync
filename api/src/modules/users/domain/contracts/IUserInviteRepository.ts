export interface UserInviteData {
  id: string;
  tenantId: string;
  email: string;
  role: string;
  tokenHash: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  invitedById: string | null;
  createdAt: Date;
}

export interface IUserInviteRepository {
  create(data: Omit<UserInviteData, 'createdAt'>): Promise<UserInviteData>;
  findByTokenHash(tokenHash: string): Promise<UserInviteData | null>;
  findPendingByTenantAndEmail(tenantId: string, email: string): Promise<UserInviteData | null>;
  markAccepted(id: string): Promise<void>;
  expirePreviousInvites(tenantId: string, email: string): Promise<void>;
  cleanupOldInvites(tenantId: string, email: string, retentionDays: number): Promise<void>;
}
