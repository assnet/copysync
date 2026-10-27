export type ExtensionInstallationStatus = 'ACTIVE' | 'UNINSTALLED' | 'INFERRED_GONE' | 'REPLACED';

export interface ExtensionInstallation {
  installationId: string;
  extensionId: string;
  channel: string;
  deviceId: string | null;
  userId: string | null;
  version: string;
  status: ExtensionInstallationStatus;
  firstSeenAt: Date;
  installedAt: Date | null;
  lastSeenAt: Date;
  lastHeartbeatAt: Date | null;
  lastSiteSeenAt: Date | null;
  uninstalledAt: Date | null;
  previousInstallationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
