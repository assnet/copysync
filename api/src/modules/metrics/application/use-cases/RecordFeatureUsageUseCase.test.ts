import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { FeatureUsageCount } from '../../domain/contracts/IFeatureUsageDailyRepository';
import {
  FEATURE_USAGE_DROP_LOG_EVERY_MS,
  FEATURE_USAGE_MAX_PENDING,
  FeatureUsageDroppedError,
  featureUsagePending,
  recordFeatureUsage,
} from '../../domain/contracts/IFeatureUsageRecorder';
import { findFeature } from '../../domain/services/featureUsageCatalog';
import { RecordFeatureUsageUseCase } from './RecordFeatureUsageUseCase';

/** Corte em `platform_settings`: grava uma vez (primeira chamada vence), como o `ON CONFLICT` do real. */
class FakeCutovers {
  stored = new Map<string, string>();
  claims: Array<[string, string]> = [];
  async claimCutover(key: string, day: string): Promise<string> {
    this.claims.push([key, day]);
    if (!this.stored.has(key)) this.stored.set(key, day);
    return this.stored.get(key)!;
  }
}

function setup(fail = false) {
  const written: Array<{ op: string; count: FeatureUsageCount }> = [];
  const daily = {
    increment: vi.fn(async (count: FeatureUsageCount) => {
      if (fail) throw new Error('db down');
      written.push({ op: 'increment', count });
    }),
    markOnce: vi.fn(async (count: FeatureUsageCount) => {
      written.push({ op: 'markOnce', count });
    }),
  };
  const log = { warn: vi.fn() };
  const cutovers = new FakeCutovers();
  return { written, log, daily, cutovers, recorder: new RecordFeatureUsageUseCase({ daily, cutovers, log }) };
}

