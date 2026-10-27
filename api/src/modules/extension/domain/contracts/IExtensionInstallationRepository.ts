import type { ExtensionInstallation, ExtensionInstallationStatus } from '../entities/ExtensionInstallation';

export interface UpsertExtensionInstallationInput {
  installationId: string;
  extensionId: string;
  channel: string;
  deviceId?: string | null;
  userId?: string | null;
  version: string;
}

export interface IExtensionInstallationRepository {
  findById(installationId: string): Promise<ExtensionInstallation | null>;
  findByDeviceAndExtension(deviceId: string, extensionId: string): Promise<ExtensionInstallation[]>;
  upsert(input: UpsertExtensionInstallationInput): Promise<ExtensionInstallation>;
  updateStatus(installationId: string, status: ExtensionInstallationStatus): Promise<void>;
  updateLastSeen(installationId: string, fields: { lastSeenAt?: Date; lastHeartbeatAt?: Date; lastSiteSeenAt?: Date; version?: string }): Promise<void>;
  markReplaced(installationId: string, replacedByInstallationId: string): Promise<void>;
}
