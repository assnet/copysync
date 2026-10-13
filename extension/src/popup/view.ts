/**
 * Renderização do popup: recebe um `SessionStateSnapshot` e atualiza o DOM.
 * Nunca usa `innerHTML` com dado do usuário — só textContent/createElement.
 */
import type { SessionStateSnapshot, SyncErrorCode } from '../contract/messages.js';
import { env } from '../config/env.js';
import { t } from '../core/i18n.js';
import { relativeTime } from './relativeTime.js';
import { themeIconPath, themeLabelKey } from './theme.js';

const byId = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`popup: #${id} ausente`);
  return el as T;
};

export const els = {
  app: byId<HTMLElement>('app'),
  appName: byId<HTMLElement>('app-name'),
  themeBtn: byId<HTMLButtonElement>('theme-btn'),
  themeIcon: byId<SVGElement & HTMLElement>('theme-icon'),
  panelBtn: byId<HTMLButtonElement>('panel-btn'),
  viewLogin: byId<HTMLElement>('view-login'),
  viewMain: byId<HTMLElement>('view-main'),
  loginForm: byId<HTMLFormElement>('login-form'),
  loginEmail: byId<HTMLInputElement>('login-email'),
  loginPassword: byId<HTMLInputElement>('login-password'),
  togglePassword: byId<HTMLButtonElement>('toggle-password'),
  eyeIcon: byId<SVGElement & HTMLElement>('eye-icon'),
  loginError: byId<HTMLElement>('login-error'),
  loginSubmit: byId<HTMLButtonElement>('login-submit'),
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
  tenantField: byId<HTMLElement>('tenant-field'),
  tenantSelect: byId<HTMLSelectElement>('tenant-select'),
  tagInput: byId<HTMLInputElement>('tag-input'),
  tagHelp: byId<HTMLButtonElement>('tag-help'),
  tagFeedback: byId<HTMLElement>('tag-feedback'),
  accountLabel: byId<HTMLElement>('account-label'),
  logoutBtn: byId<HTMLButtonElement>('logout-btn'),
  version: byId<HTMLElement>('version'),
};

/** Traduz um `errorCode`; cai em `err_api_rejected` se a chave não existir. */
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

const EYE_OPEN = 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z';
const EYE_CLOSED = 'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 4.4-1';

export const renderPasswordToggle = (visible: boolean): void => {
  els.loginPassword.type = visible ? 'text' : 'password';
  els.togglePassword.setAttribute('aria-pressed', String(visible));
  els.togglePassword.setAttribute('aria-label', t(visible ? 'login_hide_password' : 'login_show_password'));
  setSvgPath(els.eyeIcon, visible ? EYE_CLOSED : EYE_OPEN);
};

export const renderTheme = (theme: SessionStateSnapshot['settings']['theme']): void => {
  setSvgPath(els.themeIcon, themeIconPath(theme));
  els.themeBtn.setAttribute('aria-label', t(themeLabelKey(theme)));
};

export const setLoading = (btn: HTMLButtonElement, loading: boolean, labelKey: string): void => {
  btn.disabled = loading;
  btn.classList.toggle('is-loading', loading);
  const label = btn.querySelector<HTMLElement>('.btn__label');
  if (label) label.textContent = t(labelKey);
};

export const showLoginError = (code: string | null): void => {
  els.loginError.hidden = !code;
  els.loginError.textContent = code ? errorMessage(code) : '';
};

const renderTenants = (state: SessionStateSnapshot): void => {
  const auth = state.auth;
  if (!auth || auth.tenants.length <= 1) {
    els.tenantField.hidden = true;
    return;
  }
  els.tenantField.hidden = false;
  const select = els.tenantSelect;
  while (select.firstChild) select.removeChild(select.firstChild);
  for (const tenant of auth.tenants) {
    const opt = document.createElement('option');
    opt.value = tenant.id;
    opt.textContent = tenant.name;
    select.appendChild(opt);
  }
  select.value = auth.tenantId;
};

const renderMarketplace = (state: SessionStateSnapshot): void => {
  const { loggedIn, hasOpenTab } = state.marketplace;
  const signalKey = loggedIn ? 'session_logged_in' : hasOpenTab ? 'session_logged_out' : 'session_tab_missing';
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

/** Render completo a partir do snapshot. Campos em edição (etiqueta) não são sobrescritos. */
export const render = (state: SessionStateSnapshot): void => {
  const authed = !!state.auth;
  els.viewLogin.hidden = authed;
  els.viewMain.hidden = !authed;
  els.app.removeAttribute('aria-busy');
  renderTheme(state.settings.theme);

  if (!state.auth) {
    requestAnimationFrame(() => els.loginEmail.focus());
    return;
  }

  renderMarketplace(state);
  renderTenants(state);
  if (document.activeElement !== els.tagInput) {
    els.tagInput.value = state.settings.affiliateTag ?? '';
  }
  els.accountLabel.textContent = t('account_signed_as', state.auth.user.email);
  els.accountLabel.title = state.auth.user.email;
};

export const flashTagSaved = (): void => {
  els.tagFeedback.textContent = t('tag_saved');
  els.tagFeedback.classList.add('is-visible');
  window.setTimeout(() => els.tagFeedback.classList.remove('is-visible'), 1800);
};
