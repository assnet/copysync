import { AppError } from '../AppError';

// ── Links de redirecionamento da plataforma (docs/redirect-links.md) ─────────

export type RedirectLinkInvalidField = 'slug' | 'urlA' | 'urlB' | 'percentA' | 'note';

/** Campo fora da regra (slug, destino, percentual ou nota). `meta.field` diz qual; `meta.reason` o motivo. */
export class RedirectLinkInvalidError extends AppError {
  constructor(field: RedirectLinkInvalidField, reason: string) {
    super('REDIRECT_LINK_INVALID', `Invalid ${field}`, 400, { field, reason });
  }
}

/** Já existe link com o slug. */
export class RedirectLinkSlugTakenError extends AppError {
  constructor() {
    super('REDIRECT_LINK_SLUG_TAKEN', 'Slug already in use', 409, { field: 'slug' });
  }
}

/** Link inexistente (admin) ou inexistente/inativo (rota pública). Sem slug na mensagem. */
export class RedirectLinkNotFoundError extends AppError {
  constructor() {
    super('REDIRECT_LINK_NOT_FOUND', 'Not found', 404);
  }
}
