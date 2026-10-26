import { describe, it, expect, vi } from 'vitest';
import { AiTextGeneratorService } from './AiTextGeneratorService';
import { FakeUsage } from '../use-cases/aiTestFakes';
import { AiNotConfiguredError, AiProviderUnavailableError } from '../../../../shared/errors/internal/AiErrors';
import type { ResolvedAiProvider } from '../use-cases/ResolveAiTextProviderUseCase';

const resolved: ResolvedAiProvider = {
  source: 'PLATFORM', kind: 'ANTHROPIC', model: 'claude-haiku-5-5', providerId: 'p1', apiKey: 'sk-secret-xyz', dailyLimit: 2,
};
const req = { tenantId: 't1', purpose: 'offer.text', system: 'sys', prompt: 'PROMPT-BODY', maxOutputTokens: 300 };

const NOW = new Date('2026-10-26T15:00:00Z');

function make(
  generate: () => Promise<{ text: string; inputTokens: number | null; outputTokens: number | null }>,
  r: ResolvedAiProvider = resolved,
) {
  const usage = new FakeUsage();
  const adapter = { generate: vi.fn(generate) };
  const svc = new AiTextGeneratorService({ execute: async () => r }, () => adapter, usage, () => NOW);
  return { svc, usage, adapter };
}

describe('AiTextGeneratorService', () => {
  it('sucesso: devolve texto aparado e grava uso com tokens, sem prompt/chave', async () => {
    const { svc, usage, adapter } = make(async () => ({ text: '  Oferta  ', inputTokens: 12, outputTokens: 5 }));
    expect(await svc.generate(req)).toEqual({ text: 'Oferta' });
    expect(adapter.generate).toHaveBeenCalledWith({
      apiKey: 'sk-secret-xyz', model: 'claude-haiku-5-5', system: 'sys', prompt: 'PROMPT-BODY', maxOutputTokens: 300,
    });
    expect(usage.entries).toEqual([{
      tenantId: 't1', source: 'PLATFORM', kind: 'ANTHROPIC', model: 'claude-haiku-5-5', providerId: 'p1',
      purpose: 'offer.text', inputTokens: 12, outputTokens: 5, success: true,
    }]);
    expect(JSON.stringify(usage.entries)).not.toMatch(/sk-secret|PROMPT-BODY/);
  });

  it('falha do provedor: grava uso com success false e repassa o erro', async () => {
    const { svc, usage } = make(async () => { throw new AiProviderUnavailableError('timeout'); });
    await expect(svc.generate(req)).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' });
    expect(usage.entries).toMatchObject([{ success: false, inputTokens: null, outputTokens: null }]);
  });

  it('texto vazio vira 503 e conta como falha com tokens', async () => {
    const { svc, usage } = make(async () => ({ text: '  ', inputTokens: 9, outputTokens: 16 }));
    await expect(svc.generate(req)).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' });
    expect(usage.entries).toMatchObject([{ success: false, inputTokens: 9, outputTokens: 16 }]);
  });

  it('falha de resolução não grava uso', async () => {
    const usage = new FakeUsage();
    const svc = new AiTextGeneratorService(
      { execute: async () => { throw new AiNotConfiguredError(); } },
      () => ({ generate: vi.fn() }),
      usage,
    );
    await expect(svc.generate(req)).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED', statusCode: 409 });
    expect(usage.entries).toHaveLength(0);
  });

  it('teto: reserva antes da chamada com a meia-noite de São Paulo; no limite → 429 sem chamar o provedor', async () => {
    const { svc, usage, adapter } = make(async () => ({ text: 'ok', inputTokens: 1, outputTokens: 1 }));
    usage.usedToday = 1;
    await svc.generate(req);
    expect(usage.quotas[0]).toEqual({ since: new Date('2026-10-26T03:00:00Z'), limit: 2 });
    await expect(svc.generate(req)).rejects.toMatchObject({ code: 'AI_DAILY_LIMIT_REACHED', statusCode: 429 });
    expect(adapter.generate).toHaveBeenCalledTimes(1);
    expect(usage.entries).toHaveLength(1);
  });

  it('falha do provedor também consome o teto (reserva fica success false)', async () => {
    const { svc, usage } = make(async () => { throw new AiProviderUnavailableError('timeout'); });
    await expect(svc.generate(req)).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' });
    await expect(svc.generate(req)).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' });
    await expect(svc.generate(req)).rejects.toMatchObject({ code: 'AI_DAILY_LIMIT_REACHED' });
    expect(usage.entries.map((e) => e.success)).toEqual([false, false]);
  });

  it('chave do tenant: sem teto, grava depois da chamada', async () => {
    const { svc, usage } = make(async () => ({ text: 'ok', inputTokens: 2, outputTokens: 3 }), {
      ...resolved, source: 'TENANT', providerId: null, dailyLimit: null,
    });
    usage.usedToday = 999;
    await svc.generate(req);
    expect(usage.quotas).toHaveLength(0);
    expect(usage.entries).toMatchObject([{ source: 'TENANT', success: true, inputTokens: 2 }]);
  });

  it('gravação do desfecho é best-effort: não troca resultado nem erro', async () => {
    const ok = make(async () => ({ text: 'ok', inputTokens: 1, outputTokens: 1 }));
    ok.usage.failWrites = true;
    expect(await ok.svc.generate(req)).toEqual({ text: 'ok' });
    const tenant = make(async () => { throw new AiProviderUnavailableError('timeout'); }, { ...resolved, dailyLimit: null });
    tenant.usage.failWrites = true;
    await expect(tenant.svc.generate(req)).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE', meta: { reason: 'timeout' } });
  });

  it('reserva falhando (banco) vira 503 AI_PROVIDER_UNAVAILABLE sem chamar o provedor', async () => {
    const { svc, usage, adapter } = make(async () => ({ text: 'ok', inputTokens: 1, outputTokens: 1 }));
    usage.reserveWithinDailyLimit = async () => { throw new Error('db down'); };
    await expect(svc.generate(req)).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' });
    expect(adapter.generate).not.toHaveBeenCalled();
  });
});
