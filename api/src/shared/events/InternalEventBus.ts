import { EventEmitter } from 'events';
import type { InternalMessagingEvent } from './InternalMessagingEvent';
import type { InternalTeamEvent } from './InternalTeamEvent';

export type InternalEvent = InternalMessagingEvent | InternalTeamEvent;

class InternalEventBus extends EventEmitter {
  emit<T extends InternalEvent>(eventType: T['type'], payload: T): boolean {
    return super.emit(eventType, payload);
  }

  on<T extends InternalEvent>(
    eventType: T['type'],
    listener: (payload: T) => void,
  ): this {
    return super.on(eventType, listener as (...args: unknown[]) => void);
  }

  once<T extends InternalEvent>(
    eventType: T['type'],
    listener: (payload: T) => void,
  ): this {
    return super.once(eventType, listener as (...args: unknown[]) => void);
  }

  off<T extends InternalEvent>(
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
