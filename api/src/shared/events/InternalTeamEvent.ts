export type InternalTeamEvent =
  | { type: 'MEMBER_DEACTIVATED'; tenantId: string; userId: string }
  | { type: 'TENANT_SUSPENDED'; tenantId: string };
