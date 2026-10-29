/** Espelho TS dos enums Prisma do rodízio de links (design.md §3). Valores idênticos aos do banco. */

export enum LinkDomainStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
}

export enum LinkRotationStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  PAUSED_BY_PLAN = 'PAUSED_BY_PLAN',
}

export enum LinkRotationStrategy {
  BALANCED = 'BALANCED',
  SEQUENTIAL = 'SEQUENTIAL',
  WEIGHTED = 'WEIGHTED',
  RANDOM = 'RANDOM',
}

export enum LinkRotationGroupStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  FULL = 'FULL',
  NEEDS_LINK = 'NEEDS_LINK',
  PAUSED_BY_PLAN = 'PAUSED_BY_PLAN',
}

export enum LinkRotationGroupLinkSource {
  AUTO = 'AUTO',
  MANUAL = 'MANUAL',
}

/** Classe do user agent gravada em `LinkClick.userAgentClass`. */
export type UserAgentClass = 'bot' | 'webview' | 'browser';
