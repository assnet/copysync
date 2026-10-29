import { prisma } from '../../../shared/database/prisma.client';
import { type TransactionClient, UnitOfWork } from '../../../shared/database/UnitOfWork';
import { env } from '../../../shared/config/env';
import { getActiveEngine } from '../../../shared/engine/activeEngine';
import { EngineNotReadyError } from '../../../shared/errors/internal/MessagingErrors';
import { PrismaEntitlementReader } from '../../tenants/infrastructure/repositories/PrismaEntitlementReader';
import { DnsAiBaseUrlGuard } from '../../assistants/infrastructure/adapters/DnsAiBaseUrlGuard';
import { PrismaLinkDomainRepository } from './repositories/PrismaLinkDomainRepository';
import { PrismaLinkRotationRepository } from './repositories/PrismaLinkRotationRepository';
import { PrismaPublicSlugRegistry } from './repositories/PrismaPublicSlugRegistry';
import type { IPublicSlugRegistry } from '../domain/contracts/IPublicSlugRegistry';
import { PrismaLinkClickRepository } from './repositories/PrismaLinkClickRepository';
import { PrismaLinkRotationSessionReader } from './repositories/PrismaLinkRotationSessionReader';
import { PrismaLinkRotationGroupCatalog } from './repositories/PrismaLinkRotationGroupCatalog';
import { OffersLinkRotationGroupDirectory } from './adapters/OffersLinkRotationGroupDirectory';
import type {
  LinkRotationGroupEngine,
  LinkRotationUseCaseDeps,
  RotationSlugTransaction,
} from '../application/use-cases/linkRotationUseCaseDeps';
import { GetLinkRotationOverviewUseCase } from '../application/use-cases/GetLinkRotationOverviewUseCase';
import { CreateLinkRotationUseCase } from '../application/use-cases/CreateLinkRotationUseCase';
import { RenameLinkRotationUseCase } from '../application/use-cases/RenameLinkRotationUseCase';
import { UpdateLinkRotationUseCase } from '../application/use-cases/UpdateLinkRotationUseCase';
import { DeleteLinkRotationUseCase } from '../application/use-cases/DeleteLinkRotationUseCase';
import { SaveLinkRotationGroupsUseCase } from '../application/use-cases/SaveLinkRotationGroupsUseCase';
import { SelectLinkRotationGroupsUseCase } from '../application/use-cases/SelectLinkRotationGroupsUseCase';
import { RefreshLinkRotationGroupUseCase } from '../application/use-cases/RefreshLinkRotationGroupUseCase';
import { ListLinkRotationGroupCandidatesUseCase } from '../application/use-cases/ListLinkRotationGroupCandidatesUseCase';
import { GetLinkRotationStatsUseCase } from '../application/use-cases/GetLinkRotationStatsUseCase';
import { ListLinkDomainsUseCase } from '../application/use-cases/admin/ListLinkDomainsUseCase';
import { CreateLinkDomainUseCase } from '../application/use-cases/admin/CreateLinkDomainUseCase';
import { UpdateLinkDomainUseCase } from '../application/use-cases/admin/UpdateLinkDomainUseCase';
import { DeleteLinkDomainUseCase } from '../application/use-cases/admin/DeleteLinkDomainUseCase';
import { ProbeLinkDomainUseCase } from '../application/use-cases/admin/ProbeLinkDomainUseCase';
import { GrantPremiumSlugUseCase } from '../application/use-cases/admin/GrantPremiumSlugUseCase';
import { RevokePremiumSlugUseCase } from '../application/use-cases/admin/RevokePremiumSlugUseCase';
import { ListPremiumSlugGrantsUseCase } from '../application/use-cases/admin/ListPremiumSlugGrantsUseCase';
import { PrismaPremiumSlugGrantRepository } from './repositories/PrismaPremiumSlugGrantRepository';
import { PrismaAuditLogRepository } from '../../../shared/audit/PrismaAuditLogRepository';
import { platformHostnames } from '../application/use-cases/admin/linkDomainRules';

/*
 * Composição do rodízio de links (design.md §4.5). Tudo lazy: importar não toca banco.
 * Rotas do painel e admin usam as mesmas instâncias. Engine resolvido a cada chamada (o
 * `session.routes` registra depois); ausente = `ENGINE_NOT_READY`, que os use cases tratam.
 * A rota pública (T11) tem composição própria.
 */
function lazy<T>(make: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= make());
}

function activeEngine() {
  const engine = getActiveEngine();
  if (!engine) throw new EngineNotReadyError();
  return engine;
}

