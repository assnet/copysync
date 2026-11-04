import type { LinkRotationStatus, LinkRotationStrategy } from '../enums/LinkRotationEnums';
import type { LinkRotationChannel } from '../services/inviteUrl';
import type { LinkRotationGroup } from './LinkRotationGroup';

/** Link de rodízio do tenant: `https://<slug>.<domain.hostname>` → um dos grupos. */
export interface LinkRotation {
  id: string;
  tenantId: string;
  /** Sessão dona dos grupos. */
  sessionId: string;
  /** Canal da sessão (`Session.engine`), não persistido: decide formato do convite e teto. */
  channel: LinkRotationChannel;
  domainId: string;
  slug: string;
  status: LinkRotationStatus;
  strategy: LinkRotationStrategy;
  /** Nome exibido na página pública (null = nome da sessão). */
  title: string | null;
  clickCount: number;
  lastClickAt: Date | null;
  allFullNotifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LinkRotationWithGroups extends LinkRotation {
  groups: LinkRotationGroup[];
}
