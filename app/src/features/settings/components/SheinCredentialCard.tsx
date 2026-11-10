import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, AlertTitle, Box, Button, CircularProgress, Divider, IconButton, Link, Stack, Switch, Tooltip, Typography,
  type ChipProps,
} from '@mui/material';
import {
  CircleCheck, CircleX, Download, Hourglass, Link2, Lock, Plug, RefreshCw, RotateCw, ShieldAlert, Trash2, TriangleAlert,
  Unplug,
} from 'lucide-react';
import { AppIcon, ConfirmDialog } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import { PlanAvailabilityBadges } from '@/features/plans/components/PlanAvailabilityBadges';
import { EXTENSION_STORE_URL } from '@/features/extension/config';
import {
  ExtensionSyncError, SHEIN_SESSION_CAP, syncErrorMessage, type UseExtensionResult,
} from '@/features/extension/hooks/useExtension';
import type { AffiliateCredentialItem, AffiliateCredentialStatus, MarketplaceAvailability } from '@/types/api.types';
import { affiliateCredentialService } from '@/services/affiliateCredential.service';
import type { AffiliateProviderSpec } from '../affiliateProviders';
import { settingsStrings } from '../strings';
import { sheinCardState, showsRiskBanner, type SheinCardState } from '../utils/sheinCardState';
import { AffiliateCardShell } from './AffiliateCardShell';
import { MarketplaceRiskNoticeDialog } from './MarketplaceRiskNoticeDialog';

const ta = settingsStrings.affiliate;
const t = ta.shein;
const tr = ta.riskNotice;

/** Espera pelo clique no ícone: consulta a cada 3 s, no máximo pela janela de 10 min da extensão. */
export const SHEIN_WAIT_POLL_MS = 3_000;
export const SHEIN_WAIT_MAX_MS = 10 * 60_000;

type Flow = 'idle' | 'connecting' | 'waiting';
type DialogMode = 'connect' | 'reaccept' | 'read';
type Notice = { severity: 'success' | 'warning' | 'error'; text: string } | null;

interface Props {
  spec: AffiliateProviderSpec;
  item?: AffiliateCredentialItem;
  availability?: MarketplaceAvailability;
  ext: UseExtensionResult;
  /** Papel ADMIN no tenant ativo: só ele aceita o aviso. */
  canAcceptRisk: boolean;
  busy?: boolean;
  /** Recarrega a lista sem desmontar o card (espera e mensagens seguem na tela). */
  onReload: () => Promise<void>;
  /** Desconectar e lixeira: rota da extensão (`disconnect('shein')`), nunca o DELETE genérico. */
  onDisconnect: () => Promise<void>;
  onStatusChange: (status: AffiliateCredentialStatus) => void;
  /** Abre o assistente de vínculo da extensão (mesmo caminho do Mercado Livre). */
  onOpenLink: () => void;
}

function errorCode(err: unknown): string {
  if (err instanceof ExtensionSyncError) return err.code;
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : '';
}

function stateChip(state: SheinCardState, waiting: boolean, item?: AffiliateCredentialItem): ChipProps {
  if (state === 'locked') return { label: t.chipLocked, color: 'default', variant: 'outlined', icon: <AppIcon icon={Lock} size="sm" /> };
  if (state === 'reaccept') return { label: t.chipReaccept, color: 'warning', icon: <AppIcon icon={ShieldAlert} size="sm" /> };
  if (state === 'rejected') return { label: ta.statusRejected, color: 'error', icon: <AppIcon icon={CircleX} size="sm" /> };
  if (state === 'connected') {
    return item?.status === 'INACTIVE'
      ? { label: ta.statusInactive, color: 'warning', icon: <AppIcon icon={Hourglass} size="sm" /> }
      : { label: ta.statusConfigured, color: 'success', icon: <AppIcon icon={CircleCheck} size="sm" /> };
  }
  if (waiting) return { label: t.chipWaiting, color: 'info', icon: <AppIcon icon={Hourglass} size="sm" /> };
  return { label: ta.statusNotConfigured, color: 'default', variant: 'outlined' };
}

