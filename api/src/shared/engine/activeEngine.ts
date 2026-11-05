import type { IMessagingEngine } from '../../modules/messaging/domain/contracts/IMessagingEngine';

/**
 * Engine ativa do processo. Definida no boot por `composeForRole(role)` (local em `all`/`worker`,
 * remota em `http`), antes de `buildApp`; rotas e containers leem por `getActiveEngine()`.
 */
let _engine: IMessagingEngine | null = null;

export function setActiveEngine(engine: IMessagingEngine): void {
  _engine = engine;
}

export function getActiveEngine(): IMessagingEngine | null {
  return _engine;
}
