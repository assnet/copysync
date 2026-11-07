import { prisma } from '../../../shared/database/prisma.client';
import { env } from '../../../shared/config/env';
import { logger } from '../../../shared/logger/logger';
import { platformHostnames } from '../../link-rotation/application/use-cases/admin/linkDomainRules';
import { PrismaRedirectLinkRepository } from './repositories/PrismaRedirectLinkRepository';
import { ListRedirectLinksUseCase } from '../application/use-cases/ListRedirectLinksUseCase';
import { CreateRedirectLinkUseCase } from '../application/use-cases/CreateRedirectLinkUseCase';
import { UpdateRedirectLinkUseCase } from '../application/use-cases/UpdateRedirectLinkUseCase';
import { DeleteRedirectLinkUseCase } from '../application/use-cases/DeleteRedirectLinkUseCase';
import { ResolveRedirectLinkUseCase } from '../application/use-cases/ResolveRedirectLinkUseCase';

const lazy = <T>(make: () => T): (() => T) => {
  let value: T | undefined;
  return () => (value ??= make());
};

const links = lazy(() => new PrismaRedirectLinkRepository(prisma));
/** Hosts do painel/API (mesma lista do Gestor de Links): destino neles em `/redirect` = loop. */
const platformHosts = lazy(() => platformHostnames(env.PANEL_URL));

const adminUseCases = lazy(() => ({
  list: new ListRedirectLinksUseCase(links()),
  create: new CreateRedirectLinkUseCase(links(), platformHosts()),
  update: new UpdateRedirectLinkUseCase(links(), platformHosts()),
  delete: new DeleteRedirectLinkUseCase(links()),
}));

const resolve = lazy(() => new ResolveRedirectLinkUseCase(links(), {
  onCountError: (err) => logger.warn({ err: (err as Error)?.name }, 'redirect link hit not counted'),
}));

export const redirectLinksContainer = {
  /** Use cases do super-admin (`/admin/redirect-links`). */
  adminUseCases,
  /** Resolução pública (`/public/redirects/:slug`). */
  resolve,
};
