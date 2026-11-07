import {
  CHANNEL_NAME, PROXY_DIRECTION, PROXY_MARKER_ATTR,
  parseProxyMarker, parseProxyMessage, type ChannelEnvelope, type ProxyMessage,
} from '../contract/channel';

/**
 * Transporte por proxy: página ⇄ `window.postMessage` ⇄ content script da extensão
 * (`panel-bridge.js`) ⇄ service worker. Usado quando o navegador não entrega
 * `externally_connectable` à página (Orion) ou ele falha. Mesmo envelope do canal externo.
 */

export interface ProxyMessageEventLike {
  source: unknown;
  origin: string;
  data: unknown;
}

/** O que o transporte usa da janela — injetável para teste. */
export interface ProxyWindowLike {
  location: { origin: string };
  document?: { documentElement: { getAttribute(name: string): string | null } | null };
  postMessage(msg: unknown, targetOrigin: string): void;
  addEventListener(type: 'message', fn: (ev: ProxyMessageEventLike) => void): void;
  removeEventListener(type: 'message', fn: (ev: ProxyMessageEventLike) => void): void;
}

const defaultWindow = (): ProxyWindowLike | undefined =>
  typeof window === 'undefined' ? undefined : (window as unknown as ProxyWindowLike);

/** Ids de extensão com proxy vivo nesta página (marcador posto pelo content script em `<html>`). */
export function readProxyIds(win: ProxyWindowLike | undefined = defaultWindow()): string[] {
  try {
    return parseProxyMarker(win?.document?.documentElement?.getAttribute(PROXY_MARKER_ATTR));
  } catch {
    return [];
  }
}

/**
 * Envia um envelope pelo proxy da extensão `extId`. Resolve a resposta ou `undefined`
 * (timeout, `fail` do content script). Só aceita mensagem do próprio window, na própria
 * origem, no formato do contrato, vinda da extensão endereçada e com o mesmo `requestId`.
 */
export function sendViaProxy(
  extId: string,
  envelope: ChannelEnvelope,
  timeoutMs: number,
  win: ProxyWindowLike | undefined = defaultWindow(),
): Promise<ChannelEnvelope | undefined> {
  if (!win) return Promise.resolve(undefined);
  const origin = win.location.origin;
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: ChannelEnvelope | undefined) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      win.removeEventListener('message', onMessage);
      resolve(value);
    };
    const onMessage = (ev: ProxyMessageEventLike) => {
      if (ev.source !== win || ev.origin !== origin) return;
      const msg = parseProxyMessage(ev.data);
      if (!msg || (msg.kind !== 'res' && msg.kind !== 'fail')) return;
      if (msg.from !== extId || msg.requestId !== envelope.requestId) return;
      finish(msg.kind === 'res' ? msg.res : undefined);
    };
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    win.addEventListener('message', onMessage);
    const req: ProxyMessage = { channel: CHANNEL_NAME, direction: PROXY_DIRECTION, kind: 'req', to: extId, req: envelope };
    try {
      win.postMessage(req, origin); // targetOrigin explícito: nunca '*'
    } catch {
      finish(undefined);
    }
  });
}
