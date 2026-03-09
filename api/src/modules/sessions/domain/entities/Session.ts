import type { SessionStatus } from '../enums/SessionStatus';

export interface SessionProps {
  id: string;
  tenantId: string;
  name: string;
  phone: string | null;
  status: SessionStatus;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Session domain entity — pure, no Prisma dependency.
 */
export class Session {
  public readonly id: string;
  public readonly tenantId: string;
  public readonly name: string;
  public readonly phone: string | null;
  public readonly status: SessionStatus;
  public readonly lastSeenAt: Date | null;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  constructor(props: SessionProps) {
    this.id = props.id;
    this.tenantId = props.tenantId;
    this.name = props.name;
    this.phone = props.phone;
    this.status = props.status;
    this.lastSeenAt = props.lastSeenAt;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  isConnected(): boolean {
    return this.status === 'CONNECTED';
  }

  canConnect(): boolean {
    return this.status === 'PENDING' || this.status === 'DISCONNECTED' || this.status === 'FAILED';
  }
}
