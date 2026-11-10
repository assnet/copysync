import { useState, useEffect, useCallback, useRef } from 'react';
import { sendOp, detectExtension, isExtensionApiAvailable, getCachedExtId, clearCachedExtId } from '../channel/client';
import { extensionApi, type MlCredentialStatus } from '../services/extensionApi';
import type {
  HandshakePayload, MlStatusPayload, MlSyncSessionPayload, ChannelError, SheinStatusPayload, SheinRequestAccessPayload,
} from '../contract/channel';
import { extensionStrings } from '../strings';
import { serverNow } from '@/services/serverClock';

export class ExtensionSyncError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ExtensionSyncError';
  }
}

/** Código da extensão (`SyncErrorCode`) ou do painel → mensagem. Só `ml_not_logged` fala de login no ML; `shein_*` da Shein. */
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
  shein_not_logged: extensionStrings.errors.sheinNotLogged,
  shein_permission_missing: extensionStrings.errors.sheinPermissionMissing,
  shein_sync_failed: extensionStrings.errors.sheinSyncFailed,
  risk_not_accepted: extensionStrings.errors.riskNotAccepted,
};

/** Marketplace da operação: o código é o mesmo, o texto cita a loja certa. */
export type ExtensionMarketplace = 'ml' | 'shein';

const MARKETPLACE_MESSAGES: Record<ExtensionMarketplace, Record<string, string>> = {
  ml: {},
  shein: { consent_required: extensionStrings.errors.consentRequiredShein },
};

export function syncErrorMessage(error: unknown, marketplace: ExtensionMarketplace = 'ml'): string {
  const code = error instanceof ExtensionSyncError ? error.code : '';
  return MARKETPLACE_MESSAGES[marketplace][code] ?? SYNC_ERROR_MESSAGES[code] ?? extensionStrings.errors.syncFailed;
}

/** Folga entre o clique e o `sessionSyncedAt` do servidor (relógio do servidor dos dois lados). */
const SYNC_SAVED_TOLERANCE_MS = 5_000;

export type ExtensionStatus =
  | 'unavailable'
  | 'not_detected'
  | 'detected'
  | 'connected'
  | 'error';

/** Capacidade anunciada no handshake para a sessão Shein (extensão ≥ 3.4.0). */
export const SHEIN_SESSION_CAP = 'shein.session';

/** Operação de sync por marketplace no canal da extensão. */
const SYNC_OP = { ml: 'ml.syncSession', shein: 'shein.syncSession' } as const;

export interface ExtensionState {
  status: ExtensionStatus;
  handshake: HandshakePayload | null;
  mlStatus: MlStatusPayload | null;
  /** Atalho de `credentials.ml` (consumidores antigos). */
  mlCredential: MlCredentialStatus | null;
  sheinStatus: SheinStatusPayload | null;
  /** Credencial por marketplace: o sync de cada loja é julgado pela própria credencial. */
  credentials: Record<ExtensionMarketplace, MlCredentialStatus | null>;
  /** Sobe a cada `refresh()` concluído com handshake (flags locais "até o próximo refresh"). */
  refreshSeq: number;
  error: ChannelError | null;
  loading: boolean;
}

const NO_CREDENTIALS: Record<ExtensionMarketplace, MlCredentialStatus | null> = { ml: null, shein: null };

const INITIAL: ExtensionState = {
  status: 'unavailable',
  handshake: null,
  mlStatus: null,
  mlCredential: null,
  sheinStatus: null,
  credentials: NO_CREDENTIALS,
  refreshSeq: 0,
  error: null,
  loading: true,
};

