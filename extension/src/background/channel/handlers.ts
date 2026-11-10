import type { OpName, OpMap, ChannelResponse } from '../../contract/channel.js';
import { CHANNEL_VERSION, PENDING_ACCESS_TTL_MS } from '../constants.js';
import type { ExtensionProfile } from '../sessionResolver.js';
import { invalidarSessao, getCachedProfile } from '../sessionResolver.js';
import { ensureInstallation, setInstallation, setPendingAccess, clearPendingAccess, type InstallationState, type SyncState } from '../store.js';
import { setupUninstallUrl } from '../lifecycle.js';
import { getMlStatus, getSheinStatus, hasHostPermission } from '../marketplaceSession.js';
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
      caps: ['ml.session', 'shein.session'],
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

const toSyncPayload = (state: SyncState): ChannelResponse<OpMap['ml.syncSession']['response']> => {
  if (state.status === 'error') {
    return { ok: true, payload: { result: 'FAILED', errorCode: state.lastErrorCode } };
  }
  return { ok: true, payload: { result: state.status === 'ok' ? 'UPDATED' : 'UNCHANGED' } };
};

const mlSyncSession: HandlerFn<'ml.syncSession'> = async (_payload, _profile) =>
  toSyncPayload(await runSync('channel', 'ml'));

const sheinStatus: HandlerFn<'shein.status'> = async (_payload, _profile) =>
  ({ ok: true, payload: await getSheinStatus() });

const sheinSyncSession: HandlerFn<'shein.syncSession'> = async (_payload, _profile) =>
  toSyncPayload(await runSync('channel', 'shein'));

/**
 * `permissions.request` só funciona em gesto do usuário (spike T9): o painel não consegue
 * pedir. Grava a pendência; o próximo clique no ícone (`action.onClicked`) faz o pedido.
 */
const sheinRequestAccess: HandlerFn<'shein.requestAccess'> = async (_payload, _profile) => {
  if (await hasHostPermission('shein')) {
    await clearPendingAccess();
    return { ok: true, payload: { pending: false, until: new Date().toISOString(), permission: 'granted' } };
  }
  const until = Date.now() + PENDING_ACCESS_TTL_MS;
  await setPendingAccess({ marketplace: 'shein', until });
  return { ok: true, payload: { pending: true, until: new Date(until).toISOString(), permission: 'missing' } };
};

const handlers: Record<OpName, HandlerFn<any>> = {
  'handshake': handshake,
  'bridge.identify': bridgeIdentify,
  'session.changed': sessionChanged,
  'ml.status': mlStatus,
  'ml.syncSession': mlSyncSession,
  'shein.status': sheinStatus,
  'shein.syncSession': sheinSyncSession,
  'shein.requestAccess': sheinRequestAccess,
};

export const getHandler = (op: string): HandlerFn<any> | undefined =>
  handlers[op as OpName];
