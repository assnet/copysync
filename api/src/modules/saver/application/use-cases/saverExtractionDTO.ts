import type { SaverExtraction } from '../../domain/entities/SaverEntities';
import type { SaverExtractionStatus, SaverExtractionTrigger } from '../../domain/enums/SaverEnums';

/** Progresso de uma extração (só contagens; nunca contato). */
export interface SaverExtractionDTO {
  id: string;
  sessionId: string | null;
  trigger: SaverExtractionTrigger;
  status: SaverExtractionStatus;
  totalGroups: number;
  doneGroups: number;
  failedGroups: number;
  membersFound: number;
  newContacts: number;
  createdAt: Date;
  finishedAt: Date | null;
}

export const toSaverExtractionDTO = (e: SaverExtraction): SaverExtractionDTO => ({
  id: e.id,
  sessionId: e.sessionId,
  trigger: e.trigger,
  status: e.status,
  totalGroups: e.totalGroups,
  doneGroups: e.doneGroups,
  failedGroups: e.failedGroups,
  membersFound: e.membersFound,
  newContacts: e.newContacts,
  createdAt: e.createdAt,
  finishedAt: e.finishedAt,
});
