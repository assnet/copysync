import type { IMessagingEngine } from '../../../messaging/domain/contracts/IMessagingEngine';
import type { IEntitlementReader } from '../../../tenants/domain/contracts/IEntitlementReader';
import type { ILinkDomainRepository } from '../../domain/contracts/ILinkDomainRepository';
import type { ILinkRotationGroupCatalog } from '../../domain/contracts/ILinkRotationGroupCatalog';
import type { ILinkRotationRepository } from '../../domain/contracts/ILinkRotationRepository';
import type { ILinkRotationSessionReader } from '../../domain/contracts/ILinkRotationSessionReader';
import type { IPublicSlugRegistry } from '../../domain/contracts/IPublicSlugRegistry';

/** Só o que o rodízio usa do engine (convite e resumo do grupo). */
export type LinkRotationGroupEngine = Pick<IMessagingEngine, 'getGroupInviteLink' | 'getGroupSummary'>;

/** Domínios: o tenant só lê. */
export type LinkDomainReader = Pick<ILinkDomainRepository, 'findById' | 'list' | 'listActive'>;

/** Repositórios presos à mesma transação (dono + claim do nome). */
export interface SlugTransactionScope {
  rotations: ILinkRotationRepository;
  slugs: IPublicSlugRegistry;
}

/** Roda `fn` numa transação; erro desfaz tudo e sobe para o chamador, já fora do tx. */
export type RotationSlugTransaction = <T>(fn: (scope: SlugTransactionScope) => Promise<T>) => Promise<T>;

/** Dependências dos use cases do tenant; cada use case recebe o subconjunto que precisa. */
export interface LinkRotationUseCaseDeps {
  rotations: ILinkRotationRepository;
  /** Leitura do namespace público (check/suggest) fora de transação. */
  slugs: IPublicSlugRegistry;
  runInSlugTransaction: RotationSlugTransaction;
  domains: LinkDomainReader;
  sessions: ILinkRotationSessionReader;
  groups: ILinkRotationGroupCatalog;
  entitlements: IEntitlementReader;
  engine: LinkRotationGroupEngine;
  /** Relógio injetável (reserva de 30 dias, memberCountAt). */
  now?: () => Date;
}

/** Nome trocado/excluído fica com o tenant por 30 dias (context.md #8). */
export const SLUG_RESERVATION_DAYS = 30;
export const SLUG_RESERVATION_MS = SLUG_RESERVATION_DAYS * 86_400_000;
