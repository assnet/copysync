import type { SaverRole } from '../services/saverPermissions';

/** Membros do tenant (lidos de `user_tenants`/`users` filtrado por `tenantId`). Nada importado de `users`. */
export interface SaverTeamMember {
  userId: string;
  role: SaverRole;
  name: string;
  email: string;
}

export interface ISaverTeamReader {
  listMembers(tenantId: string): Promise<SaverTeamMember[]>;
  findMember(tenantId: string, userId: string): Promise<SaverTeamMember | null>;
}
