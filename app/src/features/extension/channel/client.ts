import {
  CHANNEL_NAME, CHANNEL_VERSION,
  type ChannelEnvelope, type ChannelResponse, type OpMap, type OpName,
} from '../contract/channel';

const EXTENSION_IDS: string[] = (import.meta.env.VITE_EXTENSION_IDS ?? '')
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean);

const TIMEOUT_MS = 3_000;
let cachedExtId: string | null = null;

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

function sendToExtension(extId: string, envelope: ChannelEnvelope): Promise<ChannelEnvelope | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), TIMEOUT_MS);
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

export async function sendOp<Op extends OpName>(
  op: Op,
  payload: OpMap[Op]['request'] = {} as OpMap[Op]['request'],
): Promise<ChannelResponse<OpMap[Op]['response']>> {
  const envelope = buildEnvelope(op, payload);

  if (cachedExtId) {
    const response = await sendToExtension(cachedExtId, envelope);
    if (response?.payload) return response.payload as ChannelResponse<OpMap[Op]['response']>;
    cachedExtId = null;
  }

  for (const extId of EXTENSION_IDS) {
    const response = await sendToExtension(extId, envelope);
    if (response?.payload) {
      cachedExtId = extId;
      return response.payload as ChannelResponse<OpMap[Op]['response']>;
    }
  }

  return { ok: false, error: { code: 'INTERNAL' } };
}

export function isExtensionApiAvailable(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.sendMessage && EXTENSION_IDS.length > 0;
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

export function getCachedExtId(): string | null {
  return cachedExtId;
}

export function clearCachedExtId(): void {
  cachedExtId = null;
}
