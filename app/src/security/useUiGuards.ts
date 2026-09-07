import { useEffect } from 'react';
import { installUiGuards } from './uiGuards';
import type { UiGuardOptions } from './uiGuards';

/**
 * Aplica as barreiras de interface enquanto o componente estiver montado.
 *
 * Usado uma vez no layout autenticado: a tela de login não precisa delas, e mantê-las
 * fora dali evita atrapalhar o preenchimento por gerenciadores de senha.
 *
 * Leia o alcance real da proteção em `uiGuards.ts` — ela cria atrito, não uma
 * fronteira de segurança.
 */
export function useUiGuards(options?: UiGuardOptions): void {
  const blockCopy = options?.blockCopy;
  const blockDevTools = options?.blockDevTools;
  const blockContextMenu = options?.blockContextMenu;

  useEffect(() => {
    return installUiGuards({ blockCopy, blockDevTools, blockContextMenu });
  }, [blockCopy, blockDevTools, blockContextMenu]);
}