const groupEngine: LinkRotationGroupEngine = {
  getGroupInviteLink: (sessionId, groupJid) => activeEngine().getGroupInviteLink(sessionId, groupJid),
  getGroupSummary: (sessionId, groupJid) => activeEngine().getGroupSummary(sessionId, groupJid),
};

/**
 * Transação do namespace público para qualquer módulo dono de nome (rodízio, página de ofertas):
 * `slugs` preso ao tx; o chamador monta os próprios repositórios com o mesmo `tx`.
 * Erro (inclusive unique do claim) desfaz tudo e sobe já fora do tx.
 */
export function runInSlugTransaction<T>(
  fn: (scope: { slugs: IPublicSlugRegistry; tx: TransactionClient }) => Promise<T>,
): Promise<T> {
  return new UnitOfWork().runInTransaction((tx) => fn({ slugs: new PrismaPublicSlugRegistry(tx), tx }));
}

const rotationSlugTransaction: RotationSlugTransaction = (fn) =>
  runInSlugTransaction(({ slugs, tx }) => fn({ slugs, rotations: new PrismaLinkRotationRepository(tx) }));

const domains   = lazy(() => new PrismaLinkDomainRepository(prisma));
const slugs     = lazy(() => new PrismaPublicSlugRegistry(prisma));
const rotations = lazy(() => new PrismaLinkRotationRepository(prisma));
const clicks    = lazy(() => new PrismaLinkClickRepository(prisma));
const directory = lazy(() => new OffersLinkRotationGroupDirectory());

const deps = lazy((): LinkRotationUseCaseDeps => ({
  rotations:    rotations(),
  slugs:        slugs(),
  runInSlugTransaction: rotationSlugTransaction,
  domains:      domains(),
  sessions:     new PrismaLinkRotationSessionReader(prisma),
  groups:       new PrismaLinkRotationGroupCatalog(prisma),
  entitlements: new PrismaEntitlementReader(prisma),
  engine:       groupEngine,
}));

const saveGroups = lazy(() => new SaveLinkRotationGroupsUseCase(deps()));

const tenantUseCases = lazy(() => ({
  overview:        new GetLinkRotationOverviewUseCase(deps()),
  create:          new CreateLinkRotationUseCase(deps()),
  rename:          new RenameLinkRotationUseCase(deps()),
  update:          new UpdateLinkRotationUseCase(deps()),
  delete:          new DeleteLinkRotationUseCase(deps()),
  saveGroups:      saveGroups(),
  selectGroups:    new SelectLinkRotationGroupsUseCase({ ...deps(), directory: directory(), save: saveGroups() }),
  refreshGroup:    new RefreshLinkRotationGroupUseCase(deps()),
  groupCandidates: new ListLinkRotationGroupCandidatesUseCase({ ...deps(), directory: directory() }),
  stats:           new GetLinkRotationStatsUseCase({ ...deps(), clicks: clicks() }),
}));

const grants = lazy(() => new PrismaPremiumSlugGrantRepository(prisma));

const adminUseCases = lazy(() => ({
  list:   new ListLinkDomainsUseCase(domains()),
  create: new CreateLinkDomainUseCase(domains(), platformHostnames(env.PANEL_URL)),
  update: new UpdateLinkDomainUseCase(domains()),
  delete: new DeleteLinkDomainUseCase(domains()),
  probe:  new ProbeLinkDomainUseCase(domains(), { secret: env.LINK_PROBE_SECRET, guard: new DnsAiBaseUrlGuard() }),
  listGrants: new ListPremiumSlugGrantsUseCase(domains(), grants()),
  grant:      new GrantPremiumSlugUseCase(domains(), grants(), new PrismaAuditLogRepository()),
  revoke:     new RevokePremiumSlugUseCase(grants(), new PrismaAuditLogRepository()),
}));

export const linkRotationContainer = {
  get domainRepository(): PrismaLinkDomainRepository { return domains(); },
  get rotationRepository(): PrismaLinkRotationRepository { return rotations(); },
  get clickRepository(): PrismaLinkClickRepository { return clicks(); },
  /** Leitura do namespace público (check/suggest) fora de transação. */
  get publicSlugRegistry(): IPublicSlugRegistry { return slugs(); },
  /** Escritas de nome (claim/move/release) junto com o dono, na mesma transação. */
  runInSlugTransaction,
  /** Use cases do painel do tenant (`/link-rotation`). */
  useCases: tenantUseCases,
  /** Use cases do super-admin (`/admin/link-domains`). */
  adminUseCases,
};
