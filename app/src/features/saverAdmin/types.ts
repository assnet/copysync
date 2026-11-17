/** Contrato de `/admin/saver` (presenter `platformContact*` da API). Datas em ISO. */
export interface PlatformContact {
  id: string;
  name: string | null;
  phone: string | null;
  lid: string | null;
  tenantCount: number;
  groupCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  firstExtractedAt: string | null;
  lastExtractedAt: string | null;
}

export interface PlatformContactsPage {
  items: PlatformContact[];
  /** Cursor assinado (opaco) da próxima página; null = fim. */
  nextCursor: string | null;
}

/** Uma extração do contato: em qual conta, em qual grupo e quando. */
export interface PlatformContactLink {
  tenantId: string;
  tenantName: string;
  groupId: string;
  groupName: string;
  name: string | null;
  isAdmin: boolean;
  firstExtractedAt: string;
  lastExtractedAt: string;
  leftAt: string | null;
}

/** Conta com vínculo na base (`GET /admin/saver/tenants`), para o seletor do filtro. */
export interface PlatformTenantOption {
  id: string;
  name: string;
}

export interface PlatformTenantsPage {
  items: PlatformTenantOption[];
  /** Cursor assinado (opaco) da próxima página; null = fim. */
  nextCursor: string | null;
}

export interface PlatformContactDetail {
  contactId: string;
  links: PlatformContactLink[];
}

/** Filtros da tela (estado de interface). Período em `YYYY-MM-DD` do fuso local; vazio = sem filtro. */
export interface PlatformContactFilters {
  search: string;
  tenantId: string;
  from: string;
  to: string;
  /** Código do país (só dígitos, código inteiro); vazio = todos. */
  ddi: string;
  /** Código de área do Brasil (2 dígitos); só com `ddi = 55`. */
  ddd: string;
}

export const EMPTY_PLATFORM_FILTERS: PlatformContactFilters = { search: '', tenantId: '', from: '', to: '', ddi: '', ddd: '' };

/** `GET /admin/saver/contacts/summary`: só contagens agregadas (nenhum dado de contato). */
export interface PlatformContactsSummary {
  /** Contatos da base inteira, sem filtro. */
  total: number;
  /** Os que casam com os filtros atuais. */
  filtered: number;
  withPhone: number;
  lidOnly: number;
  /** Ranking de países de todos os filtros menos o de DDI/DDD (a barra do país filtrado segue junto das outras). */
  topDdi: { ddi: string; count: number }[];
  /** Só vem preenchido com o filtro `ddi = 55`; ignora o filtro de DDD. */
  topDdd: { ddd: string; count: number }[];
  /** Total do universo de cada ranking (base das porcentagens das barras). */
  ddiBase: number;
  dddBase: number;
}

export interface PlatformContactsFile {
  blob: Blob;
  filename: string;
}
