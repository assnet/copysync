import type { SessionStatus } from '../enums/SessionStatus';

export interface SessionProps {
  id: string;
  tenantId: string;
  name: string;
  engine: string;
  phone: string | null;
  externalRef: string | null;
  status: SessionStatus;
  lastConnectedAt: Date | null;
  lastDisconnectedAt: Date | null;
  lastSeenAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Session domain entity — pure, no Prisma or engine dependency.
 */
export class Session {
  public readonly id: string;
  public readonly tenantId: string;
  public readonly name: string;
  public readonly engine: string;
  public readonly phone: string | null;
  public readonly externalRef: string | null;
  public readonly status: SessionStatus;
  public readonly lastConnectedAt: Date | null;
  public readonly lastDisconnectedAt: Date | null;
  public readonly lastSeenAt: Date | null;
  public readonly deletedAt: Date | null;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  constructor(props: SessionProps) {
    this.id = props.id;
    this.tenantId = props.tenantId;
    this.name = props.name;
    this.engine = props.engine;
    this.phone = props.phone;
    this.externalRef = props.externalRef;
    this.status = props.status;
    this.lastConnectedAt = props.lastConnectedAt;
    this.lastDisconnectedAt = props.lastDisconnectedAt;
    this.lastSeenAt = props.lastSeenAt;
    this.deletedAt = props.deletedAt;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  isConnected(): boolean {
    return this.status === 'CONNECTED';
  }

  /** Can initiate a first connection attempt. */
  canConnect(): boolean {
    return (
      this.status === 'PENDING' ||
      this.status === 'DISCONNECTED' ||
      this.status === 'FAILED'
    );
  }

  /** Can accept a disconnect request. */
  canDisconnect(): boolean {
    return this.status === 'CONNECTED' || this.status === 'CONNECTING';
  }

  /** Can accept a reconnect request. */
  canReconnect(): boolean {
    return (
      this.status === 'DISCONNECTED' ||
      this.status === 'FAILED' ||
      this.status === 'LOGGED_OUT'
    );
  }

  isDeleted(): boolean {
    return this.deletedAt !== null;
  }
}
