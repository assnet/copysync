import type { ChannelEnvelope } from '../../contract/channel.js';
import { CHANNEL_NAME, CHANNEL_VERSION } from '../constants.js';

export const ENVELOPE_TTL_MS = 15_000;
export const REPLAY_MAX = 500;
export const replaySet = new Set<string>();

export const isValidEnvelope = (msg: unknown): msg is ChannelEnvelope => {
  if (!msg || typeof msg !== 'object') return false;
  const e = msg as Record<string, unknown>;
  return (
    e.channel === CHANNEL_NAME &&
    typeof e.version === 'number' &&
    e.direction === 'request' &&
    typeof e.requestId === 'string' &&
    typeof e.timestamp === 'number' &&
    typeof e.op === 'string'
  );
};

export const isVersionAccepted = (version: number): boolean =>
  version <= CHANNEL_VERSION && version >= CHANNEL_VERSION - 1;

export const isWithinTtl = (timestamp: number): boolean =>
  Math.abs(Date.now() - timestamp) <= ENVELOPE_TTL_MS;

export const checkReplay = (requestId: string): boolean => {
  if (replaySet.has(requestId)) return true;
  replaySet.add(requestId);
  if (replaySet.size > REPLAY_MAX) {
    const first = replaySet.values().next().value;
    if (first) replaySet.delete(first);
  }
  return false;
};

export const hasAuthInPayload = (payload: unknown): boolean =>
  !!payload && typeof payload === 'object' && 'auth' in (payload as object);
