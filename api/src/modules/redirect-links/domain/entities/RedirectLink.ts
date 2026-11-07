/**
 * Link de redirecionamento da PLATAFORMA (marketing/suporte), não do tenant: sem `tenantId`.
 * Só o super-admin gerencia; a resolução pública não tem contexto de tenant. Ver docs/redirect-links.md.
 */
export interface RedirectLink {
  id: string;
  /** Minúsculo, `[a-z0-9.-]`, 1–100. Editável: o slug antigo deixa de funcionar na hora. */
  slug: string;
  urlA: string;
  /** null = 100% para A. */
  urlB: string | null;
  /** Inteiro 0–100: chance de A quando há B. Sem B é sempre 100. */
  percentA: number;
  isActive: boolean;
  hitsA: number;
  hitsB: number;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type RedirectSide = 'A' | 'B';
