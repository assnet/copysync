/**
 * Matriz de permissões do Saver (SAVER-04, SAVER-43; design.md §2.2). Função pura.
 * ADMIN e SUPER_ADMIN: tudo (liberação ignorada). OPERATOR: ver e extrair; exportar só com liberação.
 * Gerenciar liberações é `configure` (só ADMIN).
 */
export type SaverRole = 'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR';

export const SAVER_ACTIONS = ['view', 'extract', 'export', 'configure'] as const;
export type SaverAction = (typeof SAVER_ACTIONS)[number];

/** Liberação individual; hoje só exportar. */
export interface SaverGrants {
  export: boolean;
}

export const NO_SAVER_GRANTS: SaverGrants = Object.freeze({ export: false });

export function canSaver(role: SaverRole, action: SaverAction, grants: SaverGrants = NO_SAVER_GRANTS): boolean {
  if (role === 'ADMIN' || role === 'SUPER_ADMIN') return true;
  if (role !== 'OPERATOR') return false;
  switch (action) {
    case 'view':
    case 'extract':
      return true;
    case 'export':
      return grants.export === true;
    case 'configure':
      return false;
    default:
      return false;
  }
}

export type SaverPermissionSet = Record<SaverAction, boolean>;

/** Permissões efetivas prontas para o painel (`/saver/overview`), sem o painel recalcular regra. */
export function saverPermissionSet(role: SaverRole, grants: SaverGrants = NO_SAVER_GRANTS): SaverPermissionSet {
  return {
    view: canSaver(role, 'view', grants),
    extract: canSaver(role, 'extract', grants),
    export: canSaver(role, 'export', grants),
    configure: canSaver(role, 'configure', grants),
  };
}
