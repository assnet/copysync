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
}

export const EMPTY_PLATFORM_FILTERS: PlatformContactFilters = { search: '', tenantId: '', from: '', to: '' };

export interface PlatformContactsFile {
  blob: Blob;
  filename: string;
}
