/**
 * Content script do proxy na origem do painel (`panel-bridge.js`).
 * Bootstrap: injeta window/document/chrome.runtime e o portão de origem em `createPanelBridge`.
 * Nunca lança: falha aqui não pode afetar a página. Idempotente por flag no isolated world.
 */
import type { ChannelEnvelope } from '../contract/channel.js';
import { isPanelOrigin } from '../core/panelOrigin.js';
import { createPanelBridge, type BridgeDoc, type BridgeRuntime, type BridgeWin } from './panelBridge.js';

const FLAG = '__csPanelBridgeReady';
const g = globalThis as typeof globalThis & { [FLAG]?: boolean };

const runtime: BridgeRuntime = {
  get id() {
    try {
      return chrome.runtime?.id;
    } catch {
      return undefined;
    }
  },
  // Forma de callback: funciona também onde `sendMessage` não devolve Promise.
  send: (msg: ChannelEnvelope) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (response: unknown) => {
          resolve(chrome.runtime.lastError ? undefined : response);
        });
      } catch {
        resolve(undefined);
      }
    }),
};

if (!g[FLAG]) {
  g[FLAG] = true;
  try {
    createPanelBridge({
      win: window as unknown as BridgeWin,
      doc: document as unknown as BridgeDoc,
      runtime,
      isAllowedOrigin: isPanelOrigin,
    });
  } catch {
    /* nunca propaga para a página */
  }
}

export {};
