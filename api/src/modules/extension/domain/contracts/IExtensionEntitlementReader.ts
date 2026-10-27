export interface IExtensionEntitlementReader {
  hasMarketplaceExtension(tenantId: string): Promise<boolean>;
}
