import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HubOutboxWorker } from './HubOutboxWorker';
import type { IHubOutboxRepository, OutboxHeadEvent } from '../../domain/contracts/IHubOutboxRepository';

vi.mock('./hmacSigner', () => ({
  signHubRequest: vi.fn().mockReturnValue({
    'X-Application-Key': 'key',
    'X-Timestamp': '2026-01-01T00:00:00.000Z',
    'X-Nonce': 'nonce-1',
    'X-Signature': 'sig-1',
  }),
}));

function makeEvent(overrides: Partial<OutboxHeadEvent> = {}): OutboxHeadEvent {
  return {
    id: 'evt-1',
    clientKey: 'client-1',
    seq: 1,
    installationId: 'inst-1',
    type: 'installed',
    payload: { foo: 'bar' },
    attempts: 0,
    nextAttemptAt: null,
    ...overrides,
  };
}

function makeRepo(overrides: Partial<IHubOutboxRepository> = {}): IHubOutboxRepository {
  return {
    claimHeads: vi.fn().mockResolvedValue([]),
    markSent: vi.fn().mockResolvedValue(undefined),
    markDead: vi.fn().mockResolvedValue(undefined),
    scheduleRetry: vi.fn().mockResolvedValue(undefined),
    releaseLock: vi.fn().mockResolvedValue(undefined),
    purgeSent: vi.fn().mockResolvedValue(0),
    purgeDead: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

describe('HubOutboxWorker', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('marks event SENT on 2xx', async () => {
    const event = makeEvent();
    const repo = makeRepo({ claimHeads: vi.fn().mockResolvedValue([event]) });
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 }) as any;

    const worker = new HubOutboxWorker({
      repository: repo,
      hubUrl: 'https://hub.example.com',
      applicationKey: 'key',
      secret: 'secret',
    });

    await worker.runTick();
    expect(repo.markSent).toHaveBeenCalledWith('evt-1');
  });

  it('marks event DEAD on 4xx', async () => {
    const event = makeEvent();
    const repo = makeRepo({ claimHeads: vi.fn().mockResolvedValue([event]) });
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400 }) as any;

    const worker = new HubOutboxWorker({
      repository: repo,
      hubUrl: 'https://hub.example.com',
      applicationKey: 'key',
      secret: 'secret',
    });

    await worker.runTick();
    expect(repo.markDead).toHaveBeenCalledWith('evt-1');
  });

  it('schedules retry on 5xx when attempts < 10', async () => {
    const event = makeEvent({ attempts: 2 });
    const repo = makeRepo({ claimHeads: vi.fn().mockResolvedValue([event]) });
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 }) as any;

    const worker = new HubOutboxWorker({
      repository: repo,
      hubUrl: 'https://hub.example.com',
      applicationKey: 'key',
      secret: 'secret',
    });

    await worker.runTick();
    expect(repo.scheduleRetry).toHaveBeenCalledWith('evt-1', expect.any(Date));
    const nextAt = (repo.scheduleRetry as any).mock.calls[0][1] as Date;
    const backoff = nextAt.getTime() - Date.now();
    expect(backoff).toBeGreaterThanOrEqual(240_000 - 1_000);
    expect(backoff).toBeLessThanOrEqual(240_000 + 5_000);
  });

  it('marks DEAD after max attempts', async () => {
    const event = makeEvent({ attempts: 9 });
    const repo = makeRepo({ claimHeads: vi.fn().mockResolvedValue([event]) });
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as any;

    const worker = new HubOutboxWorker({
      repository: repo,
      hubUrl: 'https://hub.example.com',
      applicationKey: 'key',
      secret: 'secret',
    });

    await worker.runTick();
    expect(repo.markDead).toHaveBeenCalledWith('evt-1');
  });

  it('schedules retry on network error', async () => {
    const event = makeEvent({ attempts: 0 });
    const repo = makeRepo({ claimHeads: vi.fn().mockResolvedValue([event]) });
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as any;

    const worker = new HubOutboxWorker({
      repository: repo,
      hubUrl: 'https://hub.example.com',
      applicationKey: 'key',
      secret: 'secret',
    });

    await worker.runTick();
    expect(repo.scheduleRetry).toHaveBeenCalledWith('evt-1', expect.any(Date));
  });

  it('does nothing when no events claimed', async () => {
    const repo = makeRepo();
    const worker = new HubOutboxWorker({
      repository: repo,
      hubUrl: 'https://hub.example.com',
      applicationKey: 'key',
      secret: 'secret',
    });

    await worker.runTick();
    expect(repo.markSent).not.toHaveBeenCalled();
    expect(repo.markDead).not.toHaveBeenCalled();
  });

  it('backoff caps at 24h', async () => {
    const event = makeEvent({ attempts: 8 });
    const repo = makeRepo({ claimHeads: vi.fn().mockResolvedValue([event]) });
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 502 }) as any;

    const worker = new HubOutboxWorker({
      repository: repo,
      hubUrl: 'https://hub.example.com',
      applicationKey: 'key',
      secret: 'secret',
    });

    await worker.runTick();
    const nextAt = (repo.scheduleRetry as any).mock.calls[0][1] as Date;
    const backoff = nextAt.getTime() - Date.now();
    const twentyFourHours = 24 * 60 * 60_000;
    expect(backoff).toBeLessThanOrEqual(twentyFourHours + 5_000);
  });
});
