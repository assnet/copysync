/**
 * Acesso ao i18n nativo do Chrome (`public/_locales/<locale>/messages.json`).
 * Toda string exibida passa por aqui; `scripts/check-i18n.mjs` garante paridade
 * pt_BR ⇄ en e que toda chave usada no código existe.
 */
export type MessageKey = string;

export const t = (key: MessageKey, ...substitutions: Array<string | number>): string => {
  const value = chrome.i18n.getMessage(key, substitutions.map(String));
  return value || key;
};

/** Aplica `data-i18n="chave"` (textContent) e `data-i18n-attr="attr:chave"` em um subtree. */
export const applyI18n = (root: ParentNode = document): void => {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    if (key) el.textContent = t(key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-attr]').forEach((el) => {
    const pairs = (el.dataset.i18nAttr ?? '').split(';');
    for (const pair of pairs) {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  });
};
