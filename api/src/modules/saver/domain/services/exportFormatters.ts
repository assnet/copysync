/**
 * Formatadores de exportação do Saver (SAVER-25..29; design.md §4.2). Funções puras, uma linha por vez,
 * para servir ao stream. CSV: UTF-8 com BOM, RFC 4180 (CRLF), fórmula neutralizada. vCard 3.0: um cartão
 * por contato com número; só-LID fica fora. Data e hora em `America/Sao_Paulo` (`Tenant` não tem fuso).
 */

export const SAVER_EXPORT_TIME_ZONE = 'America/Sao_Paulo';
export const CSV_BOM = '\uFEFF';
const CRLF = '\r\n';

/** Linha do tenant: nome do VÍNCULO (nunca o do contato global), `phone`/`lid` do contato. */
export interface SaverExportRow {
  name: string | null;
  phone: string | null;
  lid: string | null;
  isAdmin: boolean;
  /** Ainda está no grupo (vínculo sem `leftAt`). */
  active: boolean;
  /** Data e hora da última extração deste contato pelo tenant. */
  extractedAt: Date;
  /** Só com "uma linha por grupo". */
  groupName?: string | null;
}

export interface SaverExportOptions {
  prefix?: string | null;
  excludeAdmins?: boolean;
  onlyWithPhone?: boolean;
  onlyActive?: boolean;
  onePerGroup?: boolean;
}

/** Linha que passou nos filtros, com o prefixo já resolvido. */
export interface SaverExportLine extends SaverExportRow {
  prefix: string;
}

/** Linha da base da plataforma (super admin). */
export interface PlatformSaverExportRow {
  name: string | null;
  phone: string | null;
  lid: string | null;
  firstExtractedAt: Date | null;
  lastExtractedAt: Date | null;
  tenantCount: number;
  groupCount: number;
}

const TENANT_COLUMNS = ['Nome', 'Telefone', 'LID', 'Extraído em'] as const;
const PLATFORM_COLUMNS = ['Nome', 'Telefone', 'LID', 'Primeira extração', 'Última extração', 'Tenants', 'Grupos'] as const;

/** Prefixa com `'` valor iniciado por `=`, `+`, `-`, `@`, tab ou CR (injeção de fórmula em planilha). */
export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvField(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const safe = neutralizeFormula(value);
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function csvRow(fields: readonly (string | null | undefined)[]): string {
  return fields.map(csvField).join(',') + CRLF;
}

const dateTimeFormat = new Intl.DateTimeFormat('pt-BR', {
  timeZone: SAVER_EXPORT_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** `dd/MM/aaaa HH:mm` em `America/Sao_Paulo`. */
export function formatCapturedAt(date: Date): string {
  const parts: Record<string, string> = {};
  for (const p of dateTimeFormat.formatToParts(date)) parts[p.type] = p.value;
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

/** Cabeçalho do CSV do tenant (com BOM). `Grupo` só com "uma linha por grupo". */
export function csvHeader(opts: Pick<SaverExportOptions, 'onePerGroup'> = {}): string {
  return CSV_BOM + csvRow(opts.onePerGroup ? [...TENANT_COLUMNS, 'Grupo'] : TENANT_COLUMNS);
}

export function platformCsvHeader(): string {
  return CSV_BOM + csvRow(PLATFORM_COLUMNS);
}

function joinName(prefix: string, name: string | null): string | null {
  if (prefix && name) return `${prefix} ${name}`;
  return prefix || name || null;
}

/** Aplica filtros e prefixo; `null` = linha fora. */
export function applyExportOptions(row: SaverExportRow, opts: SaverExportOptions = {}): SaverExportLine | null {
  if (opts.excludeAdmins && row.isAdmin) return null;
  if (opts.onlyWithPhone && !row.phone) return null;
  if (opts.onlyActive && !row.active) return null;
  if (!row.phone && !row.lid) return null;
  return { ...row, name: row.name?.trim() || null, prefix: opts.prefix?.trim() ?? '' };
}

/** Linha CSV do tenant. Sem nome: só o prefixo (ou vazio). Só-LID entra com telefone vazio. */
export function toCsvLine(line: SaverExportLine, opts: Pick<SaverExportOptions, 'onePerGroup'> = {}): string {
  const fields: (string | null)[] = [
    joinName(line.prefix, line.name),
    line.phone,
    line.lid,
    formatCapturedAt(line.extractedAt),
  ];
  if (opts.onePerGroup) fields.push(line.groupName ?? null);
  return csvRow(fields);
}

export function toPlatformCsvLine(row: PlatformSaverExportRow): string {
  return csvRow([
    row.name,
    row.phone,
    row.lid,
    row.firstExtractedAt ? formatCapturedAt(row.firstExtractedAt) : null,
    row.lastExtractedAt ? formatCapturedAt(row.lastExtractedAt) : null,
    String(row.tenantCount),
    String(row.groupCount),
  ]);
}

function vCardText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/([,;])/g, '\\$1');
}

/**
 * Cartão vCard 3.0 (sem cabeçalho de arquivo, sem campo vazio). Sem telefone = `null` (só-LID fica fora).
 * Sem nome: prefixo + número com `+`.
 */
export function toVCardEntry(line: SaverExportLine): string | null {
  if (!line.phone) return null;
  const tel = `+${line.phone}`;
  const display = vCardText(joinName(line.prefix, line.name ?? tel) ?? tel);
  return ['BEGIN:VCARD', 'VERSION:3.0', `FN:${display}`, `N:;${display};;;`, `TEL;TYPE=CELL:${tel}`, 'END:VCARD'].join(CRLF) + CRLF;
}
