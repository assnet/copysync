import { AppError } from '../AppError';

// ── Saver: exportação e base da plataforma (docs: .specs/features/saver) ─────

/** Nada a exportar nos filtros (vCard: nenhum contato com número). Sai antes do primeiro byte. */
export class SaverExportEmptyError extends AppError {
  constructor(format: string) {
    super('SAVER_EXPORT_EMPTY', 'No contacts match the export filters', 422, { format });
  }
}

/** Cursor da base da plataforma inválido, vencido ou de outro filtro: 400, o painel recomeça da 1ª página. */
export class SaverCursorInvalidError extends AppError {
  constructor() {
    super('SAVER_CURSOR_INVALID', 'Page cursor is invalid or expired, reload the list', 400, { field: 'cursor' });
  }
}

/** Audiência do Saver (flag "Só super admin", `SAVER_AUDIENCE` só valor inicial): fora da prévia. Depois do gate de produto. */
export class SaverUnavailableError extends AppError {
  constructor() {
    super('SAVER_UNAVAILABLE', 'Saver is not available for this account', 403);
  }
}