/**
 * Card Shein em `/affiliates/credentials`: 6 estados + reaceite (ver `sheinCardState`), faixa fixa de
 * aviso de risco em todo estado com plano liberado e a conexão em etapas: aceite → `/consent` →
 * `shein.requestAccess` → clique no ícone da extensão (consultado por `shein.status`).
 */
export function SheinCredentialCard({
  spec, item, availability, ext, canAcceptRisk, busy, onReload, onDisconnect, onStatusChange, onOpenLink,
}: Props) {
  const navigate = useNavigate();
  const blurId = useBlur('affiliateCredentials.sessionAffiliateId');
  const [noLinkSeq, setNoLinkSeq] = useState<number | null>(null);
  const [flow, setFlow] = useState<Flow>('idle');
  const [notice, setNotice] = useState<Notice>(null);
  const [dialog, setDialog] = useState<DialogMode | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // Refs: a espera não reinicia a cada render (o objeto `ext` muda sempre).
  const extRef = useRef(ext);
  extRef.current = ext;
  const reloadRef = useRef(onReload);
  reloadRef.current = onReload;
  const deadlineRef = useRef(0);

  const risk = availability?.riskNotice ?? null;
  // Flag do 404 vale até o próximo `refresh()` bem-sucedido da extensão.
  const noLinkFlag = noLinkSeq !== null && noLinkSeq === ext.refreshSeq;
  const state = sheinCardState({
    availability,
    item,
    extStatus: ext.status,
    extLoading: ext.loading,
    supportsShein: ext.supports(SHEIN_SESSION_CAP),
    noLinkFlag,
  });
  const waiting = flow === 'waiting';
  const extReady = ext.status === 'connected' && ext.supports(SHEIN_SESSION_CAP);

  const finishConnected = useCallback(async () => {
    await reloadRef.current();
    setFlow('idle');
    setNotice({ severity: 'success', text: t.syncDone });
  }, []);

  /** Depois do aceite (ou com aceite vigente): consentimento → pedido de acesso → espera pelo clique. */
  const startConsent = useCallback(async () => {
    setFlow('connecting');
    setNotice(null);
    try {
      await extRef.current.consent('shein');
    } catch (err) {
      const code = errorCode(err);
      setFlow('idle');
      if (code === 'SESSION_NOT_FOUND') {
        setNoLinkSeq(extRef.current.refreshSeq);
        setNotice({ severity: 'warning', text: t.noLinkError });
        return;
      }
      setNotice({ severity: 'error', text: t.consentErrors[code] ?? syncErrorMessage(err, 'shein') });
      return;
    }
    try {
      const access = await extRef.current.requestAccess('shein');
      if (access.permission === 'granted') {
        await extRef.current.sync('shein');
        await finishConnected();
        return;
      }
      const until = Date.parse(access.until);
      const max = Date.now() + SHEIN_WAIT_MAX_MS;
      deadlineRef.current = Number.isFinite(until) ? Math.min(until, max) : max;
      setFlow('waiting');
    } catch (err) {
      setFlow('idle');
      setNotice({ severity: 'error', text: syncErrorMessage(err, 'shein') });
    }
  }, [finishConnected]);

  // Espera pelo clique: `setTimeout` encadeado (nunca `setInterval`), para no fim da pendência.
  useEffect(() => {
    if (flow !== 'waiting') return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expire = () => {
      setFlow('idle');
      setNotice({ severity: 'warning', text: t.waitingExpired });
    };
    const tick = async () => {
      const st = await extRef.current.readSheinStatus();
      if (cancelled) return;
      if (st?.permission === 'granted' && !st.pending) {
        if (st.syncStatus === 'ok') {
          await finishConnected();
          void extRef.current.refresh();
          return;
        }
        if (st.syncStatus === 'error') {
          setFlow('idle');
          setNotice({ severity: 'error', text: syncErrorMessage(new ExtensionSyncError(st.errorCode ?? ''), 'shein') });
          return;
        }
      } else if (st && !st.pending && st.permission === 'missing') {
        expire();
        return;
      }
      if (Date.now() >= deadlineRef.current) {
        expire();
        return;
      }
      timer = setTimeout(() => void tick(), SHEIN_WAIT_POLL_MS);
    };
    timer = setTimeout(() => void tick(), SHEIN_WAIT_POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [flow, finishConnected]);

  const handleConnect = () => {
    // Aceite da versão vigente já gravado: pula o diálogo.
    if (risk && !risk.acceptedAt) {
      setAcceptError(null);
      setDialog('connect');
      return;
    }
    void startConsent();
  };

  const handleAccept = async () => {
    const mode = dialog;
    setAccepting(true);
    setAcceptError(null);
    try {
      await affiliateCredentialService.acceptRisk('SHEIN', { noticeVersion: tr.version, locale: tr.locale });
    } catch (err) {
      setAccepting(false);
      if (errorCode(err) === 'MARKETPLACE_RISK_NOTICE_OUTDATED') {
        setAcceptError(tr.outdated);
        void reloadRef.current();
      } else {
        setAcceptError(ta.errors[errorCode(err)] ?? tr.acceptFailed);
      }
      return;
    }
    setAccepting(false);
    setDialog(null);
    await reloadRef.current();
    if (mode === 'connect') await startConsent();
  };

  const handleSync = async () => {
    setSyncing(true);
    setNotice(null);
    try {
      await ext.sync('shein');
      setNotice({ severity: 'success', text: t.syncDone });
    } catch (err) {
      setNotice({ severity: 'error', text: syncErrorMessage(err, 'shein') });
    } finally {
      setSyncing(false);
      await reloadRef.current();
    }
  };

  const handleDisconnect = async () => {
    setConfirmDisconnect(false);
    setDisconnecting(true);
    setNotice(null);
    try {
      await onDisconnect();
    } catch {
      setNotice({ severity: 'error', text: t.disconnectFailed });
    } finally {
      setDisconnecting(false);
    }
  };

  const locked = busy || disconnecting;
  const hasCredential = Boolean(item);
  const affiliateId = item?.publicIdentifier ?? item?.publicIdentifierMasked ?? null;

  return (
    <AffiliateCardShell spec={spec} chip={stateChip(state, waiting, item)} chipMuted={state !== 'connected' && !waiting && !['reaccept', 'rejected'].includes(state)}>
      {showsRiskBanner(state) && (
        <Alert severity="warning" icon={<AppIcon icon={TriangleAlert} size="md" />} sx={{ '& .MuiAlert-message': { width: '100%' } }}>
          <AlertTitle sx={{ fontWeight: 700 }}>{tr.bannerTitle}</AlertTitle>
          <Typography variant="body2">{tr.bannerSummary}</Typography>
          {risk?.acceptedAt && (
            <Typography variant="caption" display="block" sx={{ mt: 0.5, fontWeight: 600 }}>
              {tr.acceptedAt(risk.acceptedAt, risk.acceptedByMe)}
            </Typography>
          )}
          <Tooltip title={tr.readFullTooltip} describeChild>
            <Link
              component="button"
              type="button"
              variant="body2"
              color="inherit"
              underline="always"
              sx={{ mt: 0.75, fontWeight: 600 }}
              onClick={() => { setAcceptError(null); setDialog('read'); }}
            >
              {tr.readFull}
            </Link>
          </Tooltip>
        </Alert>
      )}

      {state === 'locked' && (
        <Stack spacing={1.25} sx={{ p: 1.5, borderRadius: 1, bgcolor: 'action.hover', border: 1, borderColor: 'divider' }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="body2" fontWeight={600}>{t.lockedTitle}</Typography>
            <PlanAvailabilityBadges plans={availability?.plans ?? []} />
          </Stack>
          <Typography variant="body2" color="text.secondary">{t.lockedHint}</Typography>
        </Stack>
      )}

      {state === 'checking' && (
        <Stack direction="row" spacing={1} alignItems="center" aria-live="polite">
          <CircularProgress size={16} />
          <Typography variant="body2" color="text.secondary">{t.checkingExtension}</Typography>
        </Stack>
      )}

      {(state === 'no_extension' || state === 'outdated_extension') && (
        <Alert severity="info" variant="outlined">
          <AlertTitle sx={{ fontWeight: 600 }}>{state === 'no_extension' ? t.noExtensionTitle : t.outdatedTitle}</AlertTitle>
          {state === 'no_extension' ? t.noExtensionHint : t.outdatedHint}
        </Alert>
      )}

      {state === 'no_link' && (
        <Alert severity="info" variant="outlined">
          <AlertTitle sx={{ fontWeight: 600 }}>{t.noLinkTitle}</AlertTitle>
          {t.noLinkHint}
        </Alert>
      )}

      {state === 'ready' && !waiting && (
        <Typography variant="body2" color="text.secondary">{t.readyHint}</Typography>
      )}

      {waiting && (
        <Alert severity="info" icon={<CircularProgress size={18} />} aria-live="polite">
          <AlertTitle sx={{ fontWeight: 600 }}>{t.waitingTitle}</AlertTitle>
          {t.waitingHint}
        </Alert>
      )}

      {state === 'reaccept' && (
        <Alert severity="warning" variant="outlined">
          <AlertTitle sx={{ fontWeight: 600 }}>{t.reacceptTitle}</AlertTitle>
          {t.reacceptHint}
        </Alert>
      )}

      {state === 'rejected' && item?.rejectedAt && (
        <Alert severity="error" variant="outlined">
          {ta.rejectedSince(item.rejectedAt)} {t.rejectedHint}
        </Alert>
      )}

      {hasCredential && state !== 'locked' && (
        <Stack spacing={1} sx={{ p: 1.5, borderRadius: 1, bgcolor: 'action.hover', border: 1, borderColor: 'divider' }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary" display="block">{t.affiliateIdLabel}</Typography>
            <Blurred when={blurId}>
              <Typography
                variant="body2"
                fontWeight={500}
                color={affiliateId ? 'text.primary' : 'text.secondary'}
                sx={{ fontFamily: affiliateId ? 'monospace' : undefined, wordBreak: 'break-all' }}
              >
                {affiliateId ?? t.affiliateIdMissing}
              </Typography>
            </Blurred>
          </Box>
          {item?.sessionSyncedAt && (
            <Typography variant="caption" color="text.secondary">{t.connectedSynced(item.sessionSyncedAt)}</Typography>
          )}
        </Stack>
      )}

      {notice && (
        <Alert severity={notice.severity} onClose={() => setNotice(null)} aria-live="polite">{notice.text}</Alert>
      )}

      <Box sx={{ flexGrow: 1 }} />
      <Divider />

      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} flexWrap="wrap" useFlexGap>
        {state === 'locked' && (
          <Tooltip title={t.lockedTooltip} describeChild>
            <Button variant="contained" fullWidth startIcon={<AppIcon icon={Lock} size="sm" />} onClick={() => navigate('/plans')}>
              {t.lockedAction}
            </Button>
          </Tooltip>
        )}

        {(state === 'no_extension' || state === 'outdated_extension') && (
          <Tooltip title={t.storeTooltip} describeChild>
            <Button
              variant="contained"
              fullWidth
              startIcon={<AppIcon icon={Download} size="sm" />}
              href={EXTENSION_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              {state === 'no_extension' ? t.installAction : t.updateAction}
            </Button>
          </Tooltip>
        )}

        {state === 'no_link' && (
          <>
            <Tooltip title={t.linkTooltip} describeChild>
              <Button variant="contained" startIcon={<AppIcon icon={Link2} size="sm" />} onClick={onOpenLink} disabled={locked}>
                {t.linkAction}
              </Button>
            </Tooltip>
            <Tooltip title={t.recheckTooltip} describeChild>
              <span>
                <Button variant="text" startIcon={<AppIcon icon={RotateCw} size="sm" />} onClick={() => void ext.refresh()} disabled={ext.loading}>
                  {t.recheckAction}
                </Button>
              </span>
            </Tooltip>
          </>
        )}

        {state === 'ready' && (
          waiting ? (
            <Button variant="outlined" fullWidth onClick={() => setFlow('idle')}>{t.waitingCancel}</Button>
          ) : (
            <Tooltip title={t.connectTooltip} describeChild>
              <span style={{ display: 'flex', flexGrow: 1 }}>
                <Button
                  variant="contained"
                  fullWidth
                  startIcon={flow === 'connecting' ? <CircularProgress size={16} color="inherit" /> : <AppIcon icon={Plug} size="sm" />}
                  onClick={handleConnect}
                  disabled={locked || flow !== 'idle'}
                >
                  {flow === 'connecting' ? t.connecting : t.connectAction}
                </Button>
              </span>
            </Tooltip>
          )
        )}

        {state === 'reaccept' && (
          <Button
            variant="contained"
            color="warning"
            disableElevation
            startIcon={<AppIcon icon={ShieldAlert} size="sm" />}
            onClick={() => { setAcceptError(null); setDialog('reaccept'); }}
            disabled={locked}
          >
            {t.reacceptAction}
          </Button>
        )}

        {(state === 'connected' || state === 'rejected') && (
          <Tooltip title={extReady ? t.syncTooltip : t.outdatedHint} describeChild>
            <span>
              <Button
                variant="outlined"
                size="small"
                startIcon={syncing ? <CircularProgress size={14} color="inherit" /> : <AppIcon icon={RefreshCw} size="sm" />}
                onClick={() => void handleSync()}
                disabled={locked || syncing || !extReady}
              >
                {syncing ? t.syncing : t.syncNow}
              </Button>
            </span>
          </Tooltip>
        )}

        {hasCredential && state !== 'locked' && (
          <Stack direction="row" alignItems="center" spacing={0.5}>
            {state === 'connected' && (
              <Tooltip title={item?.status === 'ACTIVE' ? ta.deactivateTooltip : ta.activateTooltip} describeChild>
                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center' }}>
                  <Typography variant="caption" color="text.secondary" component="span">{t.activeLabel}</Typography>
                  <Switch
                    size="small"
                    checked={item?.status === 'ACTIVE'}
                    disabled={locked}
                    onChange={(_, checked) => onStatusChange(checked ? 'ACTIVE' : 'INACTIVE')}
                    inputProps={{ 'aria-label': t.activeLabel }}
                  />
                </Box>
              </Tooltip>
            )}
            <Tooltip title={t.disconnectTooltip} describeChild>
              <span>
                <Button
                  size="small"
                  color="error"
                  startIcon={<AppIcon icon={Unplug} size="sm" />}
                  onClick={() => setConfirmDisconnect(true)}
                  disabled={locked}
                >
                  {t.disconnect}
                </Button>
              </span>
            </Tooltip>
            <Tooltip title={t.disconnectTooltip} describeChild>
              <span>
                <IconButton size="small" color="error" aria-label={ta.remove} onClick={() => setConfirmDisconnect(true)} disabled={locked}>
                  <AppIcon icon={Trash2} size="sm" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        )}
      </Stack>

      <MarketplaceRiskNoticeDialog
        open={dialog !== null}
        canAccept={canAcceptRisk}
        confirmLabel={dialog === 'connect' ? tr.confirm : tr.confirmOnly}
        busy={accepting}
        error={acceptError}
        onConfirm={() => void handleAccept()}
        onClose={() => setDialog(null)}
      />

      <ConfirmDialog
        open={confirmDisconnect}
        title={t.disconnectTitle}
        description={t.disconnectDescription}
        confirmLabel={t.disconnect}
        cancelLabel={ta.cancel}
        confirmColor="error"
        onConfirm={() => void handleDisconnect()}
        onClose={() => setConfirmDisconnect(false)}
      />
    </AffiliateCardShell>
  );
}
