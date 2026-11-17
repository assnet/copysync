/**
 * Contrato do painel com a API do Saver (`.specs/features/saver/design.md` §4.5; DTOs em
 * `api/src/modules/saver/application/use-cases/`). Datas chegam em ISO. Nenhum tipo aqui carrega
 * linha de contato: o tenant só vê contagens e o arquivo exportado.
 */

export type SaverExtractionStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'PARTIAL' | 'FAILED' | 'CANCELLED';
export type SaverExtractionItemStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';
export type SaverExportFormat = 'CSV' | 'VCARD';
export type SaverAction = 'view' | 'extract' | 'export' | 'configure';
export type SaverPermissionSet = Record<SaverAction, boolean>;
export type SaverRole = 'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR';

/** Uso × limite; `limit`/`remaining` `null` = ilimitado. */
export interface SaverUsage {
  used: number;
  limit: number | null;
  remaining: number | null;
}

export interface SaverConfig {
  namePrefix: string | null;
  excludeAdminsByDefault: boolean;
  defaultFormat: SaverExportFormat;
  autoRefresh: boolean;
}

/** `GET /saver/overview`. */
export interface SaverOverview {
  groups: SaverUsage;
  contacts: SaverUsage;
  /** Leituras de grupo nas últimas 24 h corridas. */
  groupScansPerDay: SaverUsage;
  autoRefreshEnabled: boolean;
  /** Permissões efetivas do usuário: o painel não recalcula regra. */
  permissions: SaverPermissionSet;
  config: SaverConfig;
  /** `false` = fila parada neste ambiente. */
  queueRunning: boolean;
}

/** `GET /saver/sessions/:sessionId/groups`: grupos ao vivo da sessão. */
export interface SaverSessionGroup {
  groupJid: string;
  name: string | null;
  saved: boolean;
  savedGroupId: string | null;
  lastScannedAt: string | null;
  lastScanStatus: SaverExtractionItemStatus | null;
}

/** `GET /saver/groups`: grupos salvos com contagens. */
export interface SaverGroup {
  id: string;
  groupJid: string;
  name: string;
  sessionId: string | null;
  memberCount: number;
  phoneCount: number;
  lidOnlyCount: number;
  lastScannedAt: string | null;
  lastScanStatus: SaverExtractionItemStatus | null;
  createdAt: string;
}

/** Progresso de uma extração (só contagens). */
export interface SaverExtraction {
  id: string;
  sessionId: string | null;
  trigger: 'MANUAL' | 'AUTO';
  status: SaverExtractionStatus;
  totalGroups: number;
  doneGroups: number;
  failedGroups: number;
  membersFound: number;
  newContacts: number;
  createdAt: string;
  finishedAt: string | null;
}

export interface RequestSaverExtractionInput {
  sessionId: string;
  /** 1–50 por pedido. */
  groupJids: string[];
}

export type UpdateSaverConfigInput = Partial<SaverConfig>;

/** `GET`/`PUT /saver/config`: a configuração com o que o plano permite e se já foi gravada. */
export interface SaverConfigDetails extends SaverConfig {
  /** O plano inclui a atualização diária. */
  autoRefreshAvailable: boolean;
  /** `false` = ainda nos padrões (nunca gravada). */
  configured: boolean;
  updatedAt: string | null;
}

/** `GET /saver/permissions`: operadores do tenant e a liberação de exportar. */
export interface SaverExportGrant {
  userId: string;
  name: string;
  email: string;
  canExport: boolean;
}

/** `PUT /saver/permissions/:userId`. */
export interface SaverExportGrantUpdate {
  userId: string;
  canExport: boolean;
}

export interface SaverExportOptions {
  /** Prefixo do nome (até 40 caracteres). */
  prefix?: string | null;
  excludeAdmins?: boolean;
  /** Só quem ainda está no grupo. */
  onlyActive?: boolean;
  /** Uma linha por contato e grupo (CSV ganha a coluna `Grupo`). */
  onePerGroup?: boolean;
  onlyWithPhone?: boolean;
}

/** `POST /saver/exports`. */
export interface SaverExportInput {
  format: SaverExportFormat;
  groupIds: string[] | 'all';
  options?: SaverExportOptions;
}

/** Arquivo pronto para o download por `Blob`. */
export interface SaverExportFile {
  blob: Blob;
  filename: string;
}

/** `GET /saver/access`: o Saver aparece no menu deste usuário? */
export interface SaverAccess {
  visible: boolean;
}

/** Status de extração ainda ativa (a tela segue consultando). */
export const ACTIVE_EXTRACTION_STATUSES: readonly SaverExtractionStatus[] = ['QUEUED', 'RUNNING'];

export function isExtractionActive(status: SaverExtractionStatus): boolean {
  return ACTIVE_EXTRACTION_STATUSES.includes(status);
}
