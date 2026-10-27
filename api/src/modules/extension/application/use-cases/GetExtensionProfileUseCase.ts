import { prisma } from '../../../../shared/database/prisma.client';
import type { IExtensionEntitlementReader } from '../../domain/contracts/IExtensionEntitlementReader';

export interface ExtensionProfileTenant {
  id: string;
  name: string;
  slug: string;
  role: string;
  status: string;
  mlSessionAllowed: boolean;
}

export interface ExtensionProfile {
  id: string;
  name: string;
  email: string;
  tenants: ExtensionProfileTenant[];
}

export class GetExtensionProfileUseCase {
  constructor(
    private readonly entitlementReader: IExtensionEntitlementReader,
  ) {}

  async execute(userId: string): Promise<ExtensionProfile> {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });

    const memberships = await prisma.userTenant.findMany({
      where: { userId },
      include: { tenant: true },
    });

    const tenants: ExtensionProfileTenant[] = [];
    for (const m of memberships) {
      if (m.tenant.status !== 'ACTIVE') continue;
      const mlAllowed = await this.entitlementReader.hasMarketplaceExtension(m.tenantId);
      tenants.push({
        id: m.tenantId,
        name: m.tenant.name,
        slug: m.tenant.slug,
        role: m.role,
        status: m.tenant.status,
        mlSessionAllowed: mlAllowed,
      });
    }

    return { id: user.id, name: user.name, email: user.email, tenants };
  }
}
