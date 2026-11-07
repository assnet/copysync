import type { OpName, OpMap, ChannelResponse } from '../../contract/channel.js';
import { CHANNEL_VERSION } from '../constants.js';
import type { ExtensionProfile } from '../sessionResolver.js';
import { invalidarSessao, getCachedProfile } from '../sessionResolver.js';
import { ensureInstallation, setInstallation, getSyncState, type InstallationState } from '../store.js';
import { setupUninstallUrl } from '../lifecycle.js';
import { getMlStatus } from '../marketplaceSession.js';
import { runSync } from '../syncSession.js';

type HandlerFn<Op extends OpName> = (
  payload: OpMap[Op]['request'],
  profile: ExtensionProfile | null,
) => Promise<ChannelResponse<OpMap[Op]['response']>>;

const handshake: HandlerFn<'handshake'> = async (_payload, profile) => {
  // Mesmo installationId do onInstalled/boot; linkedAt marca o primeiro contato com o painel.
  let installation = await ensureInstallation();
  if (!installation.linkedAt) {
    installation = { ...installation, linkedAt: new Date().toISOString() };
    await setInstallation(installation);
  }
  return {
    ok: true,
    payload: {
      extVersion: chrome.runtime.getManifest().version,
      contractVersion: CHANNEL_VERSION,
      caps: ['ml.session'],
      authenticated: !!profile?.user?.id,
      userId: profile?.user?.id || undefined,
      installationId: installation.installationId,
    },
  };
};

const bridgeIdentify: HandlerFn<'bridge.identify'> = async (payload, _profile) => {
  const state: InstallationState = {
    installationId: payload.installationId,
    extensionId: payload.extensionId,
    linkedAt: new Date().toISOString(),
  };
  await setInstallation(state);
  void setupUninstallUrl();
  return { ok: true, payload: {} };
};

const sessionChanged: HandlerFn<'session.changed'> = async (_payload, _profile) => {
  invalidarSessao();
  return { ok: true, payload: {} };
};

const mlStatus: HandlerFn<'ml.status'> = async (_payload, _profile) => {
  const status = await getMlStatus();
  return { ok: true, payload: status };
};

const mlSyncSession: HandlerFn<'ml.syncSession'> = async (_payload, _profile) => {
  const state = await runSync('channel');
  if (state.status === 'error') {
    return { ok: true, payload: { result: 'FAILED', errorCode: state.lastErrorCode } };
  }
  return { ok: true, payload: { result: state.status === 'ok' ? 'UPDATED' : 'UNCHANGED' } };
};

const handlers: Record<OpName, HandlerFn<any>> = {
  'handshake': handshake,
  'bridge.identify': bridgeIdentify,
  'session.changed': sessionChanged,
  'ml.status': mlStatus,
  'ml.syncSession': mlSyncSession,
};

export const getHandler = (op: string): HandlerFn<any> | undefined =>
  handlers[op as OpName];
