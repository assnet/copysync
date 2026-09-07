import { EventEmitter } from 'events';
import type { InternalMessagingEvent } from './InternalMessagingEvent';

/**
 * Typed internal event bus.
 *
 * All messaging engine adapters emit events through this bus,
 * translated into InternalMessagingEvent shapes.
 * No raw engine-specific events should cross this boundary.
 */
class InternalEventBus extends EventEmitter {
  emit<T extends InternalMessagingEvent>(eventType: T['type'], payload: T): boolean {
    return super.emit(eventType, payload);
  }

  on<T extends InternalMessagingEvent>(
    eventType: T['type'],
    listener: (payload: T) => void,
  ): this {
    return super.on(eventType, listener as (...args: unknown[]) => void);
  }

  once<T extends InternalMessagingEvent>(
    eventType: T['type'],
    listener: (payload: T) => void,
  ): this {
    return super.once(eventType, listener as (...args: unknown[]) => void);
  }

  off<T extends InternalMessagingEvent>(
    eventType: T['type'],
    listener: (payload: T) => void,
  ): this {
    return super.off(eventType, listener as (...args: unknown[]) => void);
  }
}

// Singleton — one bus shared across the whole process
export const internalEventBus = new InternalEventBus();

// Prevent memory leak warnings for large apps with many listeners
internalEventBus.setMaxListeners(50);
