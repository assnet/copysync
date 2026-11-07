import type { IRedirectLinkRepository } from '../../domain/contracts/IRedirectLinkRepository';
import type { RedirectSide } from '../../domain/entities/RedirectLink';
import { pickRedirectSide } from '../../domain/services/pickRedirectSide';
import { isSafeRedirectTarget, parseRedirectSlug } from '../../domain/services/redirectLinkRules';

export interface ResolveRedirectLinkOptions {
  /** [0, 1); padrão `Math.random`. */
  rng?: () => number;
  /** Falha do contador: só registra, nunca derruba o redirecionamento. */
  onCountError?: (err: unknown) => void;
}

export interface ResolvedRedirect {
  url: string;
  side: RedirectSide;
}

/**
 * Rota pública: slug ativo → destino sorteado (A/B no servidor). O contador do lado escolhido é
 * incrementado sem esperar (a resposta não depende da escrita). null = inexistente, inativo ou
 * destino que não passa na defesa de saída (`https` sem credencial) → 404 sem detalhe.
 */
export class ResolveRedirectLinkUseCase {
  private readonly rng: () => number;
  private readonly onCountError: (err: unknown) => void;

  constructor(private readonly links: IRedirectLinkRepository, options: ResolveRedirectLinkOptions = {}) {
    this.rng = options.rng ?? Math.random;
    this.onCountError = options.onCountError ?? (() => undefined);
  }

  async execute(rawSlug: string): Promise<ResolvedRedirect | null> {
    const slug = parseRedirectSlug(rawSlug);
    if (!slug) return null;
    const link = await this.links.findActiveBySlug(slug);
    if (!link) return null;
    const side = pickRedirectSide(link, this.rng);
    const url = side === 'B' && link.urlB ? link.urlB : link.urlA;
    if (!isSafeRedirectTarget(url)) return null;
    this.links.incrementHit(link.id, side).catch(this.onCountError);
    return { url, side };
  }
}
