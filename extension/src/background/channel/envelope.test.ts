import { describe, it, expect, beforeEach } from 'vitest';
import { isValidEnvelope, isVersionAccepted, isWithinTtl, checkReplay, hasAuthInPayload, replaySet } from './validate';

const validEnvelope = (overrides: Record<string, unknown> = {}) => ({
  channel: 'cs-ext',
  version: 1,
  direction: 'request',
  requestId: crypto.randomUUID(),
  timestamp: Date.now(),
  op: 'handshake',
  payload: {},
  ...overrides,
});

describe('isValidEnvelope', () => {
  it('accepts valid envelope', () => {
    expect(isValidEnvelope(validEnvelope())).toBe(true);
  });

  it('rejects null', () => {
    expect(isValidEnvelope(null)).toBe(false);
  });

  it('rejects non-object', () => {
    expect(isValidEnvelope('string')).toBe(false);
  });

  it('rejects missing channel', () => {
    expect(isValidEnvelope(validEnvelope({ channel: undefined }))).toBe(false);
  });

  it('rejects wrong channel', () => {
    expect(isValidEnvelope(validEnvelope({ channel: 'other' }))).toBe(false);
  });

  it('rejects wrong direction', () => {
    expect(isValidEnvelope(validEnvelope({ direction: 'response' }))).toBe(false);
  });

  it('rejects missing requestId', () => {
    expect(isValidEnvelope(validEnvelope({ requestId: undefined }))).toBe(false);
  });

  it('rejects missing timestamp', () => {
    expect(isValidEnvelope(validEnvelope({ timestamp: undefined }))).toBe(false);
  });

  it('rejects missing op', () => {
    expect(isValidEnvelope(validEnvelope({ op: undefined }))).toBe(false);
  });
});

describe('isVersionAccepted', () => {
  it('accepts current version (1)', () => {
    expect(isVersionAccepted(1)).toBe(true);
  });

  it('accepts N-1 (0)', () => {
    expect(isVersionAccepted(0)).toBe(true);
  });

  it('rejects version too old (-1)', () => {
    expect(isVersionAccepted(-1)).toBe(false);
  });

  it('rejects version too new (2)', () => {
    expect(isVersionAccepted(2)).toBe(false);
  });
});

describe('isWithinTtl', () => {
  it('accepts fresh timestamp', () => {
    expect(isWithinTtl(Date.now())).toBe(true);
  });

  it('rejects timestamp older than 15s', () => {
    expect(isWithinTtl(Date.now() - 16_000)).toBe(false);
  });

  it('rejects timestamp from future beyond 15s', () => {
    expect(isWithinTtl(Date.now() + 16_000)).toBe(false);
  });
});

describe('checkReplay', () => {
  beforeEach(() => {
    replaySet.clear();
  });

  it('returns false for first use', () => {
    expect(checkReplay('id-1')).toBe(false);
  });

  it('returns true for duplicate', () => {
    checkReplay('id-2');
    expect(checkReplay('id-2')).toBe(true);
  });

  it('evicts oldest when over max', () => {
    for (let i = 0; i < 501; i++) checkReplay(`id-${i}`);
    expect(replaySet.has('id-0')).toBe(false);
    expect(replaySet.has('id-500')).toBe(true);
  });
});

describe('hasAuthInPayload', () => {
  it('rejects payload with auth field', () => {
    expect(hasAuthInPayload({ auth: 'token' })).toBe(true);
  });

  it('accepts payload without auth', () => {
    expect(hasAuthInPayload({ data: 1 })).toBe(false);
  });

  it('accepts null payload', () => {
    expect(hasAuthInPayload(null)).toBe(false);
  });

  it('accepts undefined payload', () => {
    expect(hasAuthInPayload(undefined)).toBe(false);
  });
});
