export type TenantStatus = 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';

export interface TenantProps {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  billingCustomerId: string | null;
  planSlug: string | null;
  lastBillingEventSeq: number | null;
  suspendedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class Tenant {
  public readonly id: string;
  public readonly name: string;
  public readonly slug: string;
  public readonly status: TenantStatus;
  public readonly billingCustomerId: string | null;
  public readonly planSlug: string | null;
  public readonly lastBillingEventSeq: number | null;
  public readonly suspendedAt: Date | null;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  constructor(props: TenantProps) {
    this.id = props.id;
    this.name = props.name;
    this.slug = props.slug;
    this.status = props.status;
    this.billingCustomerId = props.billingCustomerId;
    this.planSlug = props.planSlug;
    this.lastBillingEventSeq = props.lastBillingEventSeq;
    this.suspendedAt = props.suspendedAt;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  isActive(): boolean {
    return this.status === 'ACTIVE';
  }

  isSuspended(): boolean {
    return this.status === 'SUSPENDED' || this.status === 'CANCELLED';
  }
}
