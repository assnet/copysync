import type { OpName, OpMap, ChannelResponse } from '../../contract/channel.js';
import { CHANNEL_VERSION } from '../constants.js';
import type { ExtensionProfile } from '../sessionResolver.js';
import { invalidarSessao, getCachedProfile } from '../sessionResolver.js';
import { getInstallation, setInstallation, getSyncState, type InstallationState } from '../store.js';
import { getMlStatus } from '../marketplaceSession.js';
import { runSync } from '../syncSession.js';

type HandlerFn<Op extends OpName> = (
  payload: OpMap[Op]['request'],
  profile: ExtensionProfile | null,
) => Promise<ChannelResponse<OpMap[Op]['response']>>;

const handshake: HandlerFn<'handshake'> = async (_payload, profile) => {
  const installation = await getInstallation();
  return {
    ok: true,
    payload: {
      extVersion: chrome.runtime.getManifest().version,
      contractVersion: CHANNEL_VERSION,
      caps: ['ml.session'],
      authenticated: !!profile?.user.id,
      userId: profile?.user.id,
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
  const result = state.status === 'ok' ? 'UPDATED' : 'UNCHANGED';
  return { ok: true, payload: { result } };
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
