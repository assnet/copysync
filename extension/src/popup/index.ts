/**
 * Popup — fala com o background SOMENTE por `chrome.runtime.sendMessage`
 * (contrato em `contract/messages.ts`). Nenhuma URL literal; tudo via `env`.
 */
import tippy, { type Instance } from 'tippy.js';
import 'tippy.js/dist/tippy.css';
import './popup.css';

import type { RuntimeRequest, RuntimeResponse, SessionStateSnapshot } from '../contract/messages.js';
import { env, MARKETPLACE_HOME_URL } from '../config/env.js';
import { applyI18n, t } from '../core/i18n.js';
import { devError } from '../core/devLog.js';
import { applyTheme, nextTheme, type ThemePreference } from './theme.js';
import { els, errorMessage, flashTagSaved, render, renderPasswordToggle, renderTheme, setLoading, showLoginError } from './view.js';

let current: SessionStateSnapshot | null = null;
let theme: ThemePreference = 'system';

const send = async (req: RuntimeRequest): Promise<RuntimeResponse> => {
  try {
    const res = (await chrome.runtime.sendMessage(req)) as RuntimeResponse | undefined;
    if (!res) return { ok: false, errorCode: 'api_unreachable' };
    return res;
  } catch (err) {
    devError('sendMessage', req.type, err);
    return { ok: false, errorCode: 'api_unreachable' };
  }
};

const apply = (res: RuntimeResponse): boolean => {
  if (!res.ok) return false;
  current = res.state;
  theme = res.state.settings.theme;
  applyTheme(theme);
  render(res.state);
  return true;
};

// ── Tooltips ─────────────────────────────────────────────────────────────────
const tooltips = new Map<HTMLElement, Instance>();

const tooltip = (el: HTMLElement, content: () => string): void => {
  const inst = tippy(el, {
    content: content(),
    theme: 'app',
    placement: 'bottom',
    delay: [250, 0],
    maxWidth: 260,
    onShow(instance) {
      instance.setContent(content());
    },
  });
  tooltips.set(el, inst);
};

// ── Handlers ─────────────────────────────────────────────────────────────────
const onLogin = async (ev: SubmitEvent): Promise<void> => {
  ev.preventDefault();
  const email = els.loginEmail.value.trim();
  const password = els.loginPassword.value;
  if (!email || !password) {
    els.loginForm.reportValidity();
    return;
  }
  showLoginError(null);
  setLoading(els.loginSubmit, true, 'login_submitting');
  const res = await send({ type: 'auth/login', email, password });
  setLoading(els.loginSubmit, false, 'login_submit');
  if (res.ok) {
    els.loginPassword.value = '';
    apply(res);
  } else {
    showLoginError(res.errorCode);
  }
};

const onSyncNow = async (): Promise<void> => {
  setLoading(els.syncNow, true, 'session_syncing');
  const res = await send({ type: 'session/sync-now' });
  if (!apply(res)) {
    // Mantém o último estado conhecido e mostra o erro inline.
    setLoading(els.syncNow, false, 'session_sync_now');
    if (!res.ok) {
      els.syncError.hidden = false;
      els.syncError.textContent = errorMessage(res.errorCode);
    }
  }
};

const onThemeToggle = async (): Promise<void> => {
  theme = nextTheme(theme);
  applyTheme(theme);
  renderTheme(theme);
  tooltips.get(els.themeBtn)?.setContent(t(`popup_theme_${theme}`));
  apply(await send({ type: 'settings/save', settings: { theme } }));
};

const onTenantChange = async (): Promise<void> => {
  apply(await send({ type: 'auth/select-tenant', tenantId: els.tenantSelect.value }));
};

let lastSavedTag: string | null = null;
const onTagSave = async (): Promise<void> => {
  const affiliateTag = els.tagInput.value.trim();
  if (affiliateTag === (lastSavedTag ?? current?.settings.affiliateTag ?? '')) return;
  const res = await send({ type: 'settings/save', settings: { affiliateTag } });
  if (apply(res)) {
    lastSavedTag = affiliateTag;
    flashTagSaved();
  } else if (!res.ok) {
    els.syncError.hidden = false;
    els.syncError.textContent = errorMessage(res.errorCode);
  }
};

const onLogout = async (): Promise<void> => {
  apply(await send({ type: 'auth/logout' }));
};

const openTab = (url: string): void => {
  if (url) void chrome.tabs.create({ url });
};

// ── Boot ─────────────────────────────────────────────────────────────────────
const boot = async (): Promise<void> => {
  document.title = t('extName');
  applyI18n();
  els.appName.textContent = env.appName;
  els.version.textContent = t('popup_version', chrome.runtime.getManifest().version);
  renderPasswordToggle(false);
  renderTheme(theme);

  tooltip(els.themeBtn, () => t(`popup_theme_${theme}`));
  tooltip(els.panelBtn, () => t('popup_open_panel'));
  tooltip(els.togglePassword, () => t(els.loginPassword.type === 'password' ? 'login_show_password' : 'login_hide_password'));
  tooltip(els.syncHelp, () => t('session_sync_help'));
  tooltip(els.tagHelp, () => t('tag_help'));
  tooltip(els.logoutBtn, () => t('account_logout_help'));
  tooltip(els.tenantSelect, () => t('tenant_help'));

  els.loginForm.addEventListener('submit', (ev) => void onLogin(ev));
  els.togglePassword.addEventListener('click', () => renderPasswordToggle(els.loginPassword.type === 'password'));
  els.themeBtn.addEventListener('click', () => void onThemeToggle());
  els.panelBtn.addEventListener('click', () => openTab(env.panelUrl));
  els.openMarketplace.addEventListener('click', () => {
    void send({ type: 'marketplace/check-login' }).then(apply);
    openTab(MARKETPLACE_HOME_URL);
  });
  els.syncNow.addEventListener('click', () => void onSyncNow());
  els.tenantSelect.addEventListener('change', () => void onTenantChange());
  els.tagInput.addEventListener('blur', () => void onTagSave());
  els.tagInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      els.tagInput.blur();
    }
  });
  els.logoutBtn.addEventListener('click', () => void onLogout());

  const res = await send({ type: 'session/get-state' });
  if (!apply(res)) {
    // Sem background: mostra o login com o erro (não deixa o popup em branco).
    els.app.removeAttribute('aria-busy');
    els.viewLogin.hidden = false;
    if (!res.ok) showLoginError(res.errorCode);
  }
};

void boot();
