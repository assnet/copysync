import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { FeatureUsageCount } from '../../domain/contracts/IFeatureUsageDailyRepository';
import { recordFeatureUsage } from '../../domain/contracts/IFeatureUsageRecorder';
import { CHAT_SEND_RECORDED_FROM, OFFER_STORY_RECORDED_FROM, findFeature } from '../../domain/services/featureUsageCatalog';
import { RecordFeatureUsageUseCase } from './RecordFeatureUsageUseCase';

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
  return { written, log, daily, recorder: new RecordFeatureUsageUseCase({ daily, log }) };
}

describe('RecordFeatureUsageUseCase', () => {
  it('cortes da P2 no dia seguinte ao deploy previsto; offer_story segue LIVE com corte, chat_send é RECORDED', () => {
    expect(OFFER_STORY_RECORDED_FROM).toBe('2026-11-19');
    expect(CHAT_SEND_RECORDED_FROM).toBe('2026-11-19');
    expect(findFeature('offer_story')).toMatchObject({ source: 'LIVE', recordedFrom: OFFER_STORY_RECORDED_FROM });
    expect(findFeature('chat_send')).toMatchObject({ source: 'RECORDED', recordedFrom: CHAT_SEND_RECORDED_FROM, product: 'CHAT' });
  });

  it('no dia do corte (Brasília) grava só conta, chave, tipo e instante', async () => {
    const { recorder, written } = setup();
    const at = new Date('2026-11-19T15:00:00Z');
    await recorder.increment({ tenantId: 't1', featureKey: 'offer_story', kind: 'ACTION', at });
    await recorder.increment({ tenantId: 't1', featureKey: 'chat_send', kind: 'ACTION', at });
    expect(written).toEqual([
      { op: 'increment', count: { tenantId: 't1', featureKey: 'offer_story', kind: 'ACTION', at } },
      { op: 'increment', count: { tenantId: 't1', featureKey: 'chat_send', kind: 'ACTION', at } },
    ]);
  });

  it('véspera não grava: 00:30 UTC do dia do corte ainda é a véspera em Brasília', async () => {
    const { recorder, written } = setup();
    await recorder.increment({ tenantId: 't1', featureKey: 'offer_story', kind: 'ACTION', at: new Date('2026-11-18T18:00:00Z') });
    await recorder.increment({ tenantId: 't1', featureKey: 'chat_send', kind: 'ACTION', at: new Date('2026-11-19T00:30:00Z') });
    expect(written).toEqual([]);
    // 03:00 UTC = 00:00 de Brasília: já é o dia do corte
    await recorder.increment({ tenantId: 't1', featureKey: 'chat_send', kind: 'ACTION', at: new Date('2026-11-19T03:00:00Z') });
    expect(written).toHaveLength(1);
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

  it('chat e Story dependem só do contrato do contador', () => {
    const root = resolve(__dirname, '../../..');
    for (const f of [
      'chat/application/use-cases/SendMessageUseCase.ts',
      'chat/application/use-cases/SendMediaMessageUseCase.ts',
      'offer-story/application/use-cases/RenderOfferStoryUseCase.ts',
      'offer-story/application/use-cases/offerStoryUseCaseDeps.ts',
    ]) {
      const src = readFileSync(resolve(root, f), 'utf8');
      expect(src, f).toMatch(/metrics\/domain\/contracts\/IFeatureUsageRecorder/);
      expect(src, f).not.toMatch(/metrics\/(infrastructure|application)/);
    }
  });
});