describe('RecordFeatureUsageUseCase', () => {
  it('sem data fixa: offer_story é LIVE com corte gravado, chat_send é RECORDED desde a primeira escrita', () => {
    expect(findFeature('offer_story')).toMatchObject({ source: 'LIVE', recordedFrom: 'CUTOVER' });
    expect(findFeature('chat_send')).toMatchObject({ source: 'RECORDED', recordedFrom: 'FIRST_WRITE', product: 'CHAT' });
  });

  it('chat_send conta desde a primeira escrita, sem gravar corte', async () => {
    const { recorder, written, cutovers } = setup();
    const at = new Date('2026-11-18T12:00:00Z');
    await recorder.increment({ tenantId: 't1', featureKey: 'chat_send', kind: 'ACTION', at });
    expect(written).toEqual([{ op: 'increment', count: { tenantId: 't1', featureKey: 'chat_send', kind: 'ACTION', at } }]);
    expect(cutovers.claims).toEqual([]);
  });

  it('offer_story: a primeira escrita grava o corte = dia seguinte (Brasília) e não conta o dia dela; do corte em diante conta', async () => {
    const { recorder, written, cutovers } = setup();
    // 01:30 UTC do dia 19 = 22:30 do dia 18 em Brasília: corte = 19
    await recorder.increment({ tenantId: 't1', featureKey: 'offer_story', kind: 'ACTION', at: new Date('2026-11-19T01:30:00Z') });
    expect(cutovers.claims).toEqual([['offer_story', '2026-11-19']]);
    await recorder.increment({ tenantId: 't1', featureKey: 'offer_story', kind: 'ACTION', at: new Date('2026-11-19T02:59:00Z') });
    expect(written).toEqual([]); // ainda 18 em Brasília
    const at = new Date('2026-11-19T03:00:00Z'); // 00:00 do dia 19
    await recorder.increment({ tenantId: 't1', featureKey: 'offer_story', kind: 'ACTION', at });
    expect(written).toEqual([{ op: 'increment', count: { tenantId: 't1', featureKey: 'offer_story', kind: 'ACTION', at } }]);
    expect(cutovers.claims).toHaveLength(1); // o corte fica em memória depois de lido
  });

  it('corte já gravado por outro processo vale (não é regravado)', async () => {
    const { recorder, written, cutovers } = setup();
    cutovers.stored.set('offer_story', '2026-11-25');
    await recorder.increment({ tenantId: 't1', featureKey: 'offer_story', kind: 'ACTION', at: new Date('2026-11-24T15:00:00Z') });
    expect(written).toEqual([]);
    await recorder.increment({ tenantId: 't1', featureKey: 'offer_story', kind: 'ACTION', at: new Date('2026-11-25T15:00:00Z') });
    expect(written).toHaveLength(1);
    expect(cutovers.stored.get('offer_story')).toBe('2026-11-25');
  });

  it('falha ao gravar o corte não conta e vira warn; a próxima chamada tenta de novo', async () => {
    const { recorder, written, cutovers, log } = setup();
    const claim = vi.spyOn(cutovers, 'claimCutover').mockRejectedValueOnce(new Error('db'));
    await recorder.increment({ tenantId: 't1', featureKey: 'offer_story', kind: 'ACTION', at: new Date('2026-11-24T15:00:00Z') });
    expect(written).toEqual([]);
    expect(log.warn).toHaveBeenCalledTimes(1);
    await recorder.increment({ tenantId: 't1', featureKey: 'offer_story', kind: 'ACTION', at: new Date('2026-11-24T15:00:00Z') });
    expect(claim).toHaveBeenCalledTimes(2);
  });

  it('recurso LIVE sem corte e chave fora do catálogo não gravam (são do rollup ou não existem)', async () => {
    const { recorder, written } = setup();
    const at = new Date('2026-12-01T15:00:00Z');
    await recorder.increment({ tenantId: 't1', featureKey: 'offer_generator', kind: 'ACTION', at });
    await recorder.markOnce({ tenantId: 't1', featureKey: 'nao_existe', kind: 'ACTION', at });
    expect(written).toEqual([]);
  });

  it('falha do banco não rejeita e vira warn sem conta', async () => {
    const { recorder, log } = setup(true);
    await expect(
      recorder.increment({ tenantId: 't1', featureKey: 'chat_send', kind: 'ACTION', at: new Date('2026-11-20T12:00:00Z') }),
    ).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.warn.mock.calls[0])).not.toContain('t1');
  });

  it('recordFeatureUsage não espera e engole erro síncrono e assíncrono', async () => {
    const onError = vi.fn();
    const event = { tenantId: 't1', featureKey: 'chat_send', kind: 'ACTION' as const, at: new Date() };
    const hang = { increment: vi.fn(() => new Promise<void>(() => {})), markOnce: vi.fn() };
    expect(recordFeatureUsage(hang, event, onError)).toBeUndefined();
    recordFeatureUsage({ increment: vi.fn(() => { throw new Error('sync'); }), markOnce: vi.fn() }, event, onError);
    recordFeatureUsage({ increment: vi.fn(async () => { throw new Error('async'); }), markOnce: vi.fn() }, event, onError);
    recordFeatureUsage(null, event, onError);
    await new Promise((r) => setTimeout(r, 0));
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('teto de 20 gravações em voo: acima descarta, avisa amostrado (1/min) e volta a gravar quando esvazia', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-20T12:00:00Z'));
      const releases: Array<() => void> = [];
      const slow = {
        increment: vi.fn(() => new Promise<void>((r) => releases.push(r))),
        markOnce: vi.fn(),
      };
      const onError = vi.fn();
      const event = { tenantId: 't1', featureKey: 'chat_send', kind: 'ACTION' as const, at: new Date() };
      const base = featureUsagePending();
      for (let i = 0; i < FEATURE_USAGE_MAX_PENDING - base; i++) recordFeatureUsage(slow, event, onError);
      expect(featureUsagePending()).toBe(FEATURE_USAGE_MAX_PENDING);
      const calls = slow.increment.mock.calls.length;
      for (let i = 0; i < 5; i++) recordFeatureUsage(slow, event, onError);
      expect(slow.increment.mock.calls.length).toBe(calls); // descartados sem chamar o contador
      expect(onError).toHaveBeenCalledTimes(1); // amostrado
      expect(onError.mock.calls[0]![0]).toBeInstanceOf(FeatureUsageDroppedError);
      expect((onError.mock.calls[0]![0] as FeatureUsageDroppedError).dropped).toBe(1);
      vi.setSystemTime(new Date(Date.now() + FEATURE_USAGE_DROP_LOG_EVERY_MS));
      recordFeatureUsage(slow, event, onError);
      expect(onError).toHaveBeenCalledTimes(2);
      expect((onError.mock.calls[1]![0] as FeatureUsageDroppedError).dropped).toBe(5); // 4 calados + este
      for (const r of releases) r();
      await vi.waitFor(() => expect(featureUsagePending()).toBe(base));
      recordFeatureUsage(slow, event, onError);
      expect(slow.increment.mock.calls.length).toBe(calls + 1);
      releases[releases.length - 1]!();
      await vi.waitFor(() => expect(featureUsagePending()).toBe(base));
    } finally {
      vi.useRealTimers();
    }
  });

  it('chat e Story dependem só do contrato do contador', () => {
    const root = resolve(__dirname, '../../..');
    for (const f of [
      'chat/application/use-cases/SendMessageUseCase.ts',
      'chat/application/use-cases/DispatchOutboundMediaUseCase.ts',
      'offer-story/application/use-cases/RenderOfferStoryUseCase.ts',
      'offer-story/application/use-cases/offerStoryUseCaseDeps.ts',
    ]) {
      const src = readFileSync(resolve(root, f), 'utf8');
      expect(src, f).toMatch(/metrics\/domain\/contracts\/IFeatureUsageRecorder/);
      expect(src, f).not.toMatch(/metrics\/(infrastructure|application)/);
    }
  });
});
