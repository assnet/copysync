export type TenantStatus = 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';

export interface TenantProps {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Tenant domain entity — pure, no Prisma dependency.
 */
export class Tenant {
  public readonly id: string;
  public readonly name: string;
  public readonly slug: string;
  public readonly status: TenantStatus;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  constructor(props: TenantProps) {
    this.id = props.id;
    this.name = props.name;
    this.slug = props.slug;
    this.status = props.status;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  isActive(): boolean {
    return this.status === 'ACTIVE';
  }
}
