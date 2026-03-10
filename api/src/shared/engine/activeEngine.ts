import type { IMessagingEngine } from '../../modules/messaging/domain/contracts/IMessagingEngine';

/**
 * Module-level store for the active IMessagingEngine instance.
 *
 * Set once at startup (session.routes.ts) so that other modules (e.g. chat
 * routes) can access the engine without creating circular imports or coupling
 * to a concrete implementation.
 */
let _engine: IMessagingEngine | null = null;

export function setActiveEngine(engine: IMessagingEngine): void {
  _engine = engine;
}

export function getActiveEngine(): IMessagingEngine | null {
  return _engine;
}
