/**
 * Relay do canal por proxy (content script na origem do painel).
 *
 * Página ⇄ `window.postMessage` ⇄ ESTE módulo ⇄ `chrome.runtime.sendMessage` ⇄ service worker,
 * que aplica a MESMA cadeia do canal externo (envelope, TTL, replay, guard, sanitização).
 * Existe para navegadores que não entregam `externally_connectable` à página (Orion).
 *
 * PURO: `window`/`document`/`chrome.runtime` injetados — testável em `environment: node`.
 * Nunca lê cookie/storage nem repassa nada além do envelope de resposta do service worker.
 */
import {
  CHANNEL_NAME, PROXY_DIRECTION, PROXY_MARKER_ATTR, PROXY_MAX_BYTES,
  parseProxyMarker, parseProxyMessage, type ChannelEnvelope, type ProxyMessage,
} from '../contract/channel.js';

export interface BridgeMessageEvent {
  source: unknown;
  origin: string;
  data: unknown;
}

export interface BridgeWin {
  location: { origin: string };
  postMessage(msg: unknown, targetOrigin: string): void;
  addEventListener(type: 'message', fn: (ev: BridgeMessageEvent) => void): void;
  removeEventListener(type: 'message', fn: (ev: BridgeMessageEvent) => void): void;
}

interface BridgeElement {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

export interface BridgeDoc {
  readonly documentElement: BridgeElement | null;
  addEventListener(type: 'readystatechange', fn: () => void): void;
  removeEventListener(type: 'readystatechange', fn: () => void): void;
}

/** `id` lido AO VIVO: com o contexto invalidado (extensão recarregada) vira `undefined`. */
export interface BridgeRuntime {
  readonly id: string | undefined;
  /** Envia ao service worker; resolve `undefined` em erro (`lastError`, contexto morto). */
  send(msg: ChannelEnvelope): Promise<unknown>;
}

export interface PanelBridgeDeps {
  win: BridgeWin;
  doc: BridgeDoc;
  runtime: BridgeRuntime;
  isAllowedOrigin: (origin: string) => boolean;
  now?: () => number;
}

/** Anti-flood: pedidos aceitos por janela de 1 s (o painel faz poucos por minuto). */
export const BRIDGE_RATE_LIMIT = 20;
const RATE_WINDOW_MS = 1_000;

const isResponseFor = (v: unknown, requestId: string): v is ChannelEnvelope => {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return e.channel === CHANNEL_NAME && e.direction === 'response' && e.requestId === requestId;
};

export function createPanelBridge({ win, doc, runtime, isAllowedOrigin, now = Date.now }: PanelBridgeDeps): {
  destroy: () => void;
} {
  // Id capturado na injeção: filtros e `from` usam ESTE valor, nunca o vivo.
  const selfId = String(runtime.id ?? '');
  const ownOrigin = win.location.origin;
  let destroyed = false;
  let windowStart = 0;
  let windowCount = 0;

  const post = (msg: ProxyMessage) => {
    try {
      // targetOrigin explícito: nunca '*'.
      win.postMessage(msg, ownOrigin);
    } catch {
      /* página fechando: nada a fazer */
    }
  };

  const fail = (requestId: string) =>
    post({ channel: CHANNEL_NAME, direction: PROXY_DIRECTION, kind: 'fail', from: selfId, requestId });

  const withinRate = (): boolean => {
    const t = now();
    if (t - windowStart > RATE_WINDOW_MS) {
      windowStart = t;
      windowCount = 0;
    }
    windowCount += 1;
    return windowCount <= BRIDGE_RATE_LIMIT;
  };

  const relay = async (req: ChannelEnvelope) => {
    let res: unknown;
    try {
      if (runtime.id !== selfId) throw new Error('context invalidated');
      res = await runtime.send(req);
    } catch {
      res = undefined;
    }
    if (destroyed) return;
    // Só o envelope de resposta do service worker (já sanitizado lá) volta à página.
    if (isResponseFor(res, req.requestId)) {
      post({ channel: CHANNEL_NAME, direction: PROXY_DIRECTION, kind: 'res', from: selfId, requestId: req.requestId, res });
    } else {
      fail(req.requestId);
    }
  };

  const onMessage = (ev: BridgeMessageEvent) => {
    if (destroyed) return;
    // 1. Só o próprio window (nada de iframe/opener), 2. origem exata e na allowlist.
    if (ev.source !== win) return;
    if (ev.origin !== ownOrigin) return;
    let allowed = false;
    try {
      allowed = isAllowedOrigin(ev.origin);
    } catch {
      allowed = false;
    }
    if (!allowed) return;
    // 3. Forma: só `req` endereçado a esta extensão (loja + dev instaladas: só a certa age).
    const msg = parseProxyMessage(ev.data);
    if (!msg || msg.kind !== 'req' || msg.to !== selfId) return;
    if (!withinRate()) return fail(msg.req.requestId);
    let size = Infinity;
    try {
      size = JSON.stringify(msg.req).length;
    } catch {
      /* não serializável → recusa */
    }
    if (size > PROXY_MAX_BYTES) return fail(msg.req.requestId);
    void relay(msg.req);
  };

  // Ouvinte antes do marcador: a página só fala depois de ver o marcador.
  win.addEventListener('message', onMessage);

  const mark = (): boolean => {
    const el = doc.documentElement;
    if (!el) return false;
    const ids = parseProxyMarker(el.getAttribute(PROXY_MARKER_ATTR));
    if (!ids.includes(selfId)) el.setAttribute(PROXY_MARKER_ATTR, [...ids, selfId].join(' '));
    return true;
  };
  let onReady: (() => void) | null = null;
  if (selfId && !mark()) {
    onReady = () => {
      if (mark() && onReady) {
        doc.removeEventListener('readystatechange', onReady);
        onReady = null;
      }
    };
    doc.addEventListener('readystatechange', onReady);
  }
  if (selfId) post({ channel: CHANNEL_NAME, direction: PROXY_DIRECTION, kind: 'ready', from: selfId });

  return {
    destroy: () => {
      destroyed = true;
      win.removeEventListener('message', onMessage);
      if (onReady) doc.removeEventListener('readystatechange', onReady);
    },
  };
}
