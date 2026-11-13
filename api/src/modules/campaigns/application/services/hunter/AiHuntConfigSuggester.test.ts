import { describe, expect, it, vi } from 'vitest';
import type { AiTextRequest } from '../../../../assistants/domain/contracts/IAiTextGenerator';
import { AppError } from '../../../../../shared/errors/AppError';
import type { HuntCapabilities } from '../../../domain/hunter/HuntProvider';
import { huntCandidate } from '../../../domain/services/hunter/huntTestFixtures';
import { HUNT_CONFIG_AI_PURPOSE } from '../../../domain/services/hunter/huntConfigPrompt';
import { AiHuntConfigSuggester } from './AiHuntConfigSuggester';

const CAPS: HuntCapabilities = {
  provider: 'SHEIN', sorts: ['RECOMMENDED'], defaultSort: 'RECOMMENDED', sourceFilters: ['keyword', 'category'],
  localFilters: ['maxPriceCents', 'minCommissionPct'], commissionModel: 'NEW_RETURNING', imageHosts: ['ltwebstatic.com'],
  productIdPattern: /^\d+$/,
};

function setup(...answers: Array<string | Error>) {
  const generate = vi.fn(async (_req: AiTextRequest) => {
    const text = answers.length > 1 ? answers.shift()! : answers[0];
    if (text instanceof Error) throw text;
    return { text };
  });
  const logger = { warn: vi.fn() };
  const sleep = vi.fn(async (_ms: number) => undefined);
  return { generate, logger, sleep, s: new AiHuntConfigSuggester({ generate }, logger, sleep) };
}
const VALID = '{"name":"Vestidos","category":"10"}';
const input = {
  tenantId: 't1', capabilities: CAPS, categories: [{ categoryId: '10', name: 'Vestidos' }], intent: 'vestido barato',
  sample: { items: [huntCandidate({ title: 'SEGREDO-TITULO' })], pool: [] },
};

describe('AiHuntConfigSuggester', () => {
  it('1 chamada com purpose/tokens; devolve rascunho validado', async () => {
    const { s, generate } = setup('{"name":"Vestidos","category":"10","localFilters":{"maxPrice":50},"reasons":{"category":"Pedido"}}');
    const out = await s.suggest(input);
    expect(out?.draft).toMatchObject({ name: 'Vestidos', categoryId: '10', filters: { maxPriceCents: 5000 } });
    expect(out?.reasons).toEqual({ categoryId: 'Pedido' });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0]).toMatchObject({ tenantId: 't1', purpose: HUNT_CONFIG_AI_PURPOSE, maxOutputTokens: 1_500 });
  });

  it('saída inválida → null; log sem prompt, intenção nem resposta', async () => {
    const { s, logger } = setup('resposta SEGREDO-RESPOSTA');
    expect(await s.suggest(input)).toBeNull();
    const logged = JSON.stringify(logger.warn.mock.calls);
    expect(logged).toContain('AI_RESPONSE_INVALID');
    expect(logged).not.toMatch(/SEGREDO|vestido barato/);
  });

  it('erro inesperado → null; AppError do gerador sobe com o código', async () => {
    expect(await setup(new Error('boom SEGREDO')).s.suggest(input)).toBeNull();
    const err = new AppError('AI_DAILY_LIMIT_REACHED', 'x', 429);
    const { s, logger } = setup(err);
    await expect(s.suggest(input)).rejects.toBe(err);
    expect(logger.warn.mock.calls[0][0]).toMatchObject({ code: 'AI_DAILY_LIMIT_REACHED' });
  });

  // Produção 2026-11-13: 1 chamada `offer_hunt_config` falhou no provedor (sem tokens) e o usuário só viu erro genérico
  it('falha passageira do provedor (503/rede) → tenta de novo 1 vez e entrega a sugestão', async () => {
    const { s, generate, sleep, logger } = setup(new AppError('AI_PROVIDER_UNAVAILABLE', 'x', 503, { reason: 'status_503' }), VALID);
    expect((await s.suggest(input))?.draft.categoryId).toBe('10');
    expect(generate).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE', reason: 'status_503', retry: true });
  });

  it('provedor fora nas 2 tentativas → sobe o erro; timeout, recusa e limite não repetem', async () => {
    const down = new AppError('AI_PROVIDER_UNAVAILABLE', 'x', 503, { reason: 'network' });
    const twice = setup(down);
    await expect(twice.s.suggest(input)).rejects.toBe(down);
    expect(twice.generate).toHaveBeenCalledTimes(2);
    for (const err of [
      new AppError('AI_PROVIDER_UNAVAILABLE', 'x', 503, { reason: 'timeout' }),
      new AppError('AI_PROVIDER_REJECTED', 'x', 422, { status: 400 }),
      new AppError('AI_PROVIDER_RATE_LIMITED', 'x', 429),
    ]) {
      const once = setup(err, VALID);
      await expect(once.s.suggest(input)).rejects.toBe(err);
      expect(once.generate).toHaveBeenCalledTimes(1);
    }
  });

  it('resposta cortada pelo teto de saída ainda entrega os campos completos', async () => {
    const { s } = setup('{"name":"Vestidos","category":"10","localFilters":{"maxPrice":50},"reasons":{"category":"Pedido","maxPrice":"Cabe no bol');
    const out = await s.suggest(input);
    expect(out?.draft).toMatchObject({ name: 'Vestidos', categoryId: '10', filters: { maxPriceCents: 5000 } });
    expect(out?.reasons).toEqual({ categoryId: 'Pedido' });
  });
});