export function useExtension() {
  const [state, setState] = useState<ExtensionState>(INITIAL);
  const mountedRef = useRef(true);
  /** Guarda de ordem do `refresh()`: só a chamada mais recente grava o estado. */
  const refreshSeqRef = useRef(0);

  const refresh = useCallback(async (): Promise<Record<ExtensionMarketplace, MlCredentialStatus | null> | undefined> => {
    const seq = ++refreshSeqRef.current;
    // Resposta antiga (ex.: refresh em voo antes de `disconnect`) não sobrescreve a mais nova.
    const stale = () => seq !== refreshSeqRef.current || !mountedRef.current;
    if (!isExtensionApiAvailable()) {
      setState(prev => ({ ...INITIAL, status: 'unavailable', loading: false, refreshSeq: prev.refreshSeq }));
      return undefined;
    }

    setState(prev => ({ ...prev, loading: true }));

    const detected = await detectExtension();
    if (stale()) return undefined;
    if (!detected) {
      setState(prev => ({ ...INITIAL, status: 'not_detected', loading: false, refreshSeq: prev.refreshSeq }));
      return undefined;
    }

    const hsResult = await sendOp('handshake');
    if (stale()) return undefined;
    if (!hsResult.ok) {
      setState(prev => ({ ...INITIAL, status: 'error', error: hsResult.error, loading: false, refreshSeq: prev.refreshSeq }));
      return undefined;
    }

    const handshake = (hsResult as { ok: true; payload: HandshakePayload }).payload;
    const isConnected = handshake.authenticated;
    const hasShein = (handshake.caps ?? []).includes(SHEIN_SESSION_CAP);

    let mlStatus: MlStatusPayload | null = null;
    let sheinStatus: SheinStatusPayload | null = null;
    if (isConnected) {
      const mlResult = await sendOp('ml.status');
      if (mlResult.ok) mlStatus = (mlResult as { ok: true; payload: MlStatusPayload }).payload;
      if (hasShein) {
        const sheinResult = await sendOp('shein.status');
        if (sheinResult.ok) sheinStatus = (sheinResult as { ok: true; payload: SheinStatusPayload }).payload;
      }
    }

    // undefined = falha ao consultar: mantém o último valor em vez de mostrar "não sincronizada"
    let credentials: Record<ExtensionMarketplace, MlCredentialStatus | null> | undefined = NO_CREDENTIALS;
    if (isConnected) {
      credentials = await extensionApi.getCredentialStatuses().catch(() => undefined);
    }

    if (stale()) return credentials;
    setState(prev => {
      const nextCreds = credentials ?? prev.credentials;
      return {
        status: isConnected ? 'connected' : 'detected',
        handshake,
        mlStatus,
        sheinStatus,
        credentials: nextCreds,
        mlCredential: nextCreds.ml,
        refreshSeq: prev.refreshSeq + 1,
        error: null,
        loading: false,
      };
    });
    return credentials;
  }, []);

  const connect = useCallback(async (installationId: string, extVersion: string, consent: boolean) => {
    const extensionId = getCachedExtId() ?? '';
    await extensionApi.issueSession({ installationId, extVersion, extensionId, channel: 'cs-ext', mlSessionConsent: consent });
    await sendOp('session.changed', {});
    await refresh();
  }, [refresh]);

  const installationId = state.handshake?.installationId;

  /**
   * Sync do marketplace pela extensão, avaliado pela credencial **desse** marketplace.
   * ML: o clique é consentimento explícito (restaura após "Desconectar"). Shein: consentimento só
   * nasce do "Conectar Shein" (com aceite de risco), nunca aqui.
   */
  const sync = useCallback(async (marketplace: ExtensionMarketplace) => {
    if (marketplace === 'ml' && installationId) await extensionApi.consent('ml', installationId);
    const startedAt = serverNow();
    const result = await sendOp(SYNC_OP[marketplace]);
    const cred = (await refresh())?.[marketplace];
    if (!result.ok) throw new ExtensionSyncError(result.error.code);
    const payload = (result as { ok: true; payload: MlSyncSessionPayload }).payload;
    // A extensão pode desistir (timeout) depois de o servidor já ter gravado: vale o que está salvo
    const savedNow = !!cred?.lastSyncAt
      && new Date(cred.lastSyncAt).getTime() >= startedAt - SYNC_SAVED_TOLERANCE_MS;
    if (payload.result === 'FAILED' && !savedNow) throw new ExtensionSyncError(payload.errorCode ?? 'unknown');
    // Sessão gravada, mas a loja recusou no servidor: monitoramento segue pausado
    if (savedNow && cred?.rejectedAt) {
      throw new ExtensionSyncError(marketplace === 'ml' ? 'ml_session_rejected' : 'shein_sync_failed');
    }
    return payload;
  }, [refresh, installationId]);

  const syncMl = useCallback(() => sync('ml'), [sync]);

  /** Consentimento desta instalação para o marketplace (Shein: só após o aceite do aviso de risco). */
  const consent = useCallback(async (marketplace: ExtensionMarketplace) => {
    if (!installationId) throw new ExtensionSyncError('consent_required');
    await extensionApi.consent(marketplace, installationId);
  }, [installationId]);

  /** Shein: arma o pedido de permissão para o próximo clique no ícone da extensão. */
  const requestAccess = useCallback(async (marketplace: ExtensionMarketplace): Promise<SheinRequestAccessPayload> => {
    if (marketplace !== 'shein') throw new ExtensionSyncError('unknown');
    const result = await sendOp('shein.requestAccess');
    if (!result.ok) throw new ExtensionSyncError(result.error.code);
    return (result as { ok: true; payload: SheinRequestAccessPayload }).payload;
  }, []);

  /** Leitura pontual do estado Shein na extensão (espera pelo clique). `null` = não respondeu. */
  const readSheinStatus = useCallback(async (): Promise<SheinStatusPayload | null> => {
    const result = await sendOp('shein.status');
    return result.ok ? (result as { ok: true; payload: SheinStatusPayload }).payload : null;
  }, []);

  /** Revoga consentimento e apaga a credencial pela rota da extensão (nunca o DELETE genérico). */
  const disconnect = useCallback(async (marketplace: ExtensionMarketplace) => {
    await extensionApi.disconnect(marketplace);
    await refresh();
  }, [refresh]);

  const disconnectMl = useCallback(() => disconnect('ml'), [disconnect]);

  const caps = state.handshake?.caps;
  const supports = useCallback((cap: string) => !!caps?.includes(cap), [caps]);

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

  return {
    ...state,
    refresh, connect, sync, syncMl, consent, requestAccess, readSheinStatus, disconnect, disconnectMl, supports, revokeSession,
  };
}

export type UseExtensionResult = ReturnType<typeof useExtension>;
