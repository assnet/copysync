/** Espelho TS dos status do Saver (design.md §3). Valores idênticos aos gravados no banco (colunas texto). */

export enum SaverExtractionStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  DONE = 'DONE',
  PARTIAL = 'PARTIAL',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum SaverExtractionItemStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  DONE = 'DONE',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/** Itens que ainda ocupam a fila (índice único parcial por grupo, SAVER-10). */
export const PENDING_ITEM_STATUSES: readonly SaverExtractionItemStatus[] = [
  SaverExtractionItemStatus.QUEUED,
  SaverExtractionItemStatus.RUNNING,
];

export enum SaverExtractionTrigger {
  MANUAL = 'MANUAL',
  AUTO = 'AUTO',
}

export enum SaverExportFormat {
  CSV = 'CSV',
  VCARD = 'VCARD',
}
