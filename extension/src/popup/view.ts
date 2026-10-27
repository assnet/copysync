/**
 * Popup rendering — v3: no login form, no tag/tenant/logout.
 * Two views: connect (unauthenticated) and main (ML session status).
 * Never uses innerHTML with user data — textContent/createElement only.
 */
import type { SyncState, SyncErrorCode, StoredSettings } from '../background/store.js';
import type { MlStatusPayload } from '../contract/channel.js';
import { env } from '../config/env.js';
import { t } from '../core/i18n.js';
import { relativeTime } from './relativeTime.js';
import { themeIconPath, themeLabelKey } from './theme.js';

export interface PopupAuth {
  email: string;
  name: string;
  mlTenantId: string | null;
}

export interface PopupState {
  auth: PopupAuth | null;
  settings: StoredSettings;
  sync: SyncState;
  ml: MlStatusPayload;
}

const byId = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`popup: #${id} missing`);
  return el as T;
};

export const els = {
  app: byId<HTMLElement>('app'),
  appName: byId<HTMLElement>('app-name'),
  themeBtn: byId<HTMLButtonElement>('theme-btn'),
  themeIcon: byId<SVGElement & HTMLElement>('theme-icon'),
  panelBtn: byId<HTMLButtonElement>('panel-btn'),
  viewConnect: byId<HTMLElement>('view-connect'),
  viewMain: byId<HTMLElement>('view-main'),
  openPanelBtn: byId<HTMLButtonElement>('open-panel-btn'),
  syncHelp: byId<HTMLButtonElement>('sync-help'),
  signal: byId<HTMLElement>('signal'),
  signalText: byId<HTMLElement>('signal-text'),
  openMarketplace: byId<HTMLButtonElement>('open-marketplace'),
  syncNow: byId<HTMLButtonElement>('sync-now'),
  syncStatus: byId<HTMLElement>('sync-status'),
  syncBadge: byId<HTMLElement>('sync-badge'),
  syncWhen: byId<HTMLElement>('sync-when'),
  syncError: byId<HTMLElement>('sync-error'),
  autoHint: byId<HTMLElement>('auto-hint'),
  accountLabel: byId<HTMLElement>('account-label'),
  version: byId<HTMLElement>('version'),
};

export const errorMessage = (code: SyncErrorCode | string): string => {
  const key = `err_${code}`;
  const msg = chrome.i18n.getMessage(key);
  return msg || t('err_api_rejected');
};

const setSvgPath = (svg: SVGElement, d: string): void => {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.8');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
};

export const renderTheme = (theme: StoredSettings['theme']): void => {
  setSvgPath(els.themeIcon, themeIconPath(theme));
  els.themeBtn.setAttribute('aria-label', t(themeLabelKey(theme)));
};

export const setLoading = (btn: HTMLButtonElement, loading: boolean, labelKey: string): void => {
  btn.disabled = loading;
  btn.classList.toggle('is-loading', loading);
  const label = btn.querySelector<HTMLElement>('.btn__label');
  if (label) label.textContent = t(labelKey);
};

const renderMarketplace = (state: PopupState): void => {
  const { loggedIn } = state.ml;
  const signalKey = loggedIn ? 'session_logged_in' : 'session_logged_out';
  els.signalText.textContent = t(signalKey);
  els.signal.classList.toggle('signal--on', loggedIn);
  els.signal.classList.toggle('signal--off', !loggedIn);
  els.openMarketplace.hidden = loggedIn;

  const { sync } = state;
  const syncing = sync.status === 'syncing';
  setLoading(els.syncNow, syncing, syncing ? 'session_syncing' : 'session_sync_now');

  els.syncStatus.className = `sync sync--${sync.status}`;
  const badgeKey = sync.status === 'error' ? 'status_error' : sync.status === 'ok' ? 'status_ok' : 'status_idle';
  els.syncBadge.textContent = t(badgeKey);
  els.syncWhen.textContent = sync.lastSyncAt
    ? t('session_last_sync', relativeTime(sync.lastSyncAt))
    : t('session_never_synced');

  const showError = sync.status === 'error' && !!sync.lastErrorCode;
  els.syncError.hidden = !showError;
  els.syncError.textContent = showError && sync.lastErrorCode ? errorMessage(sync.lastErrorCode) : '';

  els.autoHint.textContent = t('session_auto_hint', env.sessionSyncIntervalMinutes);
};

export const render = (state: PopupState): void => {
  const authed = !!state.auth;
  els.viewConnect.hidden = authed;
  els.viewMain.hidden = !authed;
  els.app.removeAttribute('aria-busy');
  renderTheme(state.settings.theme);

  if (!state.auth) return;

  renderMarketplace(state);
  els.accountLabel.textContent = t('account_signed_as', state.auth.email);
  els.accountLabel.title = state.auth.email;
};
