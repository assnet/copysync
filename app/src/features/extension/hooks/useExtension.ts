import { useState, useEffect, useCallback, useRef } from 'react';
import { sendOp, detectExtension, isExtensionApiAvailable, getCachedExtId, clearCachedExtId } from '../channel/client';
import { extensionApi, type MlCredentialStatus } from '../services/extensionApi';
import type { HandshakePayload, MlStatusPayload, MlSyncSessionPayload, ChannelError } from '../contract/channel';
import { extensionStrings } from '../strings';
import { serverNow } from '@/services/serverClock';

export class ExtensionSyncError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ExtensionSyncError';
  }
}

/** Código da extensão (`SyncErrorCode`) ou do painel → mensagem. Só `ml_not_logged` fala de login no ML. */
const SYNC_ERROR_MESSAGES: Record<string, string> = {
  forbidden: extensionStrings.errors.forbidden,
  FORBIDDEN: extensionStrings.errors.forbidden,
  NEEDS_LOGIN: extensionStrings.errors.needsLogin,
  session_expired: extensionStrings.errors.needsLogin,
  plan_unavailable: extensionStrings.errors.planRequired,
  consent_required: extensionStrings.errors.consentRequired,
  ml_not_logged: extensionStrings.errors.mlNotLogged,
  ml_account_mismatch: extensionStrings.errors.mlAccountMismatch,
  ml_session_rejected: extensionStrings.errors.mlSessionRejected,
  api_unreachable: extensionStrings.errors.apiUnreachable,
  rate_limited: extensionStrings.errors.rateLimited,
};

export function syncErrorMessage(error: unknown): string {
  const code = error instanceof ExtensionSyncError ? error.code : '';
  return SYNC_ERROR_MESSAGES[code] ?? extensionStrings.errors.syncFailed;
}

/** Folga entre o clique e o `sessionSyncedAt` do servidor (relógio do servidor dos dois lados). */
const SYNC_SAVED_TOLERANCE_MS = 5_000;

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

    // undefined = falha ao consultar: mantém o último valor em vez de mostrar "não sincronizada"
    let mlCredential: MlCredentialStatus | null | undefined = null;
    if (isConnected) {
      mlCredential = await extensionApi.getMlCredentialStatus().catch(() => undefined);
    }

    if (!mountedRef.current) return mlCredential;
    setState(prev => ({
      status: isConnected ? 'connected' : 'detected',
      handshake,
      mlStatus,
      mlCredential: mlCredential === undefined ? prev.mlCredential : mlCredential,
      error: null,
      loading: false,
    }));
    return mlCredential;
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
    const startedAt = serverNow();
    const result = await sendOp('ml.syncSession');
    const cred = await refresh();
    if (!result.ok) throw new ExtensionSyncError(result.error.code);
    const payload = (result as { ok: true; payload: MlSyncSessionPayload }).payload;
    // A extensão pode desistir (timeout) depois de o servidor já ter gravado: vale o que está salvo
    const savedNow = !!cred?.lastSyncAt
      && new Date(cred.lastSyncAt).getTime() >= startedAt - SYNC_SAVED_TOLERANCE_MS;
    if (payload.result === 'FAILED' && !savedNow) throw new ExtensionSyncError(payload.errorCode ?? 'unknown');
    // Sessão gravada, mas a loja recusou no servidor: monitoramento segue pausado
    if (savedNow && cred?.rejectedAt) throw new ExtensionSyncError('ml_session_rejected');
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
