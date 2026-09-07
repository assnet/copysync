export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR';

export interface UserProps {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  isSuperAdmin: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * User domain entity — pure, no Prisma dependency.
 */
export class User {
  public readonly id: string;
  public readonly email: string;
  public readonly passwordHash: string;
  public readonly name: string;
  public readonly isSuperAdmin: boolean;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  constructor(props: UserProps) {
    this.id = props.id;
    this.email = props.email;
    this.passwordHash = props.passwordHash;
    this.name = props.name;
    this.isSuperAdmin = props.isSuperAdmin;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }
}
