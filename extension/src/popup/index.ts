/**
 * Popup — v3: no login form, session via HttpOnly cookie from panel.
 * Talks to background via `chrome.runtime.sendMessage` (popup/* messages).
 */
import tippy, { type Instance } from 'tippy.js';
import 'tippy.js/dist/tippy.css';
import './popup.css';

import type { StoredSettings } from '../background/store.js';
import { env, MARKETPLACE_HOME_URL } from '../config/env.js';
import { applyI18n, t } from '../core/i18n.js';
import { devError } from '../core/devLog.js';
import { applyTheme, nextTheme, type ThemePreference } from './theme.js';
import { els, errorMessage, render, renderTheme, setLoading, type PopupState } from './view.js';

let current: PopupState | null = null;
let theme: ThemePreference = 'system';

interface PopupRequest {
  type: string;
  settings?: Partial<StoredSettings>;
}

interface PopupResponse {
  ok: boolean;
  auth?: PopupState['auth'];
  settings?: StoredSettings;
  sync?: PopupState['sync'];
  ml?: PopupState['ml'];
}

const send = async (req: PopupRequest): Promise<PopupResponse> => {
  try {
    const res = (await chrome.runtime.sendMessage(req)) as PopupResponse | undefined;
    if (!res) return { ok: false };
    return res;
  } catch (err) {
    devError('sendMessage', req.type, err);
    return { ok: false };
  }
};

const DEFAULT_ML = { loggedIn: false, lastSyncAt: undefined, resyncRequested: false };
const DEFAULT_SYNC = { status: 'idle' as const };
const DEFAULT_SETTINGS = { theme: 'system' as const };

const apply = (res: PopupResponse): boolean => {
  if (!res.ok) return false;
  current = {
    auth: res.auth ?? null,
    settings: res.settings ?? current?.settings ?? DEFAULT_SETTINGS,
    sync: res.sync ?? current?.sync ?? DEFAULT_SYNC,
    ml: res.ml ?? current?.ml ?? DEFAULT_ML,
  };
  theme = current.settings.theme;
  applyTheme(theme);
  render(current);
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
const onSyncNow = async (): Promise<void> => {
  setLoading(els.syncNow, true, 'session_syncing');
  const res = await send({ type: 'popup/sync-now' });
  if (!apply(res)) {
    setLoading(els.syncNow, false, 'session_sync_now');
    if (!res.ok && current) {
      els.syncError.hidden = false;
      els.syncError.textContent = errorMessage('api_unreachable');
    }
  }
};

const onThemeToggle = async (): Promise<void> => {
  theme = nextTheme(theme);
  applyTheme(theme);
  renderTheme(theme);
  tooltips.get(els.themeBtn)?.setContent(t(`popup_theme_${theme}`));
  apply(await send({ type: 'popup/save-settings', settings: { theme } }));
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
  renderTheme(theme);

  tooltip(els.themeBtn, () => t(`popup_theme_${theme}`));
  tooltip(els.panelBtn, () => t('popup_open_panel'));
  tooltip(els.syncHelp, () => t('session_sync_help'));

  els.themeBtn.addEventListener('click', () => void onThemeToggle());
  els.panelBtn.addEventListener('click', () => openTab(env.panelUrl));
  els.openPanelBtn.addEventListener('click', () => openTab(env.panelUrl));
  els.openMarketplace.addEventListener('click', () => openTab(MARKETPLACE_HOME_URL));
  els.syncNow.addEventListener('click', () => void onSyncNow());

  const res = await send({ type: 'popup/get-state' });
  if (!apply(res)) {
    els.app.removeAttribute('aria-busy');
    els.viewConnect.hidden = false;
  }
};

void boot();
