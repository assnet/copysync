/** Contrato de `/api/admin/redirect-links` e `/api/public/redirects` (docs/redirect-links.md). */
export interface RedirectLink {
  id: string;
  slug: string;
  urlA: string;
  /** null = 100% para A. */
  urlB: string | null;
  /** Inteiro 0–100: chance de A quando há B. */
  percentA: number;
  isActive: boolean;
  hitsA: number;
  hitsB: number;
  hitsTotal: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRedirectLinkRequest {
  slug: string;
  urlA: string;
  urlB?: string | null;
  percentA?: number;
  isActive?: boolean;
  note?: string | null;
}

/** Parcial. `urlB: null` remove B; `note: null` remove a nota. */
export type UpdateRedirectLinkRequest = Partial<CreateRedirectLinkRequest>;
