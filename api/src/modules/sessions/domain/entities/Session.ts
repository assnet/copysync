import type { SessionStatus } from '../enums/SessionStatus';
import { hasPhoneMismatch } from '../services/normalizeBrazilPhone';

export interface SessionProps {
  id: string;
  tenantId: string;
  name: string;
  engine: string;
  phone: string | null;
  /** Número informado pelo operador ao criar (55+DDD+número), comparado com `phone`. */
  declaredPhone: string | null;
  externalRef: string | null;
  status: SessionStatus;
  lastConnectedAt: Date | null;
  lastDisconnectedAt: Date | null;
  lastSeenAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Pedido de conexão vivo (lease/adoção); null = não reconectar. */
  connectRequestedAt?: Date | null;
  /** Validade do lease do socket; null ou passado = sem dono vivo. */
  leaseUntil?: Date | null;
}

/** Status em que a sessão com pedido vivo espera um processo com vaga. */
const AWAITING_CAPACITY_STATUSES: ReadonlySet<SessionStatus> = new Set<SessionStatus>([
  'PENDING',
  'DISCONNECTED',
  'CONNECTING',
  // Socket de login que morreu com o processo (SIGKILL/OOM): sem lease vivo, ninguém o segura.
  'AWAITING_QR',
  'AWAITING_PAIRING',
  'AWAITING_CODE',
  'AWAITING_PASSWORD',
]);

/**
 * Session domain entity — pure, no Prisma or engine dependency.
 */
export class Session {
  public readonly id: string;
  public readonly tenantId: string;
  public readonly name: string;
  public readonly engine: string;
  public readonly phone: string | null;
  public readonly declaredPhone: string | null;
  public readonly externalRef: string | null;
  public readonly status: SessionStatus;
  public readonly lastConnectedAt: Date | null;
  public readonly lastDisconnectedAt: Date | null;
  public readonly lastSeenAt: Date | null;
  public readonly deletedAt: Date | null;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;
  public readonly connectRequestedAt: Date | null;
  public readonly leaseUntil: Date | null;

  constructor(props: SessionProps) {
    this.id = props.id;
    this.tenantId = props.tenantId;
    this.name = props.name;
    this.engine = props.engine;
    this.phone = props.phone;
    this.declaredPhone = props.declaredPhone;
    this.externalRef = props.externalRef;
    this.status = props.status;
    this.lastConnectedAt = props.lastConnectedAt;
    this.lastDisconnectedAt = props.lastDisconnectedAt;
    this.lastSeenAt = props.lastSeenAt;
    this.deletedAt = props.deletedAt;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
    this.connectRequestedAt = props.connectRequestedAt ?? null;
    this.leaseUntil = props.leaseUntil ?? null;
  }

  /** O aparelho conectado não é o número que o operador declarou. */
  hasPhoneMismatch(): boolean {
    return hasPhoneMismatch(this.phone, this.declaredPhone);
  }

  /**
   * Pedido de conexão vivo, nenhum processo com lease vivo e status que ainda não
   * abriu socket útil: a sessão espera vaga (adoção por capacidade).
   */
  isAwaitingCapacity(now: Date): boolean {
    if (this.connectRequestedAt === null) return false;
    if (this.leaseUntil !== null && this.leaseUntil.getTime() > now.getTime()) return false;
    return AWAITING_CAPACITY_STATUSES.has(this.status);
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
    return (
      this.status === 'CONNECTED' ||
      this.status === 'CONNECTING' ||
      this.status === 'AWAITING_QR' ||
      this.status === 'AWAITING_PAIRING' ||
      this.status === 'AWAITING_CODE' ||
      this.status === 'AWAITING_PASSWORD'
    );
  }

  /** Can accept a reconnect request. */
  canReconnect(): boolean {
    return (
      this.status === 'DISCONNECTED' ||
      this.status === 'FAILED' ||
      this.status === 'LOGGED_OUT'
    );
  }

  isTelegram(): boolean {
    return this.engine === 'telegram';
  }

  isDeleted(): boolean {
    return this.deletedAt !== null;
  }
}
