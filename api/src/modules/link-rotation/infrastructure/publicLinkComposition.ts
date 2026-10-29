import { env } from '../../../shared/config/env';
import { prisma } from '../../../shared/database/prisma.client';
import { logger } from '../../../shared/logger/logger';
import { platformHostnames } from '../application/use-cases/admin/linkDomainRules';
import { ResolvePublicLinkUseCase } from '../application/use-cases/ResolvePublicLinkUseCase';
import type { PublicLinkDeps } from '../presentation/routes/publicLink.routes';
import { ActiveLinkDomainCache } from './cache/ActiveLinkDomainCache';
import { linkRotationContainer } from './linkRotationContainer';
import { PrismaLinkRotationPublicStore } from './repositories/PrismaLinkRotationPublicStore';

/**
 * Monta a página pública por Host (design.md §4.4). Nada toca o banco aqui: o cache de
 * domínios carrega na 1ª requisição e os repositórios do container são lazy.
 */
export function createPublicLinkDeps(): PublicLinkDeps {
  const domains = new ActiveLinkDomainCache(() => linkRotationContainer.domainRepository.listActive(), {
    onError: (err) => logger.warn({ err: (err as Error)?.name }, 'link domains not loaded; public host routing off'),
  });
  const resolver = new ResolvePublicLinkUseCase({
    domains,
    rotations: linkRotationContainer.rotationRepository,
    clicks: linkRotationContainer.clickRepository,
    store: new PrismaLinkRotationPublicStore(prisma),
    // Página pública depende só do sal; sem LINK_PROBE_SECRET apenas o teste de DNS fica desligado.
    clickSalt: env.LINK_CLICK_SALT ?? null,
  });
  return {
    domains,
    resolver,
    probeSecret: env.LINK_PROBE_SECRET ?? null,
    platformHosts: platformHostnames(env.PANEL_URL),
  };
}
