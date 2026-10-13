import type { ContentRequest, ContentResponse } from '../contract/messages.js';

/**
 * Content script do marketplace. Só responde `page/get-csrf` lendo o
 * `meta[name="csrf-token"]`. Sem polling, sem log, sem tocar no DOM.
 */
chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
  if (message?.type !== 'page/get-csrf') return false;
  const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? null;
  const response: ContentResponse = { csrfToken };
  sendResponse(response);
  return false;
});
