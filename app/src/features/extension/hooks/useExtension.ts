import { useState, useEffect, useCallback, useRef } from 'react';
import { sendOp, detectExtension, isExtensionApiAvailable, getCachedExtId, clearCachedExtId } from '../channel/client';
import { extensionApi, type MlCredentialStatus } from '../services/extensionApi';
import type { HandshakePayload, MlStatusPayload, MlSyncSessionPayload, ChannelError } from '../contract/channel';
import { extensionStrings } from '../strings';

export class ExtensionSyncError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ExtensionSyncError';
  }
}

export function syncErrorMessage(error: unknown): string {
  const code = error instanceof ExtensionSyncError ? error.code : '';
  if (code === 'forbidden' || code === 'FORBIDDEN') return extensionStrings.errors.forbidden;
  if (code === 'NEEDS_LOGIN' || code === 'session_expired') return extensionStrings.errors.needsLogin;
  return extensionStrings.errors.syncFailed;
}

export type ExtensionStatus =
  | 'unavailable'
  | 'not_detected'
  | 'detected'
  | 'connected'
  | 'error';

export interface ExtensionState {
  status: ExtensionStatus;
  handshake: HandshakePayload | null;
  mlStatus: MlStatusPayload | null;
  mlCredential: MlCredentialStatus | null;
  error: ChannelError | null;
  loading: boolean;
}

const INITIAL: ExtensionState = {
  status: 'unavailable',
  handshake: null,
  mlStatus: null,
  mlCredential: null,
  error: null,
  loading: true,
};

export function useExtension() {
  const [state, setState] = useState<ExtensionState>(INITIAL);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!isExtensionApiAvailable()) {
      setState({ ...INITIAL, status: 'unavailable', loading: false });
      return;
    }

    setState(prev => ({ ...prev, loading: true }));

    const detected = await detectExtension();
    if (!detected) {
      setState({ ...INITIAL, status: 'not_detected', loading: false });
      return;
    }

    const hsResult = await sendOp('handshake');
    if (!hsResult.ok) {
      setState({ ...INITIAL, status: 'error', error: hsResult.error, loading: false });
      return;
    }

    const handshake = (hsResult as { ok: true; payload: HandshakePayload }).payload;
    const isConnected = handshake.authenticated;

    let mlStatus: MlStatusPayload | null = null;
    if (isConnected) {
      const mlResult = await sendOp('ml.status');
      if (mlResult.ok) {
        mlStatus = (mlResult as { ok: true; payload: MlStatusPayload }).payload;
      }
    }

    let mlCredential: MlCredentialStatus | null = null;
    if (isConnected) {
      mlCredential = await extensionApi.getMlCredentialStatus();
    }

    if (!mountedRef.current) return;
    setState({
      status: isConnected ? 'connected' : 'detected',
      handshake,
      mlStatus,
      mlCredential,
      error: null,
      loading: false,
    });
  }, []);

  const connect = useCallback(async (installationId: string, extVersion: string, consent: boolean) => {
    const extensionId = getCachedExtId() ?? '';
    await extensionApi.issueSession({ installationId, extVersion, extensionId, channel: 'cs-ext', mlSessionConsent: consent });
    await sendOp('session.changed', {});
    await refresh();
  }, [refresh]);

  const installationId = state.handshake?.installationId;
  const syncMl = useCallback(async () => {
    // Clicking sync is explicit consent; also restores it after "Desconectar Mercado Livre".
    if (installationId) await extensionApi.grantMlConsent(installationId);
    const result = await sendOp('ml.syncSession');
    await refresh();
    if (!result.ok) throw new ExtensionSyncError(result.error.code);
    const payload = (result as { ok: true; payload: MlSyncSessionPayload }).payload;
    if (payload.result === 'FAILED') throw new ExtensionSyncError(payload.errorCode ?? 'unknown');
    return payload;
  }, [refresh, installationId]);

  const disconnectMl = useCallback(async () => {
    await extensionApi.disconnectMl();
    await refresh();
  }, [refresh]);

  const revokeSession = useCallback(async () => {
    await extensionApi.revokeSession();
    await sendOp('session.changed', {});
    clearCachedExtId();
    await refresh();
  }, [refresh]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => { mountedRef.current = false; };
  }, [refresh]);

  return { ...state, refresh, connect, syncMl, disconnectMl, revokeSession };
}
