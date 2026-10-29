import { linkRotationStrings } from '@/features/linkRotation/strings';

const t = linkRotationStrings.errors;

/** Códigos que o painel traduz (tabela "Erros que o painel traduz" do contrato). */
export const LINK_ROTATION_ERROR_CODES = [
  'PLAN_LIMIT_REACHED',
  'LINK_SLUG_TAKEN',
  'LINK_SLUG_RESERVED',
  'LINK_SLUG_INVALID',
  'LINK_ROTATION_NOT_FOUND',
  'LINK_GROUP_INVALID',
  'LINK_INVITE_URL_INVALID',
  'LINK_DOMAIN_INVALID',
  'LINK_DOMAIN_TAKEN',
  'LINK_DOMAIN_IN_USE',
  'LINK_ROTATION_NOT_CONFIGURED',
  'GROUP_INVITE_NOT_ALLOWED',
  'ENGINE_NOT_READY',
  'SESSION_NOT_CONNECTED',
] as const;

export type LinkRotationErrorCode = (typeof LINK_ROTATION_ERROR_CODES)[number];

export interface LinkRotationErrorInfo {
  code: LinkRotationErrorCode | null;
  message: string;
  /** `PLAN_LIMIT_REACHED`: qual limite estourou (abre o banner de upgrade). */
  limitKind: 'rotations' | 'groups' | null;
  limit: number | null;
  /** `LINK_SLUG_TAKEN`: nomes livres sugeridos pela API. */
  suggestions: string[];
}

interface ApiErrorShape {
  code?: unknown;
  meta?: Record<string, unknown> | null;
}

/**
 * Erro da API → informação exibível em pt-BR. Nunca devolve a `message` crua da API:
 * código desconhecido cai no texto genérico.
 */
export function linkRotationError(err: unknown): LinkRotationErrorInfo {
  const e = (err ?? {}) as ApiErrorShape;
  const raw = typeof e.code === 'string' ? e.code : null;
  const code = (LINK_ROTATION_ERROR_CODES as readonly string[]).includes(raw ?? '') ? (raw as LinkRotationErrorCode) : null;
  const meta = e.meta ?? {};
  const base: LinkRotationErrorInfo = { code, message: t.generic, limitKind: null, limit: null, suggestions: [] };

  switch (code) {
    case 'PLAN_LIMIT_REACHED': {
      const limit = typeof meta.limit === 'number' ? meta.limit : null;
      const groups = meta.key === 'link_rotation_groups';
      return {
        ...base,
        limit,
        limitKind: groups ? 'groups' : 'rotations',
        message: groups ? t.planLimitGroups(limit) : t.planLimitRotations(limit),
      };
    }
    case 'LINK_SLUG_TAKEN': {
      const suggestions = Array.isArray(meta.suggestions) ? meta.suggestions.filter((s): s is string => typeof s === 'string') : [];
      return { ...base, message: t.slugTaken, suggestions };
    }
    case 'LINK_SLUG_RESERVED':
      return { ...base, message: t.slugReserved };
    case 'LINK_SLUG_INVALID':
      return { ...base, message: t.slugInvalid };
    case 'LINK_ROTATION_NOT_FOUND':
      return { ...base, message: t.rotationNotFound };
    case 'LINK_GROUP_INVALID':
      return { ...base, message: t.groupInvalid };
    case 'LINK_INVITE_URL_INVALID':
      return { ...base, message: t.inviteUrlInvalid };
    case 'LINK_DOMAIN_INVALID':
      return { ...base, message: t.domainInvalid };
    case 'LINK_DOMAIN_TAKEN':
      return { ...base, message: t.domainTaken(typeof meta.hostname === 'string' ? meta.hostname : null) };
    case 'LINK_DOMAIN_IN_USE':
      return { ...base, message: t.domainInUse };
    case 'LINK_ROTATION_NOT_CONFIGURED':
      return { ...base, message: t.notConfigured };
    case 'GROUP_INVITE_NOT_ALLOWED':
      return { ...base, message: t.inviteNotAllowed };
    case 'ENGINE_NOT_READY':
      return { ...base, message: t.engineNotReady };
    case 'SESSION_NOT_CONNECTED':
      return { ...base, message: t.sessionNotConnected };
    default:
      return base;
  }
}

/** Atalho: só a frase. */
export function linkRotationErrorMessage(err: unknown): string {
  return linkRotationError(err).message;
}
