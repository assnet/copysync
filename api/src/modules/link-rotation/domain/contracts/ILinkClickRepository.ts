import type { UserAgentClass } from '../enums/LinkRotationEnums';

export interface RecordLinkClickInput {
  tenantId: string;
  rotationId: string;
  groupId: string | null;
  /** sha256(ip + dia + salt): nunca o IP cru. */
  ipHash: string;
  userAgentClass: UserAgentClass;
  createdAt?: Date;
}

/** Cliques contados: base para "últimos 7 dias", dedupe e abuso. Agregado vive em `clickCount`. */
export interface ILinkClickRepository {
  record(input: RecordLinkClickInput): Promise<void>;
  countLast7Days(tenantId: string, rotationId: string, now: Date): Promise<number>;
  /** Mesma janela de `countLast7Days`, agrupada por grupo. Grupo sem clique não aparece. */
  countLast7DaysByGroup(tenantId: string, rotationId: string, now: Date): Promise<Map<string, number>>;
  /** Retenção (90 dias). Devolve quantas linhas saíram. */
  deleteOlderThan(cutoff: Date): Promise<number>;
}
