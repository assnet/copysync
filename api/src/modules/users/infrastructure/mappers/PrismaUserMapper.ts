import type { User as PrismaUser } from '@prisma/client';
import { User } from '../../domain/entities/User';

export class PrismaUserMapper {
  static toDomain(raw: PrismaUser): User {
    return new User({
      id: raw.id,
      email: raw.email,
      passwordHash: raw.passwordHash,
      passwordSetAt: raw.passwordSetAt,
      mustChangePassword: raw.mustChangePassword,
      name: raw.name,
      isSuperAdmin: raw.isSuperAdmin,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }
}
