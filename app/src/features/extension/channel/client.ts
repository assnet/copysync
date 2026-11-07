import {
  CHANNEL_NAME, CHANNEL_VERSION,
  type ChannelEnvelope, type ChannelResponse, type OpMap, type OpName,
} from '../contract/channel';
import { readProxyIds, sendViaProxy } from './proxyTransport';

/**
 * Dois transportes, mesmo envelope:
 * - externo: `chrome.runtime.sendMessage(<id>)` via `externally_connectable` (Chrome/Edge);
 * - proxy: `window.postMessage` ⇄ content script `panel-bridge.js` (Orion e quem não entrega
 *   `externally_connectable` à página). Ver `proxyTransport.ts` e docs/extensao-navegador.md.
 * Ordem: transporte já provado → externo → proxy. O que respondeu fica em cache.
 */

const EXTENSION_IDS: string[] = (import.meta.env.VITE_EXTENSION_IDS ?? '')
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean);

const TIMEOUT_MS = 3_000;
/** `handshake` pelo externo quando há proxy na página: desiste cedo e tenta o proxy. */
const SHORT_TIMEOUT_MS = 1_500;

type Transport = 'external' | 'proxy';
let cached: { transport: Transport; extId: string } | null = null;

function buildEnvelope<Op extends OpName>(op: Op, payload: OpMap[Op]['request']): ChannelEnvelope {
  return {
    channel: CHANNEL_NAME,
    version: CHANNEL_VERSION,
    direction: 'request',
    requestId: crypto.randomUUID(),
    timestamp: Date.now(),
    op,
    payload,
  };
}

function sendToExtension(extId: string, envelope: ChannelEnvelope, timeoutMs = TIMEOUT_MS): Promise<ChannelEnvelope | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    try {
      chrome.runtime.sendMessage(extId, envelope, (response: unknown) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          resolve(undefined);
          return;
        }
        resolve(response as ChannelEnvelope | undefined);
      });
    } catch {
      clearTimeout(timer);
      resolve(undefined);
    }
  });
}

/** Ids com proxy na página; com `VITE_EXTENSION_IDS`, só os configurados (na ordem deles). */
function proxyIds(): string[] {
  const ids = readProxyIds();
  if (!EXTENSION_IDS.length) return ids;
  return EXTENSION_IDS.filter((id) => ids.includes(id));
}

function send(transport: Transport, extId: string, envelope: ChannelEnvelope, timeoutMs = TIMEOUT_MS) {
  return transport === 'proxy' ? sendViaProxy(extId, envelope, timeoutMs) : sendToExtension(extId, envelope, timeoutMs);
}

export async function sendOp<Op extends OpName>(
  op: Op,
  payload: OpMap[Op]['request'] = {} as OpMap[Op]['request'],
): Promise<ChannelResponse<OpMap[Op]['response']>> {
  // Envelope novo por tentativa: o anti-replay da extensão recusa requestId repetido.
  const attempt = async (transport: Transport, extId: string, timeoutMs?: number) => {
    const response = await send(transport, extId, buildEnvelope(op, payload), timeoutMs);
    if (!response?.payload) return null;
    cached = { transport, extId };
    return response.payload as ChannelResponse<OpMap[Op]['response']>;
  };

  if (cached) {
    const hit = await attempt(cached.transport, cached.extId);
    if (hit) return hit;
    cached = null;
  }

  const viaProxy = proxyIds();
  if (isNativeChannelBound()) {
    // Orion expõe `chrome.runtime` mas o externo não responde: com proxy, o handshake desiste cedo.
    const timeoutMs = op === 'handshake' && viaProxy.length ? SHORT_TIMEOUT_MS : TIMEOUT_MS;
    for (const extId of EXTENSION_IDS) {
      const hit = await attempt('external', extId, timeoutMs);
      if (hit) return hit;
    }
  }

  for (const extId of viaProxy) {
    const hit = await attempt('proxy', extId);
    if (hit) return hit;
  }

  return { ok: false, error: { code: 'INTERNAL' } };
}

/** Algum ID de extensão configurado (`VITE_EXTENSION_IDS`): sem isso não há como detectar. */
export function hasConfiguredExtensionIds(): boolean {
  return EXTENSION_IDS.length > 0;
}

/** `chrome.runtime.sendMessage` existe nesta página (externally_connectable ligado ao carregar). */
function isNativeChannelBound(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.sendMessage;
}

/** O content script do proxy marcou a página: a extensão está instalada e ativa nesta aba. */
export function isExtensionProxyPresent(): boolean {
  return proxyIds().length > 0;
}

/**
 * A página tem por onde falar com a extensão: `chrome.runtime.sendMessage` (o Chrome só o liga
 * ao carregar a página e se alguma extensão a aceitar) ou o proxy. Instalou com a aba aberta →
 * nenhum dos dois até recarregar (content script declarado só entra em página nova).
 */
export function isExtensionChannelBound(): boolean {
  return isNativeChannelBound() || isExtensionProxyPresent();
}

export function isExtensionApiAvailable(): boolean {
  return (isNativeChannelBound() && hasConfiguredExtensionIds()) || isExtensionProxyPresent();
}

export async function detectExtension(): Promise<boolean> {
  if (!isExtensionApiAvailable()) return false;
  try {
    const result = await sendOp('handshake');
    return result.ok;
  } catch {
    return false;
  }
}

/** Id da extensão que respondeu por último (qualquer transporte). */
export function getCachedExtId(): string | null {
  return cached?.extId ?? null;
}

/** Transporte que respondeu por último (diagnóstico/testes). */
export function getCachedTransport(): Transport | null {
  return cached?.transport ?? null;
}

export function clearCachedExtId(): void {
  cached = null;
}
